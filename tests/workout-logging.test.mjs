import {buildRoutines} from '../lib/life/routine-builder.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {renderReportMarkdown} from '../lib/life/report-markdown.ts';
import {reportEmail} from '../lib/life/email-service.ts';
import {exercisePresets,presetExercise,repTarget} from '../lib/life/exercise-presets.ts';
import {exerciseSchema,workoutSchema,nextSet,structuredWorkoutSchema,workoutTotals} from '../lib/life/modules.ts';
import {createWorkoutSession,extendWorkoutRest,skipCurrentSet,sameRoutinePlan,definiteWorkoutRejection} from '../lib/life/workout-session.ts';
import {copyRoutineDraft} from '../lib/life/routine-recovery.ts';
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
 // Legacy organizer internals remain covered; the public route is disabled in trash tests.
 const call=(body,id='a',path='')=>body?.action==='workout-build'?buildRoutines(db,id,body.build,ai,now,'workout'):handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),id,db,now,ai);
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

test('skipped planned targets advance without fabricated work, preserve warm-up serials and survive corrections',()=>{
 const first={...presetExercise('Bench press'),sets:3},second={...presetExercise('Lat pulldown'),sets:1};
 let workout={date:'2026-09-14',routineId:randomUUID(),name:'Skip flow',exercises:[first,second],sets:[],restUntil:'2026-09-14T12:01:00.000Z',finishedAt:null};
 const initial=structuredClone(workout);
 workout=skipCurrentSet(workout);
 assert.deepEqual(initial.sets,[]);assert.equal(initial.skippedSets,undefined);
 assert.deepEqual(workout.skippedSets,[{exerciseId:first.id,workingSetNumber:1}]);
 assert.equal(workout.restUntil,null);assert.equal(workout.finishedAt,null);
 assert.equal(nextSet(workout).workingSetNumber,2);assert.equal(nextSet(workout).setNumber,1);
 workout.sets.push({exerciseId:first.id,setNumber:1,reps:8,load:45,warmup:true,completedAt:now.toISOString()});
 assert.equal(nextSet(workout).workingSetNumber,2);assert.equal(nextSet(workout).setNumber,2);
 workout.sets.push({exerciseId:first.id,setNumber:2,reps:6,load:135,warmup:false,completedAt:now.toISOString()});
 assert.equal(nextSet(workout).workingSetNumber,3);
 workout=workoutSchema.parse(JSON.parse(JSON.stringify(skipCurrentSet(workout))));
 assert.equal(nextSet(workout).exercise.id,second.id);assert.equal(nextSet(workout).setNumber,1);
 assert.equal(recordedVolume([{id:randomUUID(),version:1,data:workout}],'2026-09-14','2026-09-14').sets,1);
 assert.equal(workoutTotals(workout).sets,2);assert.equal(workoutTotals(workout).reps,14);
 workout.sets[1].warmup=true;
 assert.equal(nextSet(workout).exercise.id,first.id);assert.equal(nextSet(workout).workingSetNumber,2);assert.equal(nextSet(workout).setNumber,3);
 workout.sets[1].warmup=false;
 workout=skipCurrentSet(workout);
 assert.equal(nextSet(workout),null);assert.equal(workout.finishedAt,null);
 assert.throws(()=>skipCurrentSet(workout),/no remaining sets/);
 assert.throws(()=>skipCurrentSet({...initial,finishedAt:now.toISOString()}),/active workout/);
 assert.throws(()=>skipCurrentSet({...initial,deleted:true}),/active workout/);
 const empty=skipCurrentSet({...initial,exercises:[second],restUntil:null});
 assert.deepEqual(workoutTotals(empty),{sets:0,reps:0,volume:[{id:second.id,name:second.name,unit:second.unit,volume:0}]});
});

