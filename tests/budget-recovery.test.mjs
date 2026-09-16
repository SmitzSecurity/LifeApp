import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {availableBudgetRecovery,budgetRecoverySQL,settledBudgetRecoverySQL,acknowledgedBudgetBlockerSQL} from '../lib/life/budget-recovery.ts';
import {recoverySQL,workoutRecoverySchema} from '../lib/life/workout-recovery.ts';
import {profileSchema} from '../lib/life/domain.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
import {handleLife} from '../lib/life/service.ts';

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
 const predicate=(fn,id=sourceId,user='a',stamp=now)=>raw.prepare(`SELECT ${fn('?1','?2','?3')} AS ok`).get(user,id,...([settledBudgetRecoverySQL,acknowledgedBudgetBlockerSQL].includes(fn)?[]:[stamp])).ok;
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

const acknowledged='2026-09-16T13:00:00.000Z';
function acknowledge(f,patch={}){
 const recoveryId=randomUUID();f.job();f.issue();
 f.job(recoveryId,{input_snapshot:JSON.stringify({description:'Synthetic monthly budget',month:'2026-09',moneyGoals:{},recoveryOf:f.sourceId}),created_at:now,finished_at:now});
 const grant={...f.grant,operatorAcknowledgement:{reason:'invalid_output_mime_enum',requestIds:[f.sourceId,recoveryId],acknowledgedAt:acknowledged,...patch}};
 f.raw.prepare("UPDATE life_resources SET payload=?,updated_at=?,version=2 WHERE kind='ai-recovery' AND resource_id=?").run(JSON.stringify(grant),acknowledged,f.sourceId);
 return {recoveryId,grant};
}
function backup(f){
 const {version,...profile}=profileSchema.parse({goal:'Synthetic goal',timezone:'UTC',modules:['money'],habits:[],version:1});
 return {format:'lifeapp-portable-v1',exportedAt:acknowledged,profile:{payload:JSON.stringify(profile),version,updated_at:created},entries:[],resources:f.raw.prepare('SELECT * FROM life_resources').all().map(({user_id,...r})=>({...r})),reviews:[],routineBuilds:f.raw.prepare('SELECT * FROM life_routine_builds').all().map(({user_id,...r})=>({...r}))};
}

