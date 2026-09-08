import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {MAX_BACKUP_BYTES,MigrationValidationError,validateBackup,previewMigration} from '../lib/life/migration-preview.ts';

const now=new Date('2026-09-08T12:00:00.000Z'),date='2026-09-07',habit=randomUUID(),category=randomUUID(),recurring=randomUUID(),routine=randomUUID(),exercise=randomUUID();
const secretText='SYNTHETIC PRIVATE JOURNAL DO NOT PRINT';
const baseProfile={goal:'Synthetic reading goal',timezone:'UTC',modules:['reflection','money','fitness'],habits:[{id:habit,title:'Read something',module:'reflection',archived:false}],version:0};
const baseEntry={date,journal:secretText,context:{reflection:'Synthetic reflection'},statuses:[{id:habit,status:'done'}],complete:true,version:0};
const exerciseData={id:exercise,name:'Synthetic exercise',sets:2,reps:8,load:10,unit:'kg',restSeconds:60};

async function fixture({populate=true,uncertain=false,activeWorkout=false}={}){
 const raw=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const db={prepare(sql){assert.match(sql,/^(SELECT|INSERT|UPDATE)/);return {bind(...params){const q=raw.prepare(sql);return {async first(){return q.get(...params)||null;},async all(){return {results:q.all(...params)};}};}};}};
 const provider={generate:async()=>{if(uncertain)throw Error('Synthetic timeout');return {text:'Synthetic review preserving dated evidence',inputTokens:100,outputTokens:50,thoughtTokens:10,costMicros:300,modelVersion:'synthetic-model',providerId:'synthetic-id',finishReason:'STOP'};}};
 async function call(body,id='source',path=''){
  return handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',origin:'https://life.test'}:{},body:body?JSON.stringify(body):undefined}),id,db,now,{provider,enabled:true,userCapMicros:1000000,globalCapMicros:5000000});
 }
 async function ok(body){const response=await call(body);assert.equal(response.status,200);return response.json();}
 if(populate){
  await ok({action:'profile',profile:baseProfile});await ok({action:'entry',entry:baseEntry});
  await ok({action:'entry',entry:{...baseEntry,date:'2026-09-08',complete:false,statuses:[{id:habit,status:'unrecorded'}],journal:''}});
  await ok({action:'resource',record:{kind:'budget',id:'2026-09',version:0,data:{currency:'USD',categories:[{id:category,name:'Synthetic category',limitCents:10000}],recurring:[{id:recurring,title:'Synthetic bill',kind:'expense',amountCents:2000,categoryId:category,day:7,active:true}],goals:{spending:'Synthetic goal',saving:'',investing:''}}}});
  await ok({action:'resource',record:{kind:'transaction',id:`due:2026-09:${recurring}`,version:0,data:{date,kind:'expense',amountCents:2000,categoryId:category,note:'Synthetic transaction',recurringId:recurring,voided:false}}});
  await ok({action:'resource',record:{kind:'routine',id:routine,version:0,data:{name:'Synthetic routine',preferences:'',exercises:[exerciseData],archived:false}}});
  const w=randomUUID();const workout={date,routineId:routine,name:'Synthetic routine',exercises:[exerciseData],sets:[],restUntil:null,finishedAt:null};
  await ok({action:'resource',record:{kind:'workout',id:w,version:0,data:workout}});
  await ok({action:'resource',record:{kind:'workout',id:w,version:1,data:{...workout,sets:[{exerciseId:exercise,setNumber:1,reps:8,load:10,completedAt:now.toISOString()}],finishedAt:activeWorkout?null:now.toISOString()}}});
  const review={date,requestId:randomUUID(),sourceVersion:1,predecessorId:null,critique:'',consent:true};
  const initial=await call({action:'ai',review});assert.equal(initial.status,uncertain?502:200);
  if(!uncertain){
   await ok({action:'entry',entry:{...baseEntry,version:1,journal:secretText+' revised'}});
   await ok({action:'ai',review:{...review,requestId:randomUUID(),sourceVersion:2,predecessorId:'daily:'+date,critique:'Please focus on reading.'}});
  }
  // Current names may change; historical habit and workout snapshots must survive.
  const state=await (await call()).json();await ok({action:'profile',profile:{...state.profile,habits:[{...state.profile.habits[0],title:'Renamed habit',archived:true}]}});
  await call({action:'profile',profile:baseProfile},'other');await call({action:'entry',entry:{...baseEntry,journal:'OTHER ACCOUNT PRIVATE TEXT'}},'other');
 }
 const exportResponse=await call(undefined,'source','?export=1');assert.equal(exportResponse.status,200);
 const text=await exportResponse.text(),backup=JSON.parse(text);
 return {raw,call,text,backup};
}
const encode=b=>JSON.stringify(b);
const changePayload=(row,change)=>{row.payload=encode({...JSON.parse(row.payload),...change});};
function invalid(backup,code){assert.throws(()=>validateBackup(encode(backup)),e=>e instanceof MigrationValidationError&&e.code===code);}