test('skip validation rejects duplicate, unknown and out-of-plan targets and combined over-completion',()=>{
 const e={...presetExercise('Bench press'),sets:2};
 const workout={date:'2026-09-14',routineId:randomUUID(),name:'Skip validation',exercises:[e],sets:[],restUntil:null,finishedAt:null};
 const valid={exerciseId:e.id,workingSetNumber:1};
 for(const skippedSets of [[valid,valid],[{...valid,exerciseId:randomUUID()}],[{...valid,workingSetNumber:0}],[{...valid,workingSetNumber:3}],[{...valid,workingSetNumber:1.5}],[{...valid,reps:0}]])assert.equal(workoutSchema.safeParse({...workout,skippedSets}).success,false);
 const actual=n=>({exerciseId:e.id,setNumber:n,reps:8,load:100,warmup:false,completedAt:now.toISOString()});
 assert.equal(workoutSchema.safeParse({...workout,skippedSets:[valid],sets:[actual(1),actual(2)]}).success,false);
 const manyWarmups={...workout,skippedSets:[valid],sets:Array.from({length:20},(_,i)=>({...actual(i+1),warmup:true}))};
 assert.equal(workoutSchema.safeParse(manyWarmups).success,true);
 assert.equal(nextSet(manyWarmups).setNumber,21);assert.equal(nextSet(manyWarmups).workingSetNumber,2);
 assert.equal(workoutSchema.safeParse(workout).success,true);
});