test('operator acknowledgment identifies exactly the two diagnosed requests, preserves held accounting and consumed grant',async t=>{
 const f=fixture(t),{recoveryId,grant}=acknowledge(f);
 assert.equal(workoutRecoverySchema.safeParse(grant).success,true);
 for(const id of [f.sourceId,recoveryId])assert.equal(f.predicate(acknowledgedBudgetBlockerSQL,id),1);
 assert.equal(f.predicate(acknowledgedBudgetBlockerSQL,randomUUID()),0);
 assert.equal(f.predicate(acknowledgedBudgetBlockerSQL,f.sourceId,'other'),0);
 assert.equal(await availableBudgetRecovery(f.db,'a',new Date(acknowledged)),null);
 assert.equal(f.predicate(budgetRecoverySQL,f.sourceId,'a',acknowledged),0);
 assert.equal(f.raw.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS held FROM life_ai_usage').get().held,400000);
 for(const row of f.raw.prepare('SELECT status,cost_micros,reserved_micros FROM life_routine_builds').all())assert.deepEqual({...row},{status:'uncertain',cost_micros:null,reserved_micros:200000});
 const exported=backup(f);assert.deepEqual(validateBackup(JSON.stringify(exported)),exported);
 f.raw.prepare('UPDATE life_routine_builds SET input_snapshot=? WHERE request_id=?').run(JSON.stringify({purged:true}),'budget:'+f.sourceId);
 f.raw.prepare('UPDATE life_routine_builds SET input_snapshot=? WHERE request_id=?').run(JSON.stringify({purged:true,recoveryOf:f.sourceId}),'budget:'+recoveryId);
 assert.equal(f.predicate(acknowledgedBudgetBlockerSQL,recoveryId),1);
});

test('forged, unrelated, malformed, unlinked and late acknowledgments cannot suppress blockers or survive export validation',t=>{
 const f=fixture(t),{recoveryId,grant}=acknowledge(f),original=backup(f);
 const write=g=>f.raw.prepare('UPDATE life_resources SET payload=? WHERE resource_id=?').run(JSON.stringify(g),f.sourceId);
 for(const patch of [{reason:'ignore'}, {requestIds:[f.sourceId,f.sourceId]}, {requestIds:[recoveryId,f.sourceId]}, {requestIds:[f.sourceId,randomUUID()]}, {requestIds:[f.sourceId,recoveryId,randomUUID()]}, {acknowledgedAt:created}, {acknowledgedAt:expires}]){
  const altered={...grant,operatorAcknowledgement:{...grant.operatorAcknowledgement,...patch}};write(altered);
  assert.equal(f.predicate(acknowledgedBudgetBlockerSQL),0,JSON.stringify(patch));
  const bad=structuredClone(original);bad.resources[0].payload=JSON.stringify(altered);assert.throws(()=>validateBackup(JSON.stringify(bad)));
 }
 write(grant);
 assert.equal(workoutRecoverySchema.safeParse({...grant,purpose:undefined}).success,false);
 for(const patch of [{error_code:'different_outcome'}, {status:'generating'}, {provider_id:'receipt'}, {cost_micros:0}, {input_tokens:0}, {reserved_micros:0}, {created_at:expires,finished_at:expires}, {input_snapshot:JSON.stringify({description:'Unrelated budget',month:'2026-09',moneyGoals:{}})}]){
  const keys=Object.keys(patch),before=f.raw.prepare('SELECT * FROM life_routine_builds WHERE request_id=?').get('budget:'+recoveryId);
  f.raw.prepare(`UPDATE life_routine_builds SET ${keys.map(k=>k+'=?').join(',')} WHERE request_id=?`).run(...Object.values(patch),'budget:'+recoveryId);
  assert.equal(f.predicate(acknowledgedBudgetBlockerSQL),0,JSON.stringify(patch));
  assert.throws(()=>validateBackup(JSON.stringify(backup(f))),/invalid_operator_acknowledgement/);
  f.raw.prepare(`UPDATE life_routine_builds SET ${keys.map(k=>k+'=?').join(',')} WHERE request_id=?`).run(...keys.map(k=>before[k]),'budget:'+recoveryId);
 }
 f.job(randomUUID(),{input_snapshot:JSON.stringify({description:'Extra linked budget',month:'2026-09',moneyGoals:{},recoveryOf:f.sourceId}),created_at:now,finished_at:now});
 assert.equal(f.predicate(acknowledgedBudgetBlockerSQL),0);assert.throws(()=>validateBackup(JSON.stringify(backup(f))),/invalid_operator_acknowledgement/);
});

test('acknowledged requests retain exact retries, fresh builds require an explicit action, and unrelated unknown jobs still block',async t=>{
 const f=fixture(t),{recoveryId,grant}=acknowledge(f);let calls=0;
 const ai={enabled:true,userCapMicros:1000000,globalCapMicros:5000000,ownerPrototype:{userId:'a',expiresAt:expires},provider:{async generate(){calls++;return {text:JSON.stringify({notes:'Synthetic draft',categories:[],recurring:[]}),inputTokens:10,outputTokens:10,thoughtTokens:0,costMicros:500,providerId:'synthetic',modelVersion:'synthetic',finishReason:'STOP'};}}};
 const call=(body,query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),'a',f.db,new Date(acknowledged),ai);
 assert.equal((await call({action:'profile',profile:{goal:'Synthetic goal',timezone:'UTC',modules:['money'],habits:[],version:0}})).status,200);
 const build=(id,patch={})=>({action:'budget-build',build:{requestId:id,text:'Synthetic monthly budget',month:'2026-09',consent:true,...patch}});
 let listing=await (await call(null,'?budget-builds')).json();assert.equal(listing.blockedReason,null);assert.equal(listing.recovery,null);assert.equal(listing.builds.every(b=>b.resolvedBlocker),true);assert.equal(calls,0);
 for(const [id,patch] of [[f.sourceId,{}],[recoveryId,{recoveryOf:f.sourceId}]]){
  const response=await call(build(id,patch));assert.equal(response.status,200);const saved=(await response.json()).build;assert.equal(saved.status,'uncertain');assert.equal(saved.resolvedBlocker,true);
  assert.equal((await call(build(id,{...patch,text:'A different submitted budget'}))).status,409);
 }
 assert.equal(calls,0);
 const fresh=randomUUID();assert.equal((await call(build(fresh))).status,200);assert.equal(calls,1);assert.equal((await call(build(fresh))).status,200);assert.equal(calls,1);
 assert.equal(f.raw.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS held FROM life_ai_usage').get().held,400500);
 assert.equal((await call({action:'resource',record:{kind:'ai-recovery',id:f.sourceId,version:2,data:grant}})).status,400);
 const unrelated=randomUUID();f.job(unrelated);listing=await (await call(null,'?budget-builds')).json();assert.match(listing.blockedReason,/unconfirmed/);assert.equal(listing.builds.find(b=>b.id===unrelated).resolvedBlocker,false);
 assert.equal((await call(build(randomUUID()))).status,429);assert.equal(calls,1);
});
