import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleLife} from '../lib/life/service.ts';
import {presetExercise} from '../lib/life/exercise-presets.ts';
import {workoutSchema,workoutExercises,workoutTotals,nextSet} from '../lib/life/modules.ts';
import {createWorkoutSession,appendWorkoutExercise,reviseWorkoutSet,removeWorkoutSet,definiteWorkoutRejection} from '../lib/life/workout-session.ts';
import {historyInWorkout,performanceInWorkout} from '../lib/life/exercise-performance.ts';
import {recordedVolume,plannedVolume} from '../lib/life/muscle-volume.ts';
import {buildReviewContext} from '../lib/life/review-context.ts';
import {profileSchema} from '../lib/life/domain.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
import {freshOfflineData,cacheRead,prepareLocalWrite,projectRead,replayLocalWrites} from '../lib/life/offline-queue.ts';

const now=new Date('2026-10-02T12:00:00.000Z');
function program(){return {id:randomUUID(),version:0,data:{name:'Original plan',preferences:'Keep saved preference',weeklySessions:2,archived:false,exercises:[{...presetExercise('Bench press'),sets:1}]}};}
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body=null,user='a',path='')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,now);
 const setup=(user='a')=>call({action:'profile',profile:{goal:'',timezone:'UTC',modules:['fitness'],habits:[],version:0}},user);
 const save=(kind,{id,version,data},user='a')=>call({action:'resource',record:{kind,id,version,data}},user);
 return {raw,call,setup,save};
}

test('adding an actual exercise keeps the original plan and automatic next target unchanged',()=>{
 const routine=program(),workout=createWorkoutSession(routine,'2026-10-02').data,original=structuredClone(workout.exercises),added={...presetExercise('Hammer curl'),unit:'kg',load:14};
 const changed=appendWorkoutExercise(workout,added,{reps:11,load:14,warmup:false},now.toISOString());
 assert.deepEqual(changed.exercises,original);assert.equal(workout.additionalExercises,undefined);assert.equal(changed.sets[0].workingSetNumber,1);assert.equal(changed.sets[0].setNumber,1);
 assert.deepEqual(workoutExercises(changed).map(e=>e.id),[original[0].id,added.id]);assert.equal(nextSet(changed).exercise.id,original[0].id);
 const completed=reviseWorkoutSet(changed,{exerciseId:original[0].id,reps:8,load:100,warmup:false},now.toISOString());
 assert.equal(nextSet(completed),null,'an additional definition never becomes a planned target');
 added.name='Mutated input';assert.equal(changed.additionalExercises[0].name,'Hammer curl');assert.equal(routine.data.exercises.length,1);
 const replacement=reviseWorkoutSet(removeWorkoutSet(changed,added.id,1),{exerciseId:added.id,reps:12,load:15,warmup:false},now.toISOString());
 assert.equal(replacement.sets[0].setNumber,2,'retired additional-set identities are never reused');assert.equal(replacement.sets[0].workingSetNumber,1);
});

test('combined snapshots retain exercise, working-set, warm-up and retired-serial bounds',()=>{
 const workout=createWorkoutSession(program(),'2026-10-02').data,exercise=presetExercise('Cable curl');
 let changed=appendWorkoutExercise(workout,exercise,{reps:0,load:12,warmup:false},now.toISOString());
 assert.throws(()=>appendWorkoutExercise(changed,exercise,{reps:8,load:12,warmup:false}),/own identity/);
 assert.equal(workoutSchema.safeParse({...changed,skippedSets:[{exerciseId:exercise.id,workingSetNumber:2}]}).success,false,'only original planned sets can be skipped');
 assert.equal(workoutSchema.safeParse({...changed,lastSetSerials:[{exerciseId:exercise.id,setNumber:0}]}).success,false);
 for(let index=1;index<20;index++)changed=reviseWorkoutSet(changed,{exerciseId:exercise.id,reps:8,load:12,warmup:false},now.toISOString());
 assert.throws(()=>reviseWorkoutSet(changed,{exerciseId:exercise.id,reps:8,load:12,warmup:false},now.toISOString()));
 for(let index=0;index<20;index++)changed=reviseWorkoutSet(changed,{exerciseId:exercise.id,reps:8,load:5,warmup:true},now.toISOString());
 assert.throws(()=>reviseWorkoutSet(changed,{exerciseId:exercise.id,reps:8,load:5,warmup:true},now.toISOString()),/40 set identities/);
 assert.equal(reviseWorkoutSet(changed,{exerciseId:exercise.id,setNumber:1,reps:10,load:12,warmup:false},now.toISOString()).sets.length,40);
 let full=workout;
 for(let index=0;index<29;index++)full=appendWorkoutExercise(full,presetExercise('Cable curl'),{reps:8,load:12,warmup:false},now.toISOString());
 assert.equal(workoutExercises(full).length,30);assert.throws(()=>appendWorkoutExercise(full,presetExercise('Cable curl'),{reps:8,load:12,warmup:false}),/30 exercises/);
 assert.equal(workoutSchema.safeParse({...full,additionalExercises:[...full.additionalExercises,presetExercise('Cable curl')]}).success,false);
 assert.equal(workoutSchema.safeParse({...full,additionalExercises:[{...full.additionalExercises[0],id:full.exercises[0].id},...full.additionalExercises.slice(1)]}).success,false);
});