test('actual private export validates losslessly with archived habits, workout snapshots and linked reviews',async()=>{
 const f=await fixture();const validated=validateBackup(f.text);assert.deepEqual(validated,f.backup);
 assert.doesNotMatch(f.text,/OTHER ACCOUNT PRIVATE TEXT|user_id|life_auth/);
 assert.equal(JSON.parse(validated.entries[0].payload).habits[0].title,'Read something');
 assert.equal(validated.reviews[1].predecessor_id,validated.reviews[0].request_id);
 const before=f.raw.prepare('SELECT total_changes() n').get().n;
 const preview=await previewMigration(f.text);assert.equal(preview.canApply,false);assert.equal(preview.targetCompared,false);assert.equal(preview.comparison,null);
 assert.deepEqual(preview.source.resourceKinds,{budget:1,transaction:1,routine:1,workout:1});assert.equal(preview.source.measuredCostMicros,600);
 assert.equal(preview.sourceSha256,createHash('sha256').update(f.text).digest('hex'));assert.equal(f.raw.prepare('SELECT total_changes() n').get().n,before);
 assert.doesNotMatch(encode(preview),/SYNTHETIC PRIVATE|reading|Synthetic routine|Please focus|Renamed/);f.raw.close();
});
test('preview distinguishes insert, exact replay, conflicts and destination-only data without authorizing import',async()=>{
 const source=await fixture(),empty=await fixture({populate:false});
 const initial=await previewMigration(source.text,empty.text);assert.deepEqual(initial.comparison,{insert:9,identical:0,conflicts:0,targetOnly:0});assert.equal(initial.canApply,false);
 const same=await previewMigration(source.text,source.text);assert.deepEqual(same.comparison,{insert:0,identical:9,conflicts:0,targetOnly:0});
 const changed=structuredClone(source.backup);changePayload(changed.entries[0],{journal:'Destination changed this entry'});changed.entries[0].version++;
 const extra=structuredClone(changed.entries[1]);extra.entry_date='2026-09-06';changePayload(extra,{date:extra.entry_date});changed.entries.push(extra);
 const conflict=await previewMigration(source.text,encode(changed));assert.deepEqual(conflict.comparison,{insert:0,identical:8,conflicts:1,targetOnly:1});assert.ok(conflict.blockers.includes('conflicting_records'));assert.equal(conflict.canApply,false);
 source.raw.close();empty.raw.close();
});
test('duplicate records, damaged versions, invalid dates and mismatched row dates are rejected',async()=>{
 const f=await fixture();
 for(const key of ['entries','resources','reviews']){const b=structuredClone(f.backup);b[key].push(b[key][0]);invalid(b,'duplicate_record');}
 let b=structuredClone(f.backup);b.entries[0].version=0;invalid(b,'invalid_shape');
 b=structuredClone(f.backup);b.entries[0].entry_date='2026-02-30';invalid(b,'invalid_shape');
 b=structuredClone(f.backup);changePayload(b.entries[0],{date:'2026-09-05'});invalid(b,'date_mismatch');
 b=structuredClone(f.backup);changePayload(b.profile,{version:99});invalid(b,'embedded_version');
 b=structuredClone(f.backup);changePayload(b.entries[1],{complete:true});invalid(b,'incomplete_marked_complete');f.raw.close();
});
test('references and uniqueness survive financial and gym migration checks',async()=>{
 const f=await fixture();let b=structuredClone(f.backup);
 b.resources.find(r=>r.kind==='transaction').resource_id=randomUUID();invalid(b,'invalid_occurrence_id');
 b=structuredClone(f.backup);b.resources.find(r=>r.kind==='transaction').period='2026-08';invalid(b,'period_mismatch');
 b=structuredClone(f.backup);b.resources=b.resources.filter(r=>r.kind!=='budget');invalid(b,'missing_budget');
 b=structuredClone(f.backup);b.resources=b.resources.filter(r=>r.kind!=='routine');invalid(b,'missing_routine');
 b=structuredClone(f.backup);const w=b.resources.find(r=>r.kind==='workout');w.active_slot='active';invalid(b,'active_workout_mismatch');f.raw.close();
});
test('review chain, immutable evidence and measured usage cannot be dropped or silently rebuilt',async()=>{
 const f=await fixture();let b=structuredClone(f.backup);b.reviews[1].predecessor_id='missing';invalid(b,'broken_review_chain');
 b=structuredClone(f.backup);b.reviews[1].source_version=999;invalid(b,'missing_source_revision');
 b=structuredClone(f.backup);b.reviews[0].cost_micros=null;invalid(b,'missing_usage');
 b=structuredClone(f.backup);b.reviews[0].thought_tokens=999;invalid(b,'invalid_usage');
 b=structuredClone(f.backup);const snapshot=JSON.parse(b.reviews[1].input_snapshot);snapshot.previousReview='Changed history';b.reviews[1].input_snapshot=encode(snapshot);invalid(b,'revision_evidence_mismatch');
 b=structuredClone(f.backup);b.entries=[];invalid(b,'missing_source_revision');f.raw.close();
});
test('held AI reservations remain visible and block cutover; active workouts across accounts conflict',async()=>{
 const f=await fixture({uncertain:true,activeWorkout:true}),target=await fixture({activeWorkout:true});
 const preview=await previewMigration(f.text,target.text);assert.equal(preview.source.reportStatuses.uncertain,1);assert.equal(preview.source.heldReservationMicros,200000);
 assert.ok(preview.blockers.includes('usage_reconciliation_required'));assert.ok(preview.blockers.includes('multiple_active_workouts'));assert.equal(preview.canApply,false);
 assert.equal(f.backup.reviews[0].status,'uncertain');f.raw.close();target.raw.close();
});
test('oversize, excessive nesting, credential fields and ownership claims fail without echoing private data',async()=>{
 const f=await fixture();
 for(const text of ['x'.repeat(MAX_BACKUP_BYTES+1),'['.repeat(49)+']'.repeat(49),'{"private":"'+secretText])assert.throws(()=>validateBackup(text),e=>e instanceof MigrationValidationError&&!e.message.includes(secretText));
 for(const injected of [{user_id:'victim'},{ownershipVerified:true},{GOOGLE_CLIENT_SECRET:secretText}])invalid({...f.backup,...injected},'invalid_shape');
 const poisoned=structuredClone(f.backup);poisoned.entries[0].payload='{"__proto__":{"admin":true}}';invalid(poisoned,'unsafe_field');assert.equal({}.admin,undefined);
 const missing=structuredClone(f.backup);missing.profile=null;invalid(missing,'missing_profile');f.raw.close();
});
test('cross-platform CLI reads actual exports, writes redacted previews, and refuses apply/overwrite or invalid UTF-8',async()=>{
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'lifeapp-migration-'));const source=join(dir,'source.json'),output=join(dir,'preview.json');writeFileSync(source,f.text);
 const run=args=>spawnSync(process.execPath,['scripts/migration-preview.mjs',...args],{encoding:'utf8'});
 try{
  const result=run([source,'--target',source,'--out',output]);assert.equal(result.status,0,result.stderr);const preview=JSON.parse(readFileSync(output,'utf8'));assert.equal(preview.comparison.identical,9);assert.equal(preview.canApply,false);
  assert.equal(run([source,'--out',output]).status,1);assert.equal(run([source,'--out',source]).status,1);assert.equal(readFileSync(source,'utf8'),f.text);
  assert.equal(run([source,'--apply','true']).status,1);assert.equal(run([source,'--target',source,'--target',source]).status,1);
  const bad=join(dir,'invalid.json');writeFileSync(bad,Buffer.from([0xff]));assert.equal(run([bad]).status,1);
  assert.doesNotMatch(result.stdout+result.stderr+readFileSync(output,'utf8'),/SYNTHETIC PRIVATE|OTHER ACCOUNT/);
 }finally{rmSync(dir,{recursive:true,force:true});f.raw.close();}
});
