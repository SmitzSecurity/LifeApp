import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {performanceInWorkout} from '../lib/life/exercise-performance.ts';
import {presetExercise} from '../lib/life/exercise-presets.ts';

const now='2026-09-16T12:00:00.000Z';
function session(name='Bench press',extra={}){
 const exercise={...presetExercise(name),sets:3};
 return {id:randomUUID(),version:1,data:{date:'2026-09-14',routineId:randomUUID(),name:'Push day',exercises:[exercise],sets:[{exerciseId:exercise.id,setNumber:1,reps:8,load:135,completedAt:'2026-09-14T12:00:00.000Z'}],restUntil:null,finishedAt:'2026-09-14T12:10:00.000Z',...extra}};
}
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const reads=[];
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){reads.push(sql);return {results:raw.prepare(sql).all(...params)};}};}};}};
 const insert=(record,user='a',updatedAt=now)=>raw.prepare("INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at) VALUES(?,'workout',?,?,?,?,?)").run(user,record.id,record.data.date.slice(0,7),JSON.stringify(record.data),record.version,updatedAt);
 const current=session('Bench press',{date:'2026-09-16',finishedAt:null,sets:[]});insert(current);
 const params=(n=1)=>new URLSearchParams({'exercise-performance':'1',workoutId:current.id,exerciseId:current.data.exercises[0].id,workingSetNumber:String(n)});
 const request=(n=1,user='a',search=params(n))=>handleLife(new Request('https://life.test/api/life?'+search),user,db,new Date(now));
 return {raw,reads,insert,current,params,request};
}

test('last exercise performance crosses routine and exercise IDs, preserving load units and provenance',async t=>{
 const f=fixture(t),old=session('Bench press',{name:'Pull day'});old.data.exercises[0].unit='kg';old.data.sets[0].load=65;
 f.insert(old);
 const response=await f.request(),body=await response.json();
 assert.equal(response.status,200);
 assert.deepEqual(body.performance,{workoutId:old.id,workoutName:'Pull day',exerciseName:'Bench press',date:'2026-09-14',finishedAt:old.data.finishedAt,workingSetNumber:1,reps:8,load:65,unit:'kg'});
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});

test('exercise aliases are exact and preserve equipment, grip and custom exercise distinctions',()=>{
 const lat=session('Lat pulldown (Mag/Medium Grip)');
 assert.equal(performanceInWorkout(lat,'Medium-grip lat pulldown',1).matched,true);
 assert.equal(performanceInWorkout(lat,'Neutral-grip lat pulldown',1).matched,false);
 assert.equal(performanceInWorkout(lat,'Lat pulldown',1).matched,false);
 const incline=session('Incline DB presses');
 assert.equal(performanceInWorkout(incline,'Incline dumbbell bench press',1).matched,true);
 assert.equal(performanceInWorkout(incline,'Incline barbell press',1).matched,false);
 const custom=session('Custom Cable—Press');
 assert.equal(performanceInWorkout(custom,'  CUSTOM   CABLE-PRESS  ',1).matched,true);
 assert.equal(performanceInWorkout(custom,'Custom Cable Press (single arm)',1).matched,false);
});

test('actual finish time selects the latest workout, regardless of edit time or record date',async t=>{
 const f=fixture(t),older=session(),newer=session('Bench press',{date:'2026-09-12',finishedAt:'2026-09-15T12:00:00.000Z',name:'Latest completed'});
 older.data.sets[0].load=100;newer.data.sets[0].load=150;
 f.insert(older,'a','2026-09-16T12:00:00.000Z');f.insert(newer,'a','2026-09-15T12:00:00.000Z');
 assert.equal((await (await f.request()).json()).performance.workoutId,newer.id);
});

test('current, unfinished, deleted and other-account records are never previous performance',async t=>{
 const f=fixture(t),expected=session();f.insert(expected);
 for(const extra of [{finishedAt:null},{deleted:true}])f.insert(session('Bench press',{...extra,date:'2026-09-15'}));
 f.insert(session('Bench press',{finishedAt:'2026-09-16T11:00:00.000Z'}),'b');
 f.current.data.sets=[{exerciseId:f.current.data.exercises[0].id,setNumber:1,reps:20,load:999,completedAt:now}];
 f.raw.prepare("UPDATE life_resources SET payload=? WHERE user_id='a' AND resource_id=?").run(JSON.stringify(f.current.data),f.current.id);
 assert.equal((await (await f.request()).json()).performance.workoutId,expected.id);
 assert.equal((await f.request(1,'b')).status,404);
 assert.equal((await f.request(1,null)).status,401);
});

