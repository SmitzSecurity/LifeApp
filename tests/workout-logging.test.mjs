import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {renderReportMarkdown} from '../lib/life/report-markdown.ts';
import {reportEmail} from '../lib/life/email-service.ts';
import {exercisePresets,presetExercise,repTarget} from '../lib/life/exercise-presets.ts';
import {exerciseSchema,workoutSchema,nextSet,structuredWorkoutSchema} from '../lib/life/modules.ts';
import {validateBackup,previewMigration} from '../lib/life/migration-preview.ts';
import {AI_MODEL,RESERVATION_MICROS,geminiProvider} from '../lib/life/ai-provider.ts';
const now=new Date('2026-09-14T12:00:00.000Z');
const description='Push / pull split, dumbbells and cables, muscle growth. About 45 minutes.';
const output={notes:'Choose a starting load.',routines:[{name:'Push',preferences:'Dumbbells',exercises:[{name:'Dumbbell bench press',sets:3,reps:6,repMax:10,load:0,unit:'lb',restSeconds:150}]}]};
const providerResult={text:JSON.stringify(output),inputTokens:100,outputTokens:150,thoughtTokens:10,costMicros:500,providerId:'synthetic',modelVersion:AI_MODEL,finishReason:'STOP'};
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const state={calls:[],result:providerResult,hook:null,beforeInsert:null};
 const db={prepare(sql){return {bind(...params){return {async first(){if(sql.startsWith('INSERT INTO life_routine_builds')&&state.beforeInsert){const fn=state.beforeInsert;state.beforeInsert=null;fn();}return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const ai={enabled:true,userCapMicros:1000000,globalCapMicros:5000000,provider:{generate:async(input,purpose)=>{state.calls.push({input:JSON.parse(input),purpose});if(state.hook)await state.hook();return purpose==='routine'||purpose==='workout'?state.result:{...providerResult,text:'Synthetic analysis'};}}};
 const call=(body,id='a',path='')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),id,db,now,ai);
 async function setup(id='a'){assert.equal((await call({action:'profile',profile:{goal:'Private overall goal',moduleGoals:{fitness:'Build muscle'},timezone:'UTC',modules:['reflection','fitness','money'],habits:[],version:0}},id)).status,200);assert.equal((await call({action:'entry',entry:{date:'2026-09-13',journal:'Private journal not for routine builder',context:{},statuses:[],complete:true,version:0}},id)).status,200);}
 const build=(extra={})=>({action:'routine-build',build:{requestId:randomUUID(),text:description,consent:true,...extra}});
 const analysis=(cadence='daily')=>({action:'ai',review:{cadence,date:'2026-09-13',sourceVersion:1,requestId:randomUUID(),predecessorId:null,critique:'',consent:true}});
 return {raw,db,ai,state,call,setup,build,analysis};
}


import {recordedVolume} from '../lib/life/muscle-volume.ts';
import {consumeReportEmails} from '../lib/life/email-service.ts';

const written={notes:'Check the unfamiliar movement.',name:'Written push',exercises:[{name:'Bench press',unit:'lb',reps:6,repMax:10,restSeconds:150,muscles:{direct:['forearms'],indirect:[]},logged:[{reps:8,load:100,warmup:true},{reps:8,load:135,warmup:false},{reps:7,load:135,warmup:false}]},{name:'Synthetic custom cable press',unit:'lb',reps:8,repMax:12,restSeconds:120,muscles:{direct:['chest'],indirect:['triceps']},logged:[{reps:12,load:30,warmup:false}]}]};
const write=(id=randomUUID())=>({action:'workout-build',build:{requestId:id,text:'Completed bench: warm-up 100 x 8, 135 x 8/7 lb; custom cable press 30 lb x 12.',consent:true}});
const remove=(kind,id,deleted=true,version)=>({action:'record-deletion',change:{kind,id,deleted,...(version?{version}:{})}});
async function note(f,date='2026-09-14'){
 f.state.result={...providerResult,text:JSON.stringify(written)};
 const built=await (await f.call(write())).json();assert.equal(built.build.status,'complete');
 const record={kind:'workout-note',id:randomUUID(),version:0,data:{date,text:'The original training text.',minutes:40,voided:false,structured:built.build.result.workout}};
 const saved=await (await f.call({action:'resource',record})).json();assert.ok(saved.record);return {...record,version:saved.record.version};
}

test('three warm-ups preserve all three working sets, survive reload, and corrections reopen work',()=>{
 const e=presetExercise('Lat pulldown'),w={date:'2026-09-14',routineId:randomUUID(),name:'Pull',exercises:[e],sets:[],restUntil:null,finishedAt:null};
 for(let i=0;i<3;i++){const next=nextSet(w);assert.equal(next.workingSetNumber,1);w.sets.push({exerciseId:e.id,setNumber:next.setNumber,reps:10,load:40,warmup:true,completedAt:now.toISOString()});}
 const restored=workoutSchema.parse(JSON.parse(JSON.stringify(w)));assert.equal(nextSet(restored).workingSetNumber,1);
 for(let i=1;i<=3;i++){const next=nextSet(restored);assert.equal(next.workingSetNumber,i);restored.sets.push({exerciseId:e.id,setNumber:next.setNumber,reps:10,load:100,warmup:false,completedAt:now.toISOString()});}
 assert.equal(nextSet(restored),null);assert.ok(workoutSchema.safeParse(restored).success);
 assert.equal(recordedVolume([{id:randomUUID(),version:1,data:restored}],'2026-09-14','2026-09-14').sets,3);
 restored.sets[4].warmup=true;assert.equal(nextSet(restored).workingSetNumber,3);
 restored.sets.splice(1,1);assert.equal(nextSet(restored).setNumber,2);
});

test('new set serials save against the original immutable plan and cannot over-log working sets',async t=>{
 const f=fixture(t);await f.setup();const e=presetExercise('Lat pulldown'),r={id:randomUUID(),version:0,data:{name:'Pull',exercises:[e],preferences:'',archived:false}};
 assert.equal((await f.call({action:'resource',record:{kind:'routine',...r}})).status,200);
 const w={kind:'workout',id:randomUUID(),version:0,data:{date:'2026-09-14',routineId:r.id,name:'Pull',exercises:[e],sets:[],restUntil:null,finishedAt:null}};
 assert.equal((await f.call({action:'resource',record:w})).status,200);w.version=1;
 for(let n=1;n<=6;n++)w.data.sets.push({exerciseId:e.id,setNumber:n,reps:10,load:100,warmup:n<=3,completedAt:now.toISOString()});
 assert.equal((await f.call({action:'resource',record:w})).status,200);assert.equal((await f.call({action:'resource',record:w})).status,200);
 w.data.sets.push({...w.data.sets[5],setNumber:7});w.version=2;assert.equal((await f.call({action:'resource',record:w})).status,400);
 w.data.sets.pop();w.data.deleted=true;assert.equal((await f.call({action:'resource',record:w})).status,200);assert.equal(f.raw.prepare("SELECT active_slot FROM life_resources WHERE kind='workout'").get().active_slot,null);
});

test('written AI is an unsaved draft; confirmation counts once and creates account-scoped personal definitions',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');f.state.result={...providerResult,text:JSON.stringify(written)};
 const body=write(),draft=await (await f.call(body)).json();assert.equal(draft.build.status,'complete');assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_resources').get().n,0);
 assert.deepEqual(await (await f.call(body)).json(),draft);assert.equal(f.state.calls.length,1);assert.equal(f.state.calls[0].purpose,'workout');assert.ok(!JSON.stringify(f.state.calls).includes('Private journal'));
 assert.deepEqual(draft.build.result.workout.exercises[0].muscles.direct,['chest']); // Canonical mappings outrank AI guesses.
 const record={kind:'workout-note',id:randomUUID(),version:0,data:{date:'2026-09-14',text:body.build.text,minutes:40,voided:false,structured:draft.build.result.workout}};
 for(let i=0;i<2;i++)assert.equal((await f.call({action:'resource',record})).status,200);
 const summary=await (await f.call(null,'a','?training-summary')).json();assert.equal(summary.current.sets,3);assert.equal(summary.current.sessions,1);assert.equal(summary.current.warmups,1);assert.equal(summary.current.muscles.chest.direct,3);
 const presets=await (await f.call(null,'a','?personal-exercises')).json();assert.equal(presets.exercises.length,2);assert.equal((await (await f.call(null,'b','?personal-exercises')).json()).exercises.length,0);
 assert.equal((await (await f.call(null,'a','?routine-builds')).json()).builds.length,0);assert.equal((await (await f.call(null,'a','?workout-builds')).json()).builds.length,1);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('invalid muscles, duplicate roles and excessive working sets cannot enter saved structured logs',async t=>{
 const f=fixture(t);await f.setup();f.state.result={...providerResult,text:JSON.stringify({...written,exercises:[{...written.exercises[0],muscles:{direct:['invented-muscle'],indirect:[]}}]})};
 assert.equal((await (await f.call(write())).json()).build.status,'failed');assert.equal(f.raw.prepare('SELECT cost_micros FROM life_ai_usage').get().cost_micros,500);
 const e=presetExercise('Bench press');assert.equal(structuredWorkoutSchema.safeParse({name:'Bad',exercises:[{...e,muscles:{direct:['chest'],indirect:['chest']}}],sets:[]}).success,false);
});

test('written-log deletion and restore exclude totals, coverage and evidence while preserving presets',async t=>{
 const f=fixture(t);await f.setup();const record=await note(f);
 record.data.deleted=true;assert.equal((await f.call({action:'resource',record})).status,200);assert.equal((await (await f.call(null,'a','?training-summary')).json()).current.sets,0);
 const home=await (await f.call(null,'a','?dashboard')).json();assert.equal(home.trends.at(-1).strengthSessions,0);
 assert.equal((await (await f.call(null,'a','?personal-exercises')).json()).exercises.length,2);
 record.version=2;record.data.deleted=false;assert.equal((await f.call({action:'resource',record})).status,200);assert.equal((await (await f.call(null,'a','?training-summary')).json()).current.sets,3);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('weekly training analysis uses scoped training only and retries after source deletion without spending twice',async t=>{
 const f=fixture(t);await f.setup();const record=await note(f);const body={action:'training-analysis',build:{requestId:randomUUID(),consent:true}};
 const first=await (await f.call(body)).json();assert.equal(first.build.status,'complete');const call=f.state.calls.at(-1);assert.equal(call.purpose,'training');assert.equal(call.input.training.current.sets,3);assert.equal(call.input.training.coverage.workingSets,3);assert.ok(!JSON.stringify(call).includes('Private journal'));assert.ok(!JSON.stringify(call).includes('Private overall'));
 record.data.deleted=true;await f.call({action:'resource',record});assert.deepEqual(await (await f.call(body)).json(),first);assert.equal(f.state.calls.length,2);
 await f.call(remove('build','training:'+first.build.id));assert.equal((await (await f.call(null,'a','?training-analyses')).json()).builds[0].deleted,true);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_ai_usage').get().n,2);validateBackup(await (await f.call(null,'a','?export')).text());
});

test('deleting a journal checks versions, blocks edits and daily generation, and restores original completion',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');assert.equal((await f.call(remove('entry','2026-09-13',true,7))).status,409);
 assert.equal((await f.call(remove('entry','2026-09-13',true,1))).status,200);assert.equal((await f.call(remove('entry','2026-09-13',true,1))).status,200);
 assert.equal((await (await f.call({action:'history',filters:{}})).json()).entries.length,0);const trash=await (await f.call({action:'history',filters:{deleted:true}})).json();assert.equal(trash.entries[0].version,2);assert.equal(trash.entries[0].complete,false);
 assert.equal((await f.call(f.analysis())).status,409);assert.equal((await f.call({action:'entry',entry:{date:'2026-09-13',version:2,complete:true,journal:'overwrite',context:{},statuses:[]}})).status,409);
 assert.equal((await (await f.call({action:'history',filters:{}},'b')).json()).entries.length,1);
 validateBackup(await (await f.call(null,'a','?export')).text());await f.call(remove('entry','2026-09-13',false,2));assert.equal((await (await f.call({action:'history',filters:{}})).json()).entries[0].complete,true);
});

test('deleted analyses keep usage and revision keys, stay out of future context, and export with Restore markers',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');const first=await (await f.call(f.analysis())).json(),id=first.report.id;
 assert.equal((await f.call(remove('analysis',id),'b')).status,404);assert.equal((await f.call(remove('analysis',id))).status,200);
 const list=await (await f.call(null,'a','?ai=1&date=2026-09-13')).json();assert.equal(list.reports[0].deleted,true);assert.equal(list.usage.measuredMicros,500);
 const regen={...f.analysis(),review:{...f.analysis().review,predecessorId:id}};assert.equal((await f.call(regen)).status,200);assert.equal(f.state.calls.at(-1).input.previousReview,null);assert.equal(f.state.calls.at(-1).input.previousReviewExcluded,true);
 validateBackup(await (await f.call(null,'a','?export')).text());await f.call(remove('analysis',id,false));assert.equal((await (await f.call(null,'a','?ai=1&date=2026-09-13')).json()).reports.find(r=>r.id===id).deleted,false);
});

test('deleted unconfirmed AI jobs retain reservations and cannot bypass daily limits or resend',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=()=>{throw Error('Synthetic failure');};const body=write();assert.equal((await f.call(body)).status,502);
 await f.call(remove('build','workout:'+body.build.requestId));assert.equal((await f.call(write())).status,429);assert.equal((await (await f.call(body)).json()).build.status,'uncertain');assert.equal(f.state.calls.length,1);assert.equal(f.raw.prepare('SELECT reserved_micros FROM life_ai_usage').get().reserved_micros,RESERVATION_MICROS);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('deleting an analysis cancels queued email and restoring it never reenqueues that delivery',async t=>{
 const f=fixture(t);await f.setup();const first=await (await f.call(f.analysis())).json();
 // Build an eligible synthetic outbox by using the same schema defaults as the email tests.
 f.raw.prepare("INSERT INTO life_email_outbox(user_id,request_id,consent_version,state,created_at,next_attempt_at) VALUES('a',?,1,'pending',?,?)").run(first.report.id,now.toISOString(),now.toISOString());
 await f.call(remove('analysis',first.report.id));assert.equal(f.raw.prepare('SELECT state FROM life_email_outbox').get().state,'cancelled');
 await f.call(remove('analysis',first.report.id,false));assert.equal(f.raw.prepare('SELECT state FROM life_email_outbox').get().state,'cancelled');
});

import {parseWorkoutDraft,workoutOutputSchema} from '../lib/life/workout-ai-schema.ts';

test('workout provider enforces JSON schema and fenced JSON keeps completed facts intact',async()=>{
 let body;
 const provider=geminiProvider('synthetic',async(url,options)=>{body=JSON.parse(options.body);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(written)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:10,totalTokenCount:110}});});
 await provider.generate('Synthetic completed workout','workout');
 assert.deepEqual(body.generationConfig.responseFormat.text,{mimeType:'application/json',schema:workoutOutputSchema});assert.equal(body.generationConfig.candidateCount,1);
 const draft=parseWorkoutDraft('```json\n'+JSON.stringify(written)+'\n```',now.toISOString());assert.equal(draft.workout.sets.length,4);assert.equal(draft.workout.sets[0].warmup,true);assert.equal(draft.workout.sets[1].load,135);
 assert.throws(()=>parseWorkoutDraft('Here is your workout:\n'+JSON.stringify(written),now.toISOString()));
 assert.throws(()=>parseWorkoutDraft('```json\n'+JSON.stringify(written)+'\n``` trailing text',now.toISOString()));
 assert.equal(parseWorkoutDraft(JSON.stringify({notes:'No explicit loads or reps.',name:'Unstructured',exercises:[]}),now.toISOString()).workout,null);
 await provider.generate('Synthetic analysis','training');assert.equal(body.generationConfig.responseFormat,undefined);
});

test('workout failures distinguish invalid JSON, invalid structure and truncation without retaining raw output',async t=>{
 for(const [text,finishReason,code] of [['broken','STOP','invalid_workout_json'],['{}','STOP','invalid_workout_schema'],[JSON.stringify(written),'MAX_TOKENS','workout_output_truncated']]){
  const f=fixture(t);await f.setup();f.state.result={...providerResult,text,finishReason};const result=await (await f.call(write())).json();assert.equal(result.build.errorCode,code);assert.equal(result.build.result,null);assert.equal(f.state.calls.length,1);
  const usage=f.raw.prepare('SELECT cost_micros,status FROM life_ai_usage').get();assert.equal(usage.cost_micros,500);assert.equal(usage.status,'failed');
 }
});
async function recoveryFixture(t,exhaust=true){
 const f=fixture(t);await f.setup();await f.setup('b');f.state.result={...providerResult,text:'invalid'};const failed=write();await f.call(failed);
 if(exhaust){await f.call(write());f.state.result=providerResult;await f.call(f.build());await f.call(f.build());await f.call(f.analysis());}
 const sourceId=failed.build.requestId,grant={sourceId,expiresAt:'2026-09-15T12:00:00.000Z'};
 f.raw.prepare("INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at) VALUES('a','ai-recovery',?,'',?,1,?)").run(sourceId,JSON.stringify(grant),now.toISOString());
 f.state.result={...providerResult,text:JSON.stringify(written)};
 return {...f,sourceId,grant,retry:{action:'workout-build',build:{...failed.build,requestId:randomUUID(),recoveryOf:sourceId}}};
}
test('one recovery crosses only the two count limits, keeps costs, and is idempotent even after hiding the result',async t=>{
 const f=await recoveryFixture(t);assert.equal(f.state.calls.length,5);assert.equal((await f.call(write())).status,429);
 const available=await (await f.call(null,'a','?workout-builds')).json();assert.equal(available.recovery.sourceId,f.sourceId);assert.equal((await (await f.call(null,'b','?workout-builds')).json()).recovery,null);
 const before=f.raw.prepare('SELECT SUM(cost_micros) n FROM life_ai_usage').get().n;
 const [one,two]=await Promise.all([f.call(f.retry),f.call({...f.retry,build:{...f.retry.build,requestId:randomUUID()}})]);assert.equal(one.status,200);assert.equal(two.status,429);
 const result=await one.json();assert.equal(result.build.status,'complete');assert.deepEqual(await (await f.call(f.retry)).json(),result);assert.equal(f.state.calls.length,6);
 assert.equal(f.raw.prepare('SELECT SUM(cost_micros) n FROM life_ai_usage').get().n,before+500);assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM life_routine_builds WHERE status='failed'").get().n,2);
 assert.equal((await (await f.call(null,'a','?workout-builds')).json()).recovery,null);
 await f.call(remove('build','workout:'+f.retry.build.requestId));
 // Consumption persists across daily count resets and hiding records.
 f.raw.prepare("UPDATE life_routine_builds SET created_at='2026-09-13T12:00:00.000Z'").run();
 assert.equal((await f.call({...f.retry,build:{...f.retry.build,requestId:randomUUID()}})).status,429);
 assert.equal((await f.call({...f.retry,build:{...f.retry.build,recoveryOf:randomUUID()}})).status,409);
 validateBackup(await (await f.call(null,'a','?export')).text());
});
test('recovery requires operator grant, matching account and text, valid expiry, caps and circuit breaker',async t=>{
 const f=await recoveryFixture(t,false);
 assert.equal((await f.call({action:'resource',record:{kind:'ai-recovery',id:f.sourceId,version:0,data:f.grant}})).status,400);
 assert.equal((await f.call(f.retry,'b')).status,429);
 assert.equal((await f.call({...f.retry,build:{...f.retry.build,text:'A different completed workout.'}})).status,429);
 assert.equal((await f.call({...f.retry,build:{...f.retry.build,recoveryOf:randomUUID()}})).status,429);
 f.raw.prepare("UPDATE life_resources SET payload=json_set(payload,'$.expiresAt','2026-09-14T11:59:59.000Z') WHERE kind='ai-recovery'").run();assert.equal((await f.call(f.retry)).status,429);
 f.raw.prepare("UPDATE life_resources SET payload=? WHERE kind='ai-recovery'").run(JSON.stringify(f.grant));
 f.ai.userCapMicros=200000;assert.equal((await f.call(f.retry)).status,429);f.ai.userCapMicros=1000000;
 f.ai.globalCapMicros=200000;assert.equal((await f.call(f.retry)).status,429);f.ai.globalCapMicros=5000000;
 f.raw.prepare("UPDATE life_routine_builds SET error_code='cost_bound_exceeded' WHERE request_id=?").run('workout:'+f.sourceId);assert.equal((await f.call(f.retry)).status,429);
 assert.equal(f.state.calls.length,1);
});
test('a failed or uncertain recovery is consumed and cannot be retried as a new paid request',async t=>{
 for(const uncertain of [false,true]){
  const f=await recoveryFixture(t,false);f.state.result={...providerResult,text:'invalid'};if(uncertain)f.state.hook=()=>{throw Error('Synthetic network uncertainty');};
  assert.equal((await f.call(f.retry)).status,uncertain?502:200);assert.equal((await (await f.call(null,'a','?workout-builds')).json()).recovery,null);
  assert.equal((await f.call({...f.retry,build:{...f.retry.build,requestId:randomUUID()}})).status,429);assert.equal(f.state.calls.length,2);
  if(uncertain)assert.equal(f.raw.prepare("SELECT reserved_micros FROM life_ai_usage WHERE status='uncertain'").get().reserved_micros,RESERVATION_MICROS);
  validateBackup(await (await f.call(null,'a','?export')).text());
 }
});
