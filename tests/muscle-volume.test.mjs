import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {exerciseTargets,routineVolume,plannedVolume,recordedVolume,volumeEvidence} from '../lib/life/muscle-volume.ts';
import {exercisePresets,presetExercise} from '../lib/life/exercise-presets.ts';
import {presetMuscleReview,presetMuscleAuditDate} from '../lib/life/exercise-muscle-catalog.ts';
import {muscleTargetsSchema} from '../lib/life/muscle-groups.ts';
import {exerciseSchema,routineSchema,workoutSchema} from '../lib/life/modules.ts';
import {handleLife} from '../lib/life/service.ts';
import {exerciseAliases,exerciseNameKey,resolveExerciseName} from '../lib/life/exercise-names.ts';
const routine=(weeklySessions=undefined,name='Bench press')=>({id:randomUUID(),version:0,data:{name:'Push',preferences:'',archived:false,exercises:[presetExercise(name)],...(weeklySessions===undefined?{}:{weeklySessions})}});

test('supplied exercise spellings and equipment variants all have predefined coverage',()=>{
 const examples=[['Incline Dumbbell Press','chest'],['Lat Pulldown (Mag/Medium Grip)','lats'],['Leg Press','quads'],['Cable Lateral Raises','shoulders'],['Standing Calf Raises','calves'],['Cable Crunches','abs'],['Romanian Deadlift','hamstrings'],['Seated Leg Curl (Machine)','hamstrings'],['Chest-Supported High Row','upper-back'],['Assisted Dip / Dip Machine','triceps'],['Hammer Curls','biceps'],['Seated Calf Raises','calves'],['Assisted Neutral-Grip Chin-Up','lats'],['Leg Extensions (Machine)','quads'],['Dumbbell Bicep Curls','biceps']];
 const r=routine(1);r.data.exercises=examples.map(([name,muscle])=>{const e=presetExercise(name);assert.ok(e.muscles.direct.includes(muscle),name);delete e.muscles;return {...e,sets:2,load:17};});const original=JSON.stringify(r);
 const volume=plannedVolume([r]);assert.deepEqual(volume.unmapped,[]);assert.equal(volume.sets,30);assert.equal(volume.muscles.forearms.indirect,4);assert.equal(volume.muscles.forearms.estimated,2);assert.equal(JSON.stringify(r),original);
});
test('alias keys resolve to real presets with shared targets, case/punctuation tolerance and no duplicates',()=>{
 assert.equal(new Set(exercisePresets.map(e=>exerciseNameKey(e.name))).size,exercisePresets.length);
 for(const [alias,canonical] of exerciseAliases){const preset=exercisePresets.find(e=>exerciseNameKey(e.name)===canonical);assert.ok(preset,alias);const e=presetExercise(alias);assert.equal(e.reps,preset.reps);assert.equal(e.repMax,preset.repMax);assert.equal(e.restSeconds,preset.restSeconds);assert.deepEqual(e.muscles,exerciseTargets({name:preset.name}));assert.equal(e.load,0);}
 assert.equal(resolveExerciseName('  ASSISTED Neutral‑Grip Chin–Up  '),exerciseNameKey('Assisted neutral-grip chin-up'));
 assert.equal(presetExercise('Cable Lateral Raises').repMax,20);assert.equal(presetExercise('Standing Calf Raises').restSeconds,90);
});
test('new variants distinguish high rows and machine dips; explicit assignments always win',()=>{
 assert.deepEqual(exerciseTargets({name:'Chest-Supported High Row'}),{direct:['upper-back','shoulders'],indirect:['biceps']});
 assert.deepEqual(exerciseTargets({name:'Dip machine'}),{direct:['triceps'],indirect:['chest','shoulders']});
 const custom={direct:['forearms'],indirect:[]};assert.deepEqual(exerciseTargets({name:'Hammer Curls',muscles:custom}),custom);assert.deepEqual(exerciseTargets({name:'Hammer Curls',muscles:{direct:[],indirect:[]}}),{direct:[],indirect:[]});
 for(const name of ['My hammer curl rehab variation','Cable lateral raises (experimental)','Incline bench press with unknown movement','constructor','__proto__'])assert.equal(exerciseTargets({name}),null,name);
});
test('every preset has a complete dated audit, valid roles, technique assumptions and traceable sources',()=>{
 const audit=JSON.parse(readFileSync('docs/preset-muscle-audit.json','utf8'));
 assert.equal(audit.auditedAt,presetMuscleAuditDate);assert.equal(audit.entries.length,79);
 assert.deepEqual(audit.entries.map(e=>e.name),exercisePresets.map(e=>e.name));
 assert.deepEqual(audit.summary,{reviewed:79,changed:20,retained:59});
 const sources=new Map(audit.sources.map(s=>[s.id,s]));assert.equal(sources.size,audit.sources.length);
 for(const entry of audit.entries){
  const review=presetMuscleReview(entry.name);assert.ok(review,entry.name);
  assert.ok(muscleTargetsSchema.safeParse(entry.recommended).success,entry.name);
  assert.deepEqual({direct:review.direct,indirect:review.indirect},entry.recommended);
  assert.ok(review.note.trim(),entry.name);assert.ok(entry.rationale&&entry.evidenceLimits,entry.name);
  assert.ok(entry.sourceIds.length,entry.name);
  for(const id of entry.sourceIds){const source=sources.get(id);assert.ok(source,entry.name+' '+id);assert.equal(new URL(source.url).protocol,'https:');}
  assert.deepEqual(review.sources,entry.sourceIds.map(id=>{const {title,url}=sources.get(id);return {title,url};}));
 }
});
test('reviewed defaults distinguish dynamic assistance, intentional trunk training and incidental bracing',()=>{
 assert.deepEqual(exerciseTargets({name:'Trap-bar deadlift'}),{direct:['quads','glutes'],indirect:['hamstrings','lower-back']});
 assert.deepEqual(exerciseTargets({name:'Deadlift'}),{direct:['glutes'],indirect:['quads','hamstrings','lower-back']});
 assert.deepEqual(exerciseTargets({name:'Hack squat'}),{direct:['quads','glutes'],indirect:['adductors']});
 for(const name of ['Leg curl','Seated leg curl'])assert.deepEqual(exerciseTargets({name}),{direct:['hamstrings'],indirect:['calves']});
 for(const name of ['Overhead press','Seated dumbbell press','Machine shoulder press'])assert.deepEqual(exerciseTargets({name}),{direct:['shoulders'],indirect:['triceps','upper-back']});
 for(const name of ['Lateral raise','Cable lateral raise','Rear-delt fly','Reverse pec deck'])assert.deepEqual(exerciseTargets({name}),{direct:['shoulders'],indirect:['upper-back']});
 for(const name of ['Cable fly','Pec deck','Dumbbell fly'])assert.deepEqual(exerciseTargets({name}),{direct:['chest'],indirect:['shoulders']});
 for(const name of ['Biceps curl','Dumbbell curl','Preacher curl','Cable curl','Hammer curl'])assert.deepEqual(exerciseTargets({name}),{direct:['biceps'],indirect:['forearms']});
 assert.deepEqual(exerciseTargets({name:'Face pull'}),{direct:['shoulders','upper-back'],indirect:['biceps']});
 assert.deepEqual(exerciseTargets({name:'Bird dog'}),{direct:['abs','lower-back'],indirect:['glutes']});
 for(const name of ['Biceps curl','Cable fly','Lateral raise'])assert.ok(!exerciseTargets({name}).direct.includes('abs')&&!exerciseTargets({name}).indirect.includes('abs'),name+' incidental bracing');
 assert.match(presetMuscleReview('Hanging knee raise').note,/pelvic curl/);assert.match(presetMuscleReview('Hanging knee raise').note,/Hip-only/);
 assert.match(presetMuscleReview('Chest-supported high row').note,/High-to-low/);
});
test('catalog results and preset creation are independent copies; aliases preserve assumptions and explicit saved mappings win',()=>{
 const original=presetMuscleReview('Cable lateral raise'),edited=presetMuscleReview('Cable Lateral Raises');
 assert.deepEqual(edited,original);edited.direct.push('abs');edited.indirect.length=0;edited.sources[0].title='Changed';edited.sources[0].url='https://invalid.test';
 assert.deepEqual(presetMuscleReview('Cable lateral raise'),original);
 const created=presetExercise('Cable lateral raise');created.muscles.direct.length=0;
 assert.deepEqual(exerciseTargets({name:'Cable lateral raise'}),{direct:original.direct,indirect:original.indirect});
 const custom={direct:['forearms'],indirect:[]},saved={...presetExercise('Trap-bar deadlift'),muscles:custom},before=JSON.stringify(saved);
 const result=exerciseTargets(saved);result.direct.push('quads');assert.equal(JSON.stringify(saved),before);
 assert.deepEqual(exerciseTargets(saved),custom);assert.deepEqual(exerciseTargets({...saved,muscles:{direct:[],indirect:[]}}),{direct:[],indirect:[]});
 for(const name of ['Custom movement','__proto__','constructor','Hanging knee raise (unknown variation)'])assert.equal(presetMuscleReview(name),null,name);
});
function workout(r,date='2026-09-14',sets=3){return {id:randomUUID(),version:0,data:{date,routineId:r.id,name:r.data.name,exercises:structuredClone(r.data.exercises),sets:Array.from({length:sets},(_,i)=>({exerciseId:r.data.exercises[0].id,setNumber:i+1,reps:8,load:100,completedAt:date+'T12:00:00.000Z'})),finishedAt:null,restUntil:null}};}
function fixture(t,now=new Date('2026-09-14T12:00:00Z')){const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));const db={prepare(sql){return {bind(...p){return {async first(){return raw.prepare(sql).get(...p)||null;},async all(){return {results:raw.prepare(sql).all(...p)};}};}};}};const call=(body=null,path='',id='a')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),id,db,now);const setup=(id='a')=>call({action:'profile',profile:{goal:'',timezone:'America/New_York',modules:['fitness'],habits:[],version:0}},'',id);const insert=(kind,r,user='a')=>raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,1,?,NULL)').run(user,kind,r.id,r.data.date?.slice(0,7)||'',JSON.stringify(r.data),now.toISOString());return {raw,call,setup,insert};}
test('all standard exercises have valid, nonoverlapping muscle assignments; unknown names remain unknown',()=>{for(const p of exercisePresets){const targets=exerciseTargets({name:p.name});assert.ok(targets,p.name);assert.ok(muscleTargetsSchema.safeParse(targets).success,p.name);assert.deepEqual(presetExercise(p.name).muscles,targets);}assert.equal(exerciseTargets({name:'My special movement'}),null);assert.equal(muscleTargetsSchema.safeParse({direct:['chest'],indirect:['chest']}).success,false);assert.equal(muscleTargetsSchema.safeParse({direct:['chest','chest'],indirect:[]}).success,false);});
test('direct and indirect sets stay distinct and are combined once per muscle',()=>{const r=routine(2),v=routineVolume(r);assert.deepEqual(v.muscles.chest,{direct:3,indirect:0,estimated:3});assert.deepEqual(v.muscles.triceps,{direct:0,indirect:3,estimated:1.5});assert.equal(v.sets,3);const weekly=plannedVolume([r]);assert.equal(weekly.muscles.chest.estimated,6);assert.equal(weekly.muscles.triceps.estimated,3);assert.equal(weekly.sessions,2);});
test('weekly planning requires explicit frequency and excludes archived or zero-frequency programs',()=>{const unset=routine(),zero=routine(0),archived=routine(7);archived.data.archived=true;const v=plannedVolume([routine(2),unset,zero,archived]);assert.equal(v.sets,6);assert.equal(v.unscheduled,1);assert.equal(v.sessions,2);assert.equal(routineSchema.safeParse({...unset.data,weeklySessions:8}).success,false);assert.equal(routineSchema.safeParse({...unset.data,weeklySessions:1.5}).success,false);});
test('actual volume includes ongoing logged work, excludes warm-ups, zero reps, dates outside window and unlogged plan',()=>{const r=routine(7),w=workout(r);w.data.sets[0].warmup=true;w.data.sets[1].reps=0;const v=recordedVolume([w,workout(r,'2026-09-13'),workout(r,'2026-09-15')],'2026-09-14','2026-09-14');assert.equal(v.sets,1);assert.equal(v.sessions,1);assert.equal(v.warmups,1);assert.equal(v.zeroRepSets,1);assert.equal(v.muscles.chest.estimated,1);assert.equal(v.muscles.triceps.estimated,.5);assert.equal(workoutSchema.safeParse(w.data).success,true);});
test('custom mappings override defaults and unmapped work is visible without fabricated muscle credit',()=>{const r=routine(2,'My custom lift');let v=routineVolume(r);assert.equal(v.unmapped[0].sets,3);assert.equal(v.muscles.chest.estimated,0);r.data.exercises[0].muscles={direct:['forearms'],indirect:['biceps']};v=routineVolume(r);assert.equal(v.unmapped.length,0);assert.equal(v.muscles.forearms.estimated,3);assert.equal(v.muscles.biceps.estimated,1.5);r.data.exercises[0].name='Bench press';assert.equal(routineVolume(r).muscles.chest.estimated,0);});
test('legacy JSON remains unchanged and optional fields survive validation',()=>{const r=routine();delete r.data.exercises[0].muscles;const old={name:r.data.name,preferences:r.data.preferences,exercises:r.data.exercises.map(e=>({id:e.id,name:e.name,sets:e.sets,reps:e.reps,repMax:e.repMax,load:e.load,unit:e.unit,restSeconds:e.restSeconds})),archived:false};const before=JSON.stringify(old);assert.equal(JSON.stringify(routineSchema.parse(old)),before);const w=workout(r);assert.deepEqual(workoutSchema.parse(w.data),w.data);assert.ok(!Object.hasOwn(exerciseSchema.parse(r.data.exercises[0]),'muscles'));});
test('analysis evidence is scoped and explicitly discloses limits of estimated volume',()=>{const r=routine(),v=volumeEvidence([workout(r),workout(r,'2026-09-13')],'2026-09-14','2026-09-14');assert.equal(v.workingSets,3);assert.equal(v.muscles.chest.estimated,3);assert.match(v.interpretation,/half of indirect/);assert.match(v.interpretation,/not inferred/);assert.match(v.interpretation,/Do not scale/);});
test('training endpoint uses local Monday boundaries and all sessions, not the 100-row history slice',async t=>{const f=fixture(t,new Date('2026-09-14T02:00:00Z'));await f.setup();await f.setup('b');const r=routine();for(let i=0;i<105;i++)f.insert('workout',workout(r,'2026-09-13',1));f.insert('workout',workout(r,'2026-09-06'));f.insert('workout',workout(r,'2026-09-13'),'b');const response=await f.call(null,'?training-summary');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);const data=await response.json();assert.equal(data.today,'2026-09-13');assert.equal(data.current.from,'2026-09-07');assert.equal(data.current.sets,105);assert.equal(data.previous.sets,3);const other=await (await f.call(null,'?training-summary','b')).json();assert.equal(other.current.sets,3);assert.equal((await f.call(null,'?training-summary',null)).status,401);});
test('summary refuses partial totals above the bounded read limit',async t=>{const f=fixture(t);await f.setup();const r=routine(),w=workout(r);f.raw.exec('BEGIN');for(let i=0;i<5001;i++)f.insert('workout',{...w,id:randomUUID()});f.raw.exec('COMMIT');assert.equal((await f.call(null,'?training-summary')).status,503);});
test('program edits preserve active workout targeting snapshots, exact set retries and export fields',async t=>{const f=fixture(t);await f.setup();const r=routine(2),save=(kind,record)=>f.call({action:'resource',record:{kind,id:record.id,version:record.version,data:record.data}});const saved=(await (await save('routine',r)).json()).record;const w=workout(saved,'2026-09-14',0);let ws=(await (await save('workout',w)).json()).record;assert.ok(ws);const changed={...saved,data:{...saved.data,weeklySessions:3,exercises:saved.data.exercises.map(e=>({...e,muscles:{direct:['triceps'],indirect:[]}}))}};assert.equal((await save('routine',changed)).status,200);ws.data.sets=workout(saved).data.sets;ws.data.sets[0].warmup=true;for(let i=0;i<2;i++)assert.equal((await save('workout',ws)).status,200);assert.equal(f.raw.prepare("SELECT version FROM life_resources WHERE kind='workout'").get().version,2);const data=await (await f.call(null,'?training-summary')).json();assert.equal(data.current.muscles.chest.estimated,2);assert.equal(data.current.muscles.triceps.estimated,1);const exported=await (await f.call(null,'?export')).json();assert.equal(JSON.parse(exported.resources.find(r=>r.kind==='routine').payload).weeklySessions,3);assert.equal(JSON.parse(exported.resources.find(r=>r.kind==='workout').payload).sets[0].warmup,true);});