test('working ordinals retain skipped positions and ignore warm-ups without shifting zero-rep logs',()=>{
 const old=session(),exerciseId=old.data.exercises[0].id;
 old.data.skippedSets=[{exerciseId,workingSetNumber:2}];
 old.data.sets=[
  {exerciseId,setNumber:1,reps:12,load:45,warmup:true,completedAt:now},
  {exerciseId,setNumber:3,reps:7,load:140,completedAt:now},
  {exerciseId,setNumber:2,reps:8,load:135,completedAt:now},
 ];
 assert.equal(performanceInWorkout(old,'Bench press',1).performance.load,135);
 assert.deepEqual(performanceInWorkout(old,'Bench press',2),{matched:true,performance:null});
 assert.equal(performanceInWorkout(old,'Bench press',3).performance.load,140);
 old.data.sets.find(s=>s.setNumber===2).reps=0;
 assert.deepEqual(performanceInWorkout(old,'Bench press',1),{matched:true,performance:null});
 assert.equal(performanceInWorkout(old,'Bench press',3).performance.load,140);
});

test('missing or skipped ordinal in the latest matching workout never falls back to another set or older workout',async t=>{
 const f=fixture(t),older=session(),newer=session('Bench press',{finishedAt:'2026-09-15T12:00:00.000Z'});
 older.data.sets.push({...older.data.sets[0],setNumber:2,reps:6});
 f.insert(older);f.insert(newer);
 assert.equal((await (await f.request(2)).json()).performance,null);
 newer.data.skippedSets=[{exerciseId:newer.data.exercises[0].id,workingSetNumber:1}];
 f.raw.prepare("UPDATE life_resources SET payload=? WHERE user_id='a' AND resource_id=?").run(JSON.stringify(newer.data),newer.id);
 assert.equal((await (await f.request(1)).json()).performance,null);
 assert.equal((await (await f.request(2)).json()).performance.workoutId,newer.id);
});

test('sessions with only unperformed targets or warm-ups do not replace the last performed workout',async t=>{
 const f=fixture(t),old=session();f.insert(old);
 const empty=session('Bench press',{finishedAt:'2026-09-15T12:00:00.000Z',sets:[]});f.insert(empty);
 const warmup=session('Bench press',{finishedAt:'2026-09-15T13:00:00.000Z'});warmup.data.sets[0].warmup=true;f.insert(warmup);
 const zero=session('Bench press',{finishedAt:'2026-09-15T14:00:00.000Z'});zero.data.sets[0].reps=0;f.insert(zero);
 assert.equal((await (await f.request()).json()).performance.workoutId,old.id);
});

test('a matching exercise beyond the regular 100-workout UI page is still found',async t=>{
 const f=fixture(t),old=session();f.insert(old);
 for(let index=0;index<125;index++)f.insert(session('Dumbbell curl',{finishedAt:'2026-09-15T12:00:00.000Z'}));
 assert.equal((await (await f.request()).json()).performance.workoutId,old.id);
 assert.equal(f.reads.length,2);
});

test('bounded lookup reports overflow without returning partial or invented performance',async t=>{
 const f=fixture(t);
 f.raw.exec('BEGIN');
 for(let index=0;index<5001;index++)f.insert(session('Dumbbell curl',{finishedAt:'2026-09-15T12:00:00.000Z'}));
 f.raw.exec('COMMIT');
 const response=await f.request();assert.equal(response.status,413);
 assert.match((await response.json()).error,/No partial comparison/);
 assert.equal(f.reads.length,51);
});

test('comparison requests derive names from the saved active snapshot and validate exact set boundaries',async t=>{
 const f=fixture(t);
 for(const number of [0,4,21,1.5])assert.equal((await f.request(number)).status,400);
 const bad=f.params();bad.set('exerciseId',randomUUID());assert.equal((await f.request(1,'a',bad)).status,400);
 const missing=f.params();missing.set('workoutId',randomUUID());assert.equal((await f.request(1,'a',missing)).status,404);
 const malformed=f.params();malformed.set('workoutId','not-an-id');assert.equal((await f.request(1,'a',malformed)).status,400);
 f.current.data.finishedAt=now;f.raw.prepare("UPDATE life_resources SET payload=? WHERE user_id='a' AND resource_id=?").run(JSON.stringify(f.current.data),f.current.id);
 assert.equal((await f.request()).status,409);
});