test('skip writes retain exact retry, reload and export state without changing actual totals or finishing',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');
 const routine={id:randomUUID(),version:0,data:{name:'Skip session',preferences:'',archived:false,exercises:[{...presetExercise('Bench press'),sets:2}]}};
 const savedRoutine=(await (await f.call({action:'resource',record:{kind:'routine',...routine}})).json()).record;
 const save=({id,version,data},account='a')=>f.call({action:'resource',record:{kind:'workout',id,version,data}},account);
 const draft=createWorkoutSession(savedRoutine,'2026-09-14');
 assert.equal((await save({...draft,data:skipCurrentSet(draft.data)})).status,400);
 const saved=(await (await save(draft)).json()).record;
 const skipped={...saved,data:skipCurrentSet({...saved.data,restUntil:'2026-09-14T12:01:00.000Z'})};
 const response=await save(skipped);assert.equal(response.status,200);
 const confirmed=(await response.json()).record;
 assert.equal(confirmed.version,2);assert.deepEqual((await (await save(skipped)).json()).record,confirmed);
 assert.equal((await save(skipped,'b')).status,400);
 const reload=(await (await f.call(null,'a','?kind=workout')).json()).records[0];
 assert.deepEqual(reload,confirmed);assert.equal(nextSet(reload.data).workingSetNumber,2);
 assert.deepEqual(reload.data.exercises,saved.data.exercises);assert.deepEqual(reload.data.sets,[]);
 assert.equal((await save({...saved,data:{...saved.data,restUntil:null}})).status,409);
 assert.equal((await (await f.call(null,'a','?training-summary')).json()).current.sets,0);
 assert.equal(f.raw.prepare("SELECT active_slot FROM life_resources WHERE resource_id=?").get(saved.id).active_slot,'active');
 const allSkipped=(await (await save({...confirmed,data:skipCurrentSet(confirmed.data)})).json()).record;
 assert.equal(nextSet(allSkipped.data),null);assert.equal(allSkipped.data.finishedAt,null);
 assert.equal(f.raw.prepare("SELECT active_slot FROM life_resources WHERE resource_id=?").get(saved.id).active_slot,'active');
 const exported=await (await f.call(null,'a','?export')).text();validateBackup(exported);
 assert.ok(exported.includes('skippedSets'));
 const finished=(await (await save({...allSkipped,data:{...allSkipped.data,finishedAt:now.toISOString()}})).json()).record;
 assert.deepEqual(finished.data.skippedSets,allSkipped.data.skippedSets);
 assert.equal(f.raw.prepare("SELECT active_slot FROM life_resources WHERE resource_id=?").get(saved.id).active_slot,null);
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

test('unchanged session previews normalize property order and absent optional fields without hiding real or invalid edits',()=>{
 const first=presetExercise('Bench press'),legacy=presetExercise('Lat pulldown');
 delete legacy.repMax;delete legacy.muscles;
 const saved={name:'Saved template',preferences:'',archived:false,exercises:[first,legacy]};
 const reverseKeys=value=>Object.fromEntries(Object.entries(value).reverse());
 const preview=reverseKeys({...saved,weeklySessions:undefined,exercises:[reverseKeys({...first,muscles:reverseKeys(first.muscles)}),reverseKeys({...legacy,repMax:undefined,muscles:undefined})]});
 assert.notEqual(JSON.stringify(saved),JSON.stringify(preview));
 assert.equal(sameRoutinePlan(saved,preview),true);
 assert.equal(sameRoutinePlan(preview,saved),true);
 for(const changed of [
  {...preview,name:'Today’s edited name'},
  {...preview,exercises:preview.exercises.map((exercise,index)=>index?exercise:{...exercise,load:exercise.load+5})},
  {...preview,exercises:preview.exercises.map((exercise,index)=>index?exercise:{...exercise,name:'Custom bench press'})},
  {...preview,exercises:[preview.exercises[0]]},
  {...preview,exercises:[...preview.exercises].reverse()},
  {...preview,weeklySessions:0}
 ])assert.equal(sameRoutinePlan(saved,changed),false);
 const invalid={...preview,exercises:[{...first,load:NaN},legacy]};
 assert.equal(sameRoutinePlan(saved,invalid),false);
 assert.equal(sameRoutinePlan(invalid,invalid),false);
 assert.equal(sameRoutinePlan(saved,undefined),false);
});

test('session preview order is a copied plan and rest extensions retain remaining time within the existing cap',()=>{
 const first=presetExercise('Bench press'),second=presetExercise('Lat pulldown');
 const routine={id:randomUUID(),version:1,data:{name:'Full body',preferences:'',archived:false,exercises:[first,second]}};
 const preview={...routine,data:{...routine.data,exercises:[second,first]}};
 const session=createWorkoutSession(preview,'2026-09-14');
 assert.deepEqual(session.data.exercises.map(e=>e.id),[second.id,first.id]);
 assert.deepEqual(session.data.exercises.map(e=>e.name),[second.name,first.name]);
 session.data.exercises[0].reps=99;
 assert.notEqual(preview.data.exercises[0].reps,99);
 assert.deepEqual(routine.data.exercises.map(e=>e.id),[first.id,second.id]);
 assert.throws(()=>createWorkoutSession({...preview,data:{...preview.data,exercises:[first,first]}},'2026-09-14'));
 assert.equal(extendWorkoutRest('2026-09-14T12:01:00.000Z',now.valueOf()),'2026-09-14T12:01:20.000Z');
 assert.equal(extendWorkoutRest('2026-09-14T11:59:00.000Z',now.valueOf()),'2026-09-14T12:00:20.000Z');
 assert.equal(extendWorkoutRest(null,now.valueOf()),'2026-09-14T12:00:20.000Z');
 assert.equal(extendWorkoutRest('2026-09-14T12:14:50.000Z',now.valueOf()),'2026-09-14T12:15:00.000Z');
 assert.throws(()=>extendWorkoutRest(null,now.valueOf(),NaN));
});

test('starting a reordered preview preserves the saved program and rejects duplicate exercises or later snapshot edits',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');
 const routine={id:randomUUID(),version:0,data:{name:'Preview program',preferences:'',archived:false,exercises:[presetExercise('Bench press'),presetExercise('Lat pulldown')]}};
 const savedRoutine=(await (await f.call({action:'resource',record:{kind:'routine',...routine}})).json()).record;
 const preview={...savedRoutine,data:{...savedRoutine.data,exercises:[...savedRoutine.data.exercises].reverse()}};
 const draft=createWorkoutSession(preview,'2026-09-14');
 const save=({id,version,data})=>f.call({action:'resource',record:{kind:'workout',id,version,data}});
 for(const exercises of [[],[preview.data.exercises[0],preview.data.exercises[0]]]){
  assert.equal((await save({...draft,id:randomUUID(),data:{...draft.data,exercises}})).status,400);
 }
 assert.equal((await f.call({action:'resource',record:{kind:'workout',...draft}},'b')).status,400);
 const response=await save(draft);assert.equal(response.status,200,await response.clone().text());
 const saved=(await response.json()).record;
 assert.deepEqual((await (await save(draft)).json()).record,saved);
 const routines=(await (await f.call(null,'a','?kind=routine')).json()).records;
 assert.deepEqual(routines[0].data.exercises.map(e=>e.id),routine.data.exercises.map(e=>e.id));
 const reloaded=(await (await f.call(null,'a','?kind=workout')).json()).records[0];
 assert.equal(nextSet(reloaded.data).exercise.id,preview.data.exercises[0].id);
 assert.equal((await save({...saved,data:{...saved.data,exercises:routines[0].data.exercises}})).status,400);
 assert.equal((await save({...saved,data:{...saved.data,exercises:saved.data.exercises.map((e,i)=>i?e:{...e,reps:e.reps+1})}})).status,400);
 assert.equal((await save(createWorkoutSession(savedRoutine,'2026-09-14'))).status,409);
 assert.equal((await f.call({action:'resource',record:{kind:'routine',id:savedRoutine.id,version:savedRoutine.version,data:{...savedRoutine.data,name:'Changed program',exercises:savedRoutine.data.exercises.map(e=>({...e,sets:2}))}}})).status,200);
 assert.deepEqual((await (await save(draft)).json()).record,saved);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('customized session snapshots add, remove and edit exercises without changing their saved template',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');
 const save=(kind,{id,version,data},account='a')=>f.call({action:'resource',record:{kind,id,version,data}},account);
 const confirmed=async(kind,record)=>{const response=await save(kind,record);assert.equal(response.status,200,await response.clone().text());return (await response.json()).record;};
 const template=await confirmed('routine',{id:randomUUID(),version:0,data:{name:'Saved template',preferences:'Original equipment',archived:false,exercises:[presetExercise('Bench press'),presetExercise('Lat pulldown')]}});
 const retained=template.data.exercises[1],added={...presetExercise('Squat'),sets:2,reps:5,repMax:8,load:22.5,unit:'kg',restSeconds:45};
 const preview={...template,data:{...template.data,name:'Today’s adjusted session',exercises:[added,{...retained,name:'Custom cable pull',sets:4,reps:9,repMax:12,load:62.5,unit:'lb',restSeconds:75,muscles:{direct:['lats'],indirect:['biceps']}}]}};
 const draft=createWorkoutSession(preview,'2026-09-14');
 assert.equal((await save('workout',draft,'b')).status,400);
 assert.equal((await save('workout',{...draft,data:{...draft.data,routineId:randomUUID()}})).status,400);
 const archived=await confirmed('routine',{id:randomUUID(),version:0,data:{...template.data,archived:true}});
 assert.equal((await save('workout',{...draft,data:{...draft.data,routineId:archived.id}})).status,400);
 for(const changed of [
  {exercises:[]},{exercises:[added,added]},{exercises:Array.from({length:31},()=>({...added,id:randomUUID()}))},
  {exercises:[{...added,sets:0}]},{exercises:[{...added,sets:21}]},{exercises:[{...added,reps:9,repMax:8}]},
  {exercises:[{...added,load:-1}]},{exercises:[{...added,unit:'oz'}]},{exercises:[{...added,restSeconds:901}]},
  {exercises:[{...added,muscles:{direct:['invented'],indirect:[]}}]},
  {sets:[{exerciseId:added.id,setNumber:1,reps:5,load:22.5,completedAt:now.toISOString()}]},
  {skippedSets:[{exerciseId:added.id,workingSetNumber:1}]},{restUntil:now.toISOString()},{finishedAt:now.toISOString()},{deleted:true}
 ])assert.equal((await save('workout',{...draft,data:{...draft.data,...changed}})).status,400,JSON.stringify(changed));
 const saved=await confirmed('workout',draft);
 assert.equal(saved.version,1);assert.deepEqual(await confirmed('workout',draft),saved);
 assert.deepEqual(saved.data.exercises,preview.data.exercises.map(e=>exerciseSchema.parse(e)));
 assert.equal(saved.data.name,preview.data.name);
 const routines=(await (await f.call(null,'a','?kind=routine')).json()).records;
 assert.deepEqual(routines.find(r=>r.id===template.id),template);
 const reloaded=(await (await f.call(null,'a','?kind=workout')).json()).records.find(w=>w.id===saved.id);
 assert.deepEqual(reloaded,saved);assert.equal(nextSet(reloaded.data).exercise.id,added.id);
 assert.equal((await save('workout',createWorkoutSession(template,'2026-09-14'))).status,409);
 const changedTemplate=await confirmed('routine',{...template,data:{...template.data,name:'Updated preset',exercises:[{...template.data.exercises[0],sets:1}]}});
 assert.equal(changedTemplate.version,2);
 assert.deepEqual(await confirmed('workout',draft),saved);
 for(const changed of [{name:'Altered session'},{date:'2026-09-13'},{routineId:archived.id},{exercises:changedTemplate.data.exercises},{exercises:[...saved.data.exercises].reverse()}])assert.equal((await save('workout',{...saved,data:{...saved.data,...changed}})).status,400);
 const logged={...saved,data:{...saved.data,sets:[{exerciseId:added.id,setNumber:1,reps:6,load:25,completedAt:now.toISOString()}]}};
 const result=await confirmed('workout',logged);assert.deepEqual(result.data.exercises,saved.data.exercises);
 assert.equal((await (await f.call(null,'a','?training-summary')).json()).current.sets,1);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('stale program drafts recover as explicit copies or a reviewed saved version without overwriting concurrent edits',async t=>{
 const f=fixture(t);await f.setup();
 const save=(kind,{id,version,data})=>f.call({action:'resource',record:{kind,id,version,data}});
 const confirmed=async(kind,record)=>{const response=await save(kind,record);assert.equal(response.status,200,await response.clone().text());return (await response.json()).record;};
 const original=await confirmed('routine',{id:randomUUID(),version:0,data:{name:'Shared program',preferences:'Original preference',archived:false,exercises:[presetExercise('Bench press')]}});
 const local={...structuredClone(original),data:{...structuredClone(original.data),name:'My edited program',exercises:original.data.exercises.map(exercise=>({...exercise,reps:7,repMax:11}))}};
 const remote=await confirmed('routine',{...original,data:{...original.data,preferences:'Saved elsewhere',exercises:original.data.exercises.map(exercise=>({...exercise,sets:2}))}});
 for(let i=0;i<2;i++)assert.equal((await save('routine',local)).status,409);
 const latest=(await (await f.call(null,'a','?kind=routine')).json()).records.find(record=>record.id===original.id);
 assert.equal(latest.version,remote.version);assert.equal(local.version,original.version);assert.equal(local.data.name,'My edited program');
 const frozenCopy=copyRoutineDraft(local),copied=await confirmed('routine',frozenCopy);
 assert.notEqual(copied.id,original.id);assert.notEqual(copied.data.exercises[0].id,original.data.exercises[0].id);assert.equal(copied.data.exercises[0].reps,7);assert.equal(copied.version,1);
 assert.deepEqual(await confirmed('routine',frozenCopy),copied,'lost copy acknowledgement retries the same identity');
 assert.deepEqual((await (await f.call(null,'a','?kind=routine')).json()).records.find(record=>record.id===original.id),remote);
 const resumed={...structuredClone(latest),data:{...structuredClone(latest.data),name:'Edited after reviewing latest'}};
 const saved=await confirmed('routine',resumed);assert.equal(saved.version,3);assert.equal(saved.data.preferences,'Saved elsewhere');assert.equal(saved.data.exercises[0].sets,2);
 assert.equal(f.raw.prepare("SELECT count(*) n FROM life_resources WHERE kind='routine'").get().n,2);assert.equal(f.state.calls.length,0);
});

test('lost workout and template acknowledgements remain frozen through an authentication rejection',async t=>{
 const f=fixture(t);await f.setup();
 const template={id:randomUUID(),version:0,data:{name:'Frozen template',preferences:'',archived:false,exercises:[presetExercise('Bench press')]}};
 const save=(kind,record,id='a')=>f.call({action:'resource',record:{kind,id:record.id,version:record.version,data:record.data}},id);
 const savedTemplate=(await (await save('routine',template)).json()).record;
 for(const [kind,record] of [['routine',copyRoutineDraft(savedTemplate)],['workout',createWorkoutSession(savedTemplate,'2026-09-14')]]){
  const frozen=structuredClone(record),committed=await save(kind,record);assert.equal(committed.status,200);const saved=(await committed.json()).record;
  // The first acknowledgement is lost; the next exact retry finds an expired session.
  const rejected=await save(kind,record,null);assert.equal(rejected.status,401);
  assert.equal(definiteWorkoutRejection(rejected.status,true,record.version),false);
  assert.deepEqual(record,frozen);const retried=await save(kind,record);assert.equal(retried.status,200);assert.deepEqual((await retried.json()).record,saved);
 }
 for(const status of [400,401,403,409,410,413,429])assert.equal(definiteWorkoutRejection(status,true,1),false);
 assert.equal(definiteWorkoutRejection(409,true,1,1),false);assert.equal(definiteWorkoutRejection(409,true,1,2),true);
 assert.equal(definiteWorkoutRejection(401,true,1,2),false);assert.equal(definiteWorkoutRejection(400,false,1),true);
 assert.equal(definiteWorkoutRejection(undefined,false,1),false);assert.equal(definiteWorkoutRejection(503,false,1),false);
});

test('a template conflict preserves an edited session for begin-without-save or save-as-new choices',async t=>{
 const f=fixture(t);await f.setup();
 const save=(kind,{id,version,data})=>f.call({action:'resource',record:{kind,id,version,data}});
 const confirmed=async(kind,record)=>{const response=await save(kind,record);assert.equal(response.status,200,await response.clone().text());return (await response.json()).record;};
 const template=await confirmed('routine',{id:randomUUID(),version:0,data:{name:'Template',preferences:'',archived:false,exercises:[presetExercise('Bench press')]}});
 const preview={...structuredClone(template),data:{...structuredClone(template.data),name:'Edited session',exercises:template.data.exercises.map(exercise=>({...exercise,sets:4}))}};
 const remote=await confirmed('routine',{...template,data:{...template.data,name:'Renamed elsewhere'}});
 assert.equal((await save('routine',preview)).status,409);
 const session=await confirmed('workout',createWorkoutSession(preview,'2026-09-14'));assert.equal(session.data.name,'Edited session');assert.equal(session.data.exercises[0].sets,4);
 assert.equal((await (await f.call(null,'a','?kind=routine')).json()).records.find(record=>record.id===template.id).data.name,remote.data.name);
 await confirmed('workout',{...session,data:{...session.data,finishedAt:now.toISOString()}});
 const frozenCopy=copyRoutineDraft(preview,'Separate template'),savedCopy=await confirmed('routine',frozenCopy);
 const next=await confirmed('workout',createWorkoutSession(savedCopy,'2026-09-14'));assert.equal(next.data.routineId,savedCopy.id);assert.equal(next.data.exercises[0].sets,4);
 assert.deepEqual(await confirmed('routine',frozenCopy),savedCopy);assert.equal(f.raw.prepare("SELECT count(*) n FROM life_resources WHERE kind='routine'").get().n,2);
});

test('saving a customized preview to its template or a new template remains a separate versioned write',async t=>{
 const f=fixture(t);await f.setup();
 const save=(kind,{id,version,data})=>f.call({action:'resource',record:{kind,id,version,data}});
 const confirmed=async(kind,record)=>{const response=await save(kind,record);assert.equal(response.status,200,await response.clone().text());return (await response.json()).record;};
 const original=await confirmed('routine',{id:randomUUID(),version:0,data:{name:'Original',preferences:'',archived:false,exercises:[presetExercise('Bench press')]}});
 const overwrite={...original,data:{...original.data,exercises:[{...original.data.exercises[0],sets:2,load:55}]}};
 const updated=await confirmed('routine',overwrite);assert.equal(updated.version,2);
 assert.deepEqual(await confirmed('routine',overwrite),updated);
 assert.equal((await save('routine',{...overwrite,data:{...overwrite.data,name:'Stale overwrite'}})).status,409);
 const copy={id:randomUUID(),version:0,data:{...updated.data,name:'New template',exercises:[...updated.data.exercises,presetExercise('Lat pulldown')]}};
 const created=await confirmed('routine',copy);assert.equal(created.version,1);
 assert.deepEqual(await confirmed('routine',copy),created);
 assert.equal((await (await f.call(null,'a','?kind=workout')).json()).records.length,0);
 const session=createWorkoutSession(created,'2026-09-14');
 const started=await confirmed('workout',session);assert.deepEqual(await confirmed('workout',session),started);
 assert.equal(started.data.routineId,created.id);assert.equal(started.data.exercises.length,2);
 const routines=(await (await f.call(null,'a','?kind=routine')).json()).records;
 assert.deepEqual(routines.find(r=>r.id===original.id),updated);assert.equal(routines.length,2);
});

test('warm-up, rest extend and skip, finish and cancel keep exact saves, resume state and active-slot accounting',async t=>{
 const f=fixture(t);await f.setup();
 const routine={id:randomUUID(),version:0,data:{name:'Session flow',preferences:'',archived:false,exercises:[{...presetExercise('Bench press'),sets:1}]}};
 const savedRoutine=(await (await f.call({action:'resource',record:{kind:'routine',...routine}})).json()).record;
 const save=({id,version,data})=>f.call({action:'resource',record:{kind:'workout',id,version,data}});
 const confirmed=async record=>{const response=await save(record);assert.equal(response.status,200,await response.clone().text());return (await response.json()).record;};
 let saved=await confirmed(createWorkoutSession(savedRoutine,'2026-09-14'));
 const target=nextSet(saved.data),warmup={exerciseId:target.exercise.id,setNumber:target.setNumber,reps:6,load:45,warmup:true,completedAt:now.toISOString()};
 saved=await confirmed({...saved,data:{...saved.data,sets:[warmup],restUntil:'2026-09-14T12:01:00.000Z'}});
 assert.equal(nextSet(saved.data).workingSetNumber,1);
 const extension={...saved,data:{...saved.data,restUntil:extendWorkoutRest(saved.data.restUntil,now.valueOf())}};
 saved=await confirmed(extension);
 assert.deepEqual(await confirmed(extension),saved);
 assert.equal(saved.version,3);
 assert.deepEqual(saved.data.sets,[warmup]);
 const reloaded=(await (await f.call(null,'a','?kind=workout')).json()).records[0];
 assert.equal(reloaded.data.restUntil,'2026-09-14T12:01:20.000Z');
 assert.equal(nextSet(reloaded.data).setNumber,2);
 const skip={...saved,data:{...saved.data,restUntil:null}};
 saved=await confirmed(skip);assert.deepEqual(await confirmed(skip),saved);
 assert.deepEqual(saved.data.sets,[warmup]);
 const working={...warmup,setNumber:2,warmup:false,reps:8,load:95};
 saved=await confirmed({...saved,data:{...saved.data,sets:[warmup,working]}});
 assert.equal(nextSet(saved.data),null);
 const finish={...saved,data:{...saved.data,finishedAt:now.toISOString(),restUntil:null}};
 saved=await confirmed(finish);assert.deepEqual(await confirmed(finish),saved);
 assert.equal(f.raw.prepare("SELECT active_slot FROM life_resources WHERE resource_id=?").get(saved.id).active_slot,null);
 assert.equal((await save({...saved,data:{...saved.data,finishedAt:null}})).status,400);
 assert.equal((await (await f.call(null,'a','?training-summary')).json()).current.sets,1);
 let cancelled=await confirmed(createWorkoutSession(savedRoutine,'2026-09-14'));
 cancelled=await confirmed({...cancelled,data:{...cancelled.data,sets:[working]}});
 assert.equal((await (await f.call(null,'a','?training-summary')).json()).current.sets,2);
 const cancel={...cancelled,data:{...cancelled.data,deleted:true,restUntil:null}};
 cancelled=await confirmed(cancel);assert.deepEqual(await confirmed(cancel),cancelled);
 assert.equal(f.raw.prepare("SELECT active_slot FROM life_resources WHERE resource_id=?").get(cancelled.id).active_slot,null);
 assert.equal((await (await f.call(null,'a','?training-summary')).json()).current.sets,1);
 const resumed=await confirmed(createWorkoutSession(savedRoutine,'2026-09-14'));
 assert.equal(resumed.data.finishedAt,null);
 assert.equal((await (await f.call(null,'a','?kind=workout')).json()).records[0].id,resumed.id);
 validateBackup(await (await f.call(null,'a','?export')).text());
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
 validateBackup(await (await f.call(null,'a','?export')).text());assert.equal((await f.call(remove('analysis',id,false))).status,410);assert.equal(f.raw.prepare('SELECT report_text FROM life_ai_reviews WHERE request_id=?').get(id).report_text,null);
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
 assert.equal(body.generationConfig.responseMimeType,'application/json');assert.deepEqual(body.generationConfig.responseJsonSchema,workoutOutputSchema);assert.equal(body.generationConfig.responseFormat,undefined);assert.equal(body.generationConfig.responseSchema,undefined);assert.equal(body.generationConfig.candidateCount,1);
 const draft=parseWorkoutDraft('```json\n'+JSON.stringify(written)+'\n```',now.toISOString());assert.equal(draft.workout.sets.length,4);assert.equal(draft.workout.sets[0].warmup,true);assert.equal(draft.workout.sets[1].load,135);
 assert.throws(()=>parseWorkoutDraft('Here is your workout:\n'+JSON.stringify(written),now.toISOString()));
 assert.throws(()=>parseWorkoutDraft('```json\n'+JSON.stringify(written)+'\n``` trailing text',now.toISOString()));
 assert.equal(parseWorkoutDraft(JSON.stringify({notes:'No explicit loads or reps.',name:'Unstructured',exercises:[]}),now.toISOString()).workout,null);
 await provider.generate('Synthetic analysis','training');assert.equal(body.generationConfig.responseFormat,undefined);assert.equal(body.generationConfig.responseMimeType,undefined);assert.equal(body.generationConfig.responseJsonSchema,undefined);
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
