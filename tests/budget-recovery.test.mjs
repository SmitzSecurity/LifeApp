import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {availableBudgetRecovery,budgetRecoverySQL,settledBudgetRecoverySQL} from '../lib/life/budget-recovery.ts';
import {recoverySQL,workoutRecoverySchema} from '../lib/life/workout-recovery.ts';
import {profileSchema} from '../lib/life/domain.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';

const created='2026-09-16T10:00:00.000Z',granted='2026-09-16T11:00:00.000Z',now='2026-09-16T12:00:00.000Z',expires='2026-09-17T12:00:00.000Z';
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const sourceId=randomUUID(),grant={sourceId,expiresAt:expires,purpose:'budget'};
 function job(id=sourceId,patch={}){
  const row={user_id:'a',request_id:'budget:'+id,status:'uncertain',input_snapshot:JSON.stringify({description:'Synthetic monthly budget',month:'2026-09',moneyGoals:{goal:'Synthetic goal'}}),result_json:null,model:'synthetic',price_version:'synthetic',provider_id:null,input_tokens:null,output_tokens:null,thought_tokens:null,reserved_micros:200000,cost_micros:null,created_at:created,finished_at:created,error_code:'provider_or_storage_unconfirmed',...patch};
  raw.prepare(`INSERT INTO life_routine_builds(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));return row;
 }
 function issue(id=sourceId,patch={},user='a'){
  const data={...grant,sourceId:id,...patch};raw.prepare("INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at) VALUES(?,'ai-recovery',?,'',?,1,?)").run(user,id,JSON.stringify(data),granted);return data;
 }
 const predicate=(fn,id=sourceId,user='a',stamp=now)=>raw.prepare(`SELECT ${fn('?1','?2','?3')} AS ok`).get(user,id,...(fn===settledBudgetRecoverySQL?[]:[stamp])).ok;
 return {raw,db,sourceId,grant,job,issue,predicate};
}

test('budget recovery is operator-scoped, expiring, namespace-isolated and unavailable to workout recovery',async t=>{
 const f=fixture(t);f.job();f.issue();
 assert.equal(f.predicate(budgetRecoverySQL),1);
 assert.deepEqual(await availableBudgetRecovery(f.db,'a',new Date(now)),{sourceId:f.sourceId,expiresAt:expires});
 assert.equal(await availableBudgetRecovery(f.db,'other',new Date(now)),null);
 assert.equal(f.predicate(budgetRecoverySQL,f.sourceId,'other'),0);
 assert.equal(f.predicate(budgetRecoverySQL,f.sourceId,'a',expires),0);
 assert.equal(f.predicate(budgetRecoverySQL,f.sourceId,'a',created),0);
 f.job(f.sourceId,{request_id:'workout:'+f.sourceId,status:'failed',cost_micros:500,error_code:'invalid_workout_schema'});
 assert.equal(f.predicate(recoverySQL),0);
 assert.equal(workoutRecoverySchema.safeParse(f.grant).success,true);
 assert.equal(workoutRecoverySchema.safeParse({...f.grant,purpose:'routine'}).success,false);
 f.raw.prepare("UPDATE life_resources SET payload=json_remove(payload,'$.purpose')").run();
 assert.equal(f.predicate(budgetRecoverySQL),0);assert.equal(f.predicate(recoverySQL),1);
});

test('atomic admission spends a grant exactly once and uncertain recovery cannot be recovered again',async t=>{
 const f=fixture(t);f.job();f.issue();const recoveryId=randomUUID();
 const snapshot=JSON.stringify({description:'New explicitly submitted budget',month:'2026-09',moneyGoals:{},recoveryOf:f.sourceId});
 const insert=f.raw.prepare(`INSERT INTO life_routine_builds(user_id,request_id,status,input_snapshot,model,price_version,reserved_micros,created_at)
 SELECT ?1,?4,'generating',?5,'synthetic','synthetic',200000,?3 WHERE ${budgetRecoverySQL('?1','?2','?3')} RETURNING request_id`);
 assert.equal(insert.get('a',f.sourceId,now,'budget:'+recoveryId,snapshot).request_id,'budget:'+recoveryId);
 assert.equal(insert.get('a',f.sourceId,now,'budget:'+randomUUID(),snapshot),undefined);
 assert.equal(await availableBudgetRecovery(f.db,'a',new Date(now)),null);
 assert.equal(f.predicate(settledBudgetRecoverySQL),0);
 f.raw.prepare("UPDATE life_routine_builds SET status='uncertain',finished_at=?,error_code='provider_or_storage_unconfirmed' WHERE request_id=?").run(now,'budget:'+recoveryId);
 f.issue(recoveryId);assert.equal(f.predicate(budgetRecoverySQL,recoveryId),0);assert.equal(f.predicate(settledBudgetRecoverySQL),0);
 assert.equal(f.raw.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS held FROM life_ai_usage').get().held,400000);
});

test('known recovery outcome releases only its original blocker after expiry while preserving unknown costs and purged evidence',t=>{
 const f=fixture(t);f.job();f.issue();const recoveryId=randomUUID();
 f.job(recoveryId,{status:'failed',input_snapshot:JSON.stringify({purged:true,recoveryOf:f.sourceId}),created_at:now,cost_micros:500,input_tokens:10,output_tokens:10,thought_tokens:0,error_code:'invalid_budget_output'});
 assert.equal(f.predicate(settledBudgetRecoverySQL),1);
 assert.equal(f.predicate(budgetRecoverySQL,f.sourceId,'a','2028-01-01T00:00:00.000Z'),0);
 assert.equal(f.predicate(settledBudgetRecoverySQL),1);
 const other=randomUUID();f.job(other);assert.equal(f.predicate(settledBudgetRecoverySQL,other),0);
 const held=f.raw.prepare('SELECT status,cost_micros,reserved_micros FROM life_routine_builds WHERE request_id=?').get('budget:'+f.sourceId);
 assert.deepEqual({...held},{status:'uncertain',cost_micros:null,reserved_micros:200000});
 assert.equal(f.raw.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS held FROM life_ai_usage').get().held,400500);
});

test('known outcomes from other accounts, namespaces, or outside grant time cannot settle a budget source',t=>{
 const f=fixture(t);f.job();f.issue();
 const recovered={status:'complete',cost_micros:500,input_snapshot:JSON.stringify({purged:true,recoveryOf:f.sourceId}),created_at:now};
 f.job(randomUUID(),{...recovered,user_id:'other'});assert.equal(f.predicate(settledBudgetRecoverySQL),0);
 f.job(randomUUID(),{...recovered,request_id:'workout:'+randomUUID()});assert.equal(f.predicate(settledBudgetRecoverySQL),0);
 f.job(randomUUID(),{...recovered,created_at:expires});assert.equal(f.predicate(settledBudgetRecoverySQL),0);
 f.job(randomUUID(),{...recovered,created_at:created});assert.equal(f.predicate(settledBudgetRecoverySQL),0);
});

test('budget recovery grants and larger document snapshots round-trip through backup without widening other namespaces',t=>{
 const f=fixture(t);f.job();f.issue();
 const {version,...profile}=profileSchema.parse({goal:'Synthetic goal',timezone:'UTC',modules:['money'],habits:[],version:1});
 const jobs=f.raw.prepare('SELECT * FROM life_routine_builds').all().map(({user_id,...row})=>({...row}));
 const resources=f.raw.prepare('SELECT * FROM life_resources').all().map(({user_id,...row})=>({...row}));
 const backup={format:'lifeapp-portable-v1',exportedAt:now,profile:{payload:JSON.stringify(profile),version,updated_at:created},entries:[],resources,reviews:[],routineBuilds:jobs};
 jobs[0].input_snapshot=JSON.stringify({description:'X'.repeat(100000),month:'2026-09',moneyGoals:{}});
 assert.deepEqual(validateBackup(JSON.stringify(backup)),backup);
 const invalid=structuredClone(backup);invalid.routineBuilds[0].request_id='routine:'+f.sourceId;
 assert.throws(()=>validateBackup(JSON.stringify(invalid)),/invalid_shape/);
 const multibyte=structuredClone(backup);multibyte.routineBuilds[0].input_snapshot=JSON.stringify({description:'界'.repeat(400000),month:'2026-09',moneyGoals:{}});
 assert.throws(()=>validateBackup(JSON.stringify(multibyte)),/invalid_shape/);
 const wrongPurpose=structuredClone(backup);wrongPurpose.resources[0].payload=JSON.stringify({...f.grant,purpose:undefined});
 assert.throws(()=>validateBackup(JSON.stringify(wrongPurpose)),/missing_recovery_source/);
});