test('additional actuals reach totals, muscle coverage, previous performance and analysis without changing planned volume',()=>{
 const routine=program(),exercise={...presetExercise('Hammer curl'),unit:'kg',load:14};
 let data=appendWorkoutExercise(createWorkoutSession(routine,'2026-10-02').data,exercise,{reps:11,load:14,warmup:false},now.toISOString());
 data=reviseWorkoutSet(data,{exerciseId:exercise.id,reps:5,load:5,warmup:true},now.toISOString());data={...data,finishedAt:now.toISOString()};
 const record={id:randomUUID(),version:1,data},volume=recordedVolume([record],'2026-10-02','2026-10-02');
 assert.equal(volume.sets,1);assert.equal(volume.warmups,1);assert.equal(volume.muscles.biceps.direct,1);assert.equal(volume.muscles.forearms.indirect,1);
 assert.equal(plannedVolume([routine]).sets,2);assert.equal(workoutTotals(data).volume.find(e=>e.id===exercise.id).volume,179);
 const history=historyInWorkout(record,'Hammer curl');assert.equal(history.unit,'kg');assert.equal(history.sets.length,1);assert.equal(history.sets[0].load,14);
 assert.equal(performanceInWorkout(record,'Hammer curl',1).performance.reps,11);assert.deepEqual(performanceInWorkout(record,'Hammer curl',2),{matched:true,performance:null});
 const profile=profileSchema.parse({goal:'',timezone:'UTC',modules:['fitness'],habits:[],version:1});
 const context=buildReviewContext({profile,from:'2026-10-02',through:'2026-10-02',entries:[],workouts:[record]});
 assert.equal(context.workouts[0].exercises[1].id,exercise.id);assert.equal(context.trainingVolume.workingSets,1);
});

test('server atomically adds frozen snapshots with exact retries, export and account isolation',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');
 const routine=(await (await f.save('routine',program())).json()).record;
 let saved=(await (await f.save('workout',createWorkoutSession(routine,'2026-10-02'))).json()).record;
 const exercise={...presetExercise('Hammer curl'),unit:'kg',load:14},frozen={...saved,data:{...appendWorkoutExercise(saved.data,exercise,{reps:11,load:14,warmup:false},now.toISOString()),finishedAt:now.toISOString(),notes:'Extra curls after the planned work.'}};
 const response=await f.save('workout',frozen);assert.equal(response.status,200);saved=(await response.json()).record;
 assert.deepEqual((await (await f.save('workout',frozen)).json()).record,saved);assert.deepEqual(saved.data.exercises,routine.data.exercises);assert.equal(saved.data.additionalExercises.length,1);
 assert.equal((await f.save('workout',frozen,'b')).status,400,'another account cannot adopt this session or its routine');
 assert.equal((await (await f.call(null,'b','?kind=workout')).json()).records.length,0);
 const summary=await (await f.call(null,'a','?training-summary')).json();assert.equal(summary.current.sets,1);assert.equal(summary.current.muscles.biceps.direct,1);
 const backup=validateBackup(await (await f.call(null,'a','?export')).text()),exported=JSON.parse(backup.resources.find(record=>record.resource_id===saved.id).payload);
 assert.deepEqual(exported.additionalExercises,saved.data.additionalExercises);assert.deepEqual(exported.lastSetSerials,saved.data.lastSetSerials);
 assert.equal((await f.save('workout',{...saved,data:{...saved.data,additionalExercises:[{...exercise,load:25}]}})).status,400,'an acknowledged additional snapshot cannot be edited');
 assert.equal((await f.save('workout',{...saved,data:{...saved.data,additionalExercises:[],sets:[],lastSetSerials:[]}})).status,400,'an acknowledged additional definition cannot be removed');
 const unlogged=presetExercise('Cable curl');assert.equal((await f.save('workout',{...saved,data:{...saved.data,additionalExercises:[exercise,unlogged]}})).status,400,'a newly appended exercise needs an actual set in the same write');
 const removed=(await (await f.save('workout',{...saved,data:removeWorkoutSet(saved.data,exercise.id,1)})).json()).record;
 assert.equal(removed.data.additionalExercises.length,1);assert.equal(removed.data.finishedAt,now.toISOString());
 assert.equal((await f.save('workout',frozen)).status,409,'stale retry cannot resurrect a removed actual set');
 const newLog={...removed,data:reviseWorkoutSet(removed.data,{exerciseId:exercise.id,reps:12,load:14,warmup:false},now.toISOString())};
 assert.equal(newLog.data.sets[0].setNumber,2);assert.equal((await f.save('workout',newLog)).status,200);
});

test('fresh starts reject additional definitions and previous-performance reads include owned extra work',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');
 const routine=(await (await f.save('routine',program())).json()).record,extra=presetExercise('Hammer curl'),fresh=createWorkoutSession(routine,'2026-10-02');
 assert.equal((await f.save('workout',{...fresh,data:{...fresh.data,additionalExercises:[extra]}})).status,400);
 let prior=(await (await f.save('workout',fresh)).json()).record;
 prior=(await (await f.save('workout',{...prior,data:{...appendWorkoutExercise(prior.data,extra,{reps:9,load:20,warmup:false},now.toISOString()),finishedAt:now.toISOString()}})).json()).record;
 const nextRoutine=(await (await f.save('routine',{id:randomUUID(),version:0,data:{name:'Curl plan',preferences:'',archived:false,exercises:[presetExercise('Hammer curl')]}})).json()).record;
 const active=(await (await f.save('workout',createWorkoutSession(nextRoutine,'2026-10-02'))).json()).record;
 const path='?'+new URLSearchParams({'exercise-performance':'1',workoutId:active.id,exerciseId:active.data.exercises[0].id,workingSetNumber:'1'});
 assert.equal((await (await f.call(null,'a',path)).json()).performance.workoutId,prior.id);
 assert.equal((await f.call(null,'b',path)).status,404);
});

test('lost supplemental acknowledgements reconcile as version conflicts after another tab appends or logs more work',async t=>{
 const f=fixture(t);await f.setup();
 const routine=(await (await f.save('routine',program())).json()).record,first=(await (await f.save('workout',createWorkoutSession(routine,'2026-10-02'))).json()).record;
 const curl=presetExercise('Hammer curl'),cable=presetExercise('Cable curl'),frozenFirst={...first,data:appendWorkoutExercise(first.data,curl,{reps:10,load:20,warmup:false},now.toISOString())},firstBytes=JSON.stringify(frozenFirst);
 const second=(await (await f.save('workout',frozenFirst)).json()).record;
 assert.deepEqual((await (await f.save('workout',frozenFirst)).json()).record,second,'an exact lost-ack retry succeeds before intervening edits');
 const frozenSecond={...second,data:appendWorkoutExercise(second.data,cable,{reps:10,load:15,warmup:false},now.toISOString())},secondBytes=JSON.stringify(frozenSecond),third=(await (await f.save('workout',frozenSecond)).json()).record;
 const snapshotConflict=await f.save('workout',frozenFirst);assert.equal(snapshotConflict.status,409,'another tab added a supplemental snapshot after the lost save');
 assert.equal(definiteWorkoutRejection(snapshotConflict.status,true,frozenFirst.version),false,'a conflict alone does not release the unknown write');
 const current=(await (await f.call(null,'a','?kind=workout')).json()).records.find(record=>record.id===first.id);
 assert.deepEqual(current,third);assert.equal(definiteWorkoutRejection(snapshotConflict.status,true,frozenFirst.version,current.version),true,'read-only newer-version evidence permits explicit reconciliation');
 assert.equal(JSON.stringify(frozenFirst),firstBytes,'the frozen retry is never merged or rewritten');
 assert.equal((await f.save('workout',{...third,data:{...third.data,additionalExercises:third.data.additionalExercises.slice(0,1),sets:third.data.sets.filter(set=>set.exerciseId===curl.id),lastSetSerials:third.data.lastSetSerials.filter(serial=>serial.exerciseId===curl.id)}})).status,400,'current-version deletion of a frozen added definition remains invalid');
 const unloggedAppend={...third,data:{...third.data,additionalExercises:[...third.data.additionalExercises,presetExercise('Squat')]}};
 assert.equal((await f.save('workout',unloggedAppend)).status,400,'a current-version append still requires actual work atomically');
 assert.equal((await f.save('workout',{...unloggedAppend,version:third.version-1})).status,409,'an obsolete version reconciles before judging its missing actuals');
 const fourth=(await (await f.save('workout',{...third,data:reviseWorkoutSet(third.data,{exerciseId:curl.id,reps:9,load:20,warmup:false},now.toISOString())})).json()).record;
 const serialConflict=await f.save('workout',frozenSecond);assert.equal(serialConflict.status,409,'the newer working set increased the retired-serial floor');
 assert.equal(JSON.stringify(frozenSecond),secondBytes);assert.equal(definiteWorkoutRejection(serialConflict.status,true,frozenSecond.version,fourth.version),true);
 const invalidCurrent={...fourth,data:{...fourth.data,sets:fourth.data.sets.filter(set=>set.exerciseId!==curl.id||set.setNumber!==2),lastSetSerials:fourth.data.lastSetSerials.map(serial=>serial.exerciseId===curl.id?{...serial,setNumber:1}:serial)}};
 assert.equal((await f.save('workout',invalidCurrent)).status,400,'a current-version correction cannot lower retired set identities');
 const records=(await (await f.call(null,'a','?kind=workout')).json()).records;assert.deepEqual(records.find(record=>record.id===first.id),fourth,'rejected stale and invalid attempts never replace either tab’s saved work');
});

test('offline supplemental saves preserve the complete account-bound snapshot and exact replay bytes',async()=>{
 const routine=program(),original={...createWorkoutSession(routine,'2026-10-02'),version:1},exercise=presetExercise('Hammer curl');
 const data=appendWorkoutExercise(original.data,exercise,{reps:10,load:20,warmup:false},now.toISOString()),state=freshOfflineData('synthetic-account');
 cacheRead(state,'/api/life?kind=workout',{records:[original]});
 const body=JSON.stringify({action:'resource',record:{kind:'workout',id:original.id,version:original.version,data}}),write=prepareLocalWrite(state,'/api/life',body,now);
 assert.ok(write);state.writes.push(write);const restored=JSON.parse(JSON.stringify(state)),projected=projectRead(restored,'/api/life?kind=workout').records[0];
 assert.deepEqual(projected.data.exercises,original.data.exercises);assert.deepEqual(projected.data.additionalExercises,data.additionalExercises);assert.deepEqual(projected.data.lastSetSerials,data.lastSetSerials);
 const sent=[],stored=[],result=await replayLocalWrites(restored,async(url,text)=>{sent.push([url,text]);if(text)assert.equal(stored.at(-1).writes[0].attempted,true);return Response.json(text?restored.writes[0].result:{},{headers:{'X-Life-Account':'synthetic-account'}});},async()=>{stored.push(structuredClone(restored));});
 assert.equal(result.paused,'');assert.equal(restored.writes.length,0);assert.deepEqual(sent,[['/api/life?offline-account=1',undefined],['/api/life',body]]);assert.deepEqual(projectRead(restored,'/api/life?kind=workout').records[0].data,JSON.parse(body).record.data);
});
