import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as modules from '../lib/life/modules.ts';
import * as domain from '../lib/life/domain.ts';
import * as session from '../lib/life/workout-session.ts';
import * as presets from '../lib/life/exercise-presets.ts';
import * as dates from '../lib/life/date-display.ts';
import * as muscles from '../lib/life/muscle-groups.ts';
import * as volume from '../lib/life/muscle-volume.ts';
import * as names from '../lib/life/exercise-names.ts';
import * as symbols from '../lib/life/exercise-symbols.ts';
import {definiteClientRejection} from '../lib/life/write-retry.ts';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function events(extra={}){
 const listeners=new Map();
 return {...extra,addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},removeEventListener(type,listener){listeners.get(type)?.delete(listener);},emit(type,event={}){for(const listener of listeners.get(type)||[])listener(event);}};
}

// Exercise the actual component closures, including the commit boundary. An
// abandoned render must not publish new props to running timers/pointer events.
function component(file,props,adapters={},globals={},transform=source=>source){
 let slots=[],cursor=0,changed=false,tree,committedProps=props;
 const pendingEffects=new Map(),timers=new Map();let timerId=0;
 const effect=(fn,deps)=>{const i=cursor++,previous=slots[i];if(!previous||!deps||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){pendingEffects.set(i,{fn,deps});}};
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{const next=typeof value==='function'?value(slots[i].value):value;if(!Object.is(next,slots[i].value)){slots[i]={...slots[i],value:next};changed=true;}}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useEffect:effect,useLayoutEffect:effect,
  useCallback(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index])))slots[i]={value:fn,deps};return slots[i].value;},
  useSyncExternalStore(subscribe,snapshot){const i=cursor++;slots[i]??={};return snapshot();},
  useId(){const i=cursor++;return 'control-'+i;},useContext(){return true;}
 };
 const environment={document:events({hidden:false,visibilityState:'visible'}),window:events(),navigator:{},
  setInterval(fn){const id=++timerId;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);},
  setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(){return ++timerId;},cancelAnimationFrame(){},
  ...globals};
 const imports={react,'react/jsx-runtime':jsx,'./workout-timer':{useWorkoutTimer:()=>({setWorkoutTimer(){}}),WorkoutNotificationControl:'WorkoutNotificationControl'},'@/lib/life/modules':modules,'@/lib/life/domain':domain,'@/lib/life/workout-session':session,'@/lib/life/exercise-presets':presets,'@/lib/life/date-display':dates,'@/lib/life/muscle-groups':muscles,'@/lib/life/muscle-volume':volume,'@/lib/life/exercise-names':names,'@/lib/life/exercise-symbols':symbols,'@/lib/life/write-retry':{definiteClientRejection},
  './shared':{request:async()=>({records:[]}),useUnsaved(){},useWorkoutCancel:fn=>fn},...adapters};
 const output={},code=transpileModule(transform(readFileSync('app/life/'+file+'.tsx','utf8')),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports:output,crypto:{randomUUID},structuredClone,Date,console,...environment,require:name=>imports[name]||new Proxy({},{get:(_,key)=>key==='default'?name:String(key)})});
 function render(next=committedProps,commit=true){
  const previous=slots;slots=slots.slice();let count=0;
  do{cursor=0;changed=false;pendingEffects.clear();tree=output.default(next);assert.ok(++count<20,'render adjustment must converge');}while(changed);
  if(commit){committedProps=next;for(const [index,value] of pendingEffects){slots[index]?.cleanup?.();slots[index]={deps:value.deps,cleanup:value.fn()};}}
  else slots=previous;
  return tree;
 }
 function walk(predicate,node){if(!node||typeof node!=='object')return [];return [...(predicate(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>walk(predicate,child))];}
 const all=predicate=>walk(predicate,tree);
 function text(node){if(!node)return '';if(typeof node==='string'||typeof node==='number')return String(node);return [node?.props?.children].flat(Infinity).map(text).join('');}
 function button(label){const match=all(node=>node.props?.onClick&&(node.props['aria-label']===label||text(node)===label))[0];assert.ok(match,'Missing '+label);return match;}
 return {render,all,button,timers,environment,get props(){return committedProps;},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}

test('cardio opening is an edge transition; a delayed history read cannot erase its acknowledged save',async()=>{
 const history=deferred(),writes=[];let uuid;
 const f=component('cardio',{profile:{timezone:'UTC'},active:false,onDirty(){}},{'./shared':{request:()=>history.promise,useUnsaved(){},useWorkoutCancel:fn=>fn,saveRecord:async(kind,record)=>{uuid=record.id;writes.push(record);return {...record,version:1};}}});
 f.render();f.render({...f.props,active:true});
 const activity=f.all(node=>node.props?.label==='Cardio activity')[0];assert.ok(activity);
 await f.button('Save').props.onClick();f.render();
 assert.equal(f.all(node=>node.props?.label==='Cardio activity').length,0,'saving while open does not create another blank record');
 history.resolve({records:[]});await flush();f.render();
 assert.equal(f.all(node=>node.props?.className==='ledger-row').length,1,'late empty history preserves the new acknowledged record');
 assert.equal(writes.length,1);
 f.render({...f.props,active:false});f.render({...f.props,active:true});await f.button('Save').props.onClick();f.render();
 assert.notEqual(writes[0].id,uuid,'reopening creates a distinct explicit transaction');f.unmount();
});

test('workout draft survives navigation and rest-only acknowledgement, then resets only after skipping',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Synthetic push',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}};
 let saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};
 const reads=[],writes=[];
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>{reads.push(path);if(path==='?kind=routine')return {records:[routine],hasMore:false};if(path==='?kind=workout')return {records:[saved]};if(path.startsWith('?exercise-performance'))return {performance:null};return null;},saveRecord:async(kind,record)=>{writes.push(structuredClone(record));saved={...record,version:record.version+1};return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;
 f.render();await flush();f.render();await flush();f.render();
 view().onReps('9');view().onLoad('135.');f.render();assert.equal(view().setDirty,true);
 f.render({...f.props,active:false});f.render({...f.props,active:true});await flush();f.render();
 assert.equal(view().reps,'9');assert.equal(view().load,'135.');assert.equal(reads.filter(path=>path==='?kind=workout').length,1,'background return cannot replace a local draft');
 view().onExtendRest();await flush();f.render();assert.equal(view().load,'135.');assert.equal(view().setDirty,true);assert.ok(writes[0].data.restUntil);
 view().onSkipSet();await flush();f.render();await flush();f.render();
 assert.equal(view().load,String(routine.data.exercises[0].load));assert.equal(view().setDirty,false);assert.equal(view().target.workingSetNumber,2);assert.equal(saved.data.sets.length,0);assert.equal(saved.data.skippedSets.length,1);f.unmount();
});

test('exercise motion honors reduced motion and resets the frame when changing away and back while paused',()=>{
 const preference=events({matches:true});
 const f=component('exercise-symbol',{name:'Bench press',playback:'auto',onPlayback(){}},{},{matchMedia:()=>preference,IntersectionObserver:class{observe(){}disconnect(){}}});
 const frame=()=>f.all(node=>node.props?.className==='exercise-motion-frame'&&!node.props.hidden)[0].props.src;
 f.render();assert.equal(f.timers.size,0);assert.equal(f.button('Play exercise demonstration').props['aria-label'],'Play exercise demonstration');
 f.render({...f.props,playback:'play'});assert.equal(f.timers.size,1);const original=frame();[...f.timers.values()][0]();f.render();assert.notEqual(frame(),original);
 f.render({...f.props,playback:'pause'});assert.equal(f.timers.size,0);
 f.render({...f.props,name:'Squat'});f.render({...f.props,name:'Bench press'});assert.equal(frame(),original);
 f.environment.document.hidden=true;f.render({...f.props,playback:'play'});assert.equal(f.timers.size,0,'background tabs do not animate');f.unmount();
});

test('last planned set skips rest and opens review; a late acknowledgement retains one exact set identity',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Single set',preferences:'',exercises:[{...presets.presetExercise('Bench press'),sets:1,restSeconds:120,load:135}],archived:false}};
 let saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1},lose=true;const writes=[];
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push(structuredClone(record));if(lose){lose=false;saved={...record,version:record.version+1};throw new Error('Synthetic lost acknowledgement');}assert.equal(JSON.stringify(record),JSON.stringify(writes[0]));return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;
 f.render();await flush();f.render();await flush();f.render();view().onReps('8');view().onLoad('135');f.render();view().onSaveSet();await flush();f.render();assert.equal(view().pending,true);assert.equal(writes[0].data.restUntil,null);
 await f.button('Retry workout save').props.onClick();f.render();assert.equal(view().reviewing,true);assert.equal(view().target,null);assert.equal(saved.data.sets.length,1);assert.equal(saved.data.sets[0].workingSetNumber,1);assert.equal(saved.data.restUntil,null);f.unmount();
});

test('history review acknowledges a retried addition without leaving a duplicate draft',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Review',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1};let frozen;
 const f=component('workout-review',{workout,busy:false,onSave:async record=>{frozen=record;return false;}},{'./shared':{useWorkoutCancel:fn=>fn}});
 f.render();f.button('Add set').props.onClick();f.render();f.button('Save set').props.onClick();await flush();f.render();assert.ok(frozen);assert.equal(f.all(node=>node.props?.className==='session-review-entry').length,1);
 f.render({...f.props,workout:{...frozen,version:2}});assert.equal(f.all(node=>node.props?.className==='session-review-entry').length,0,'read/ retry acknowledgement clears the already-saved addition');f.unmount();
});

test('summary adds a preset exercise with actual values while the permanent routine choice starts unchecked',async()=>{
 const original=presets.presetExercise('Bench press'),routine={id:randomUUID(),version:1,data:{name:'Reviewed day',preferences:'',exercises:[original],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1},added=presets.presetExercise('Hammer curl'),writes=[];
 const f=component('workout-review',{workout,busy:false,canSaveToRoutine:true,onSave:async()=>{assert.fail('new exercises use their separate save path');},onAddExercise:async(record,exercise,saveToRoutine)=>{writes.push({record,exercise,saveToRoutine});return true;},onFinish(){}},{'./shared':{useWorkoutCancel:fn=>fn}});
 f.render();f.all(node=>node.type==='./exercise-preset-picker')[0].props.onSelect(added);f.render();
 const checkbox=f.all(node=>node.props?.className==='session-review-program-choice')[0].props.children[0];assert.equal(checkbox.props.checked,false);
 f.all(node=>node.type==='input'&&node.props.inputMode==='numeric')[0].props.onChange({target:{value:'9'}});f.render();f.all(node=>node.type==='input'&&node.props.inputMode==='decimal')[0].props.onChange({target:{value:'20.5'}});f.render();f.all(node=>node.type==='select')[0].props.onChange({target:{value:'kg'}});f.render();assert.equal(f.button('Finish workout').props.disabled,true);
 f.button('Save added exercise').props.onClick();await flush();f.render();assert.equal(writes.length,1);assert.equal(writes[0].saveToRoutine,false);assert.equal(writes[0].exercise.unit,'kg');assert.equal(writes[0].exercise.load,20.5);assert.deepEqual(writes[0].record.data.exercises,[original]);assert.equal(writes[0].record.data.additionalExercises[0].id,added.id);assert.equal(writes[0].record.data.sets[0].reps,9);assert.equal(writes[0].record.data.sets[0].workingSetNumber,1);assert.equal(f.all(node=>node.props?.className==='session-review-entry').length,0);f.unmount();
});

test('cancelling a staged preset writes nothing and resets the explicit routine checkbox for the next choice',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Review options',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1},writes=[];
 const f=component('workout-review',{workout,busy:false,canSaveToRoutine:true,onSave:async()=>true,onAddExercise:async(record,exercise,saveToRoutine)=>{writes.push({record,exercise,saveToRoutine});return true;}},{'./shared':{useWorkoutCancel:fn=>fn}});
 const choose=()=>{f.all(node=>node.type==='./exercise-preset-picker')[0].props.onSelect(presets.presetExercise('Hammer curl'));f.render();};
 const permanent=()=>f.all(node=>node.props?.className==='session-review-program-choice')[0].props.children[0];
 f.render();choose();permanent().props.onChange({target:{checked:true}});f.render();f.button('Cancel set edit').props.onClick();f.render();assert.equal(writes.length,0);choose();assert.equal(permanent().props.checked,false);permanent().props.onChange({target:{checked:true}});f.render();f.button('Save added exercise').props.onClick();await flush();f.render();assert.equal(writes.length,1);assert.equal(writes[0].saveToRoutine,true);f.unmount();
});

test('unknown added-exercise acknowledgement preserves the frozen candidate and clears only when that saved payload arrives',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Lost addition',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1},saving=deferred(),writes=[];
 const f=component('workout-review',{workout,busy:false,canSaveToRoutine:true,onSave:async()=>true,onAddExercise:async(record,exercise,saveToRoutine)=>{writes.push({record,exercise,saveToRoutine});return saving.promise;}},{'./shared':{useWorkoutCancel:fn=>fn}});
 f.render();f.all(node=>node.type==='./exercise-preset-picker')[0].props.onSelect(presets.presetExercise('Hammer curl'));f.render();f.all(node=>node.type==='textarea')[0].props.onChange({target:{value:'Extra curl after the planned session.'}});f.render();const click=f.button('Save added exercise').props.onClick;click();click();assert.equal(writes.length,1);assert.equal(writes[0].record.data.notes,'Extra curl after the planned session.');saving.resolve(false);await flush();f.render({...f.props,busy:true});assert.equal(f.all(node=>node.props?.className==='session-review-entry').length,1);assert.equal(f.all(node=>node.type==='fieldset')[0].props.disabled,true);
 f.render({...f.props,busy:false,workout:{...writes[0].record,version:2}});assert.equal(f.all(node=>node.props?.className==='session-review-entry').length,0);assert.equal(f.all(node=>node.props?.className==='session-review-exercise').length,2);assert.equal(writes.length,1);f.unmount();
});

test('a first warm-up on an added exercise never replaces its working load target',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Warm-up addition',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1},added={...presets.presetExercise('Hammer curl'),load:40},writes=[];
 const f=component('workout-review',{workout,busy:false,canSaveToRoutine:true,onSave:async()=>true,onAddExercise:async(record,exercise,saveToRoutine)=>{writes.push({record,exercise,saveToRoutine});return true;}},{'./shared':{useWorkoutCancel:fn=>fn}});
 f.render();f.all(node=>node.type==='./exercise-preset-picker')[0].props.onSelect(added);f.render();f.all(node=>node.props?.className==='session-review-program-choice')[0].props.children[0].props.onChange({target:{checked:true}});f.render();f.all(node=>node.props?.className==='session-review-warmup')[0].props.children[0].props.onChange({target:{checked:true}});f.render();f.all(node=>node.type==='input'&&node.props.inputMode==='decimal')[0].props.onChange({target:{value:'10'}});f.render();f.button('Save added exercise').props.onClick();await flush();f.render();assert.equal(writes[0].exercise.load,40);assert.equal(writes[0].record.data.additionalExercises[0].load,40);assert.equal(writes[0].record.data.sets[0].load,10);assert.equal(writes[0].record.data.sets[0].warmup,true);assert.equal(writes[0].record.data.sets[0].workingSetNumber,undefined);f.unmount();
});

test('repeated review Save clicks cannot replace the frozen unknown addition',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Review',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1},saving=deferred(),writes=[];
 const f=component('workout-review',{workout,busy:false,onSave:async record=>{writes.push(record);return saving.promise;}},{'./shared':{useWorkoutCancel:fn=>fn}});
 f.render();f.button('Add set').props.onClick();f.render();const click=f.button('Save set').props.onClick;click();click();assert.equal(writes.length,1);saving.resolve(false);await flush();f.render();f.render({...f.props,workout:{...writes[0],version:2}});assert.equal(f.all(node=>node.props?.className==='session-review-entry').length,0);f.unmount();
});

test('history keeps an unknown workout retry reachable inside its locked native dialog',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'History retry',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}};
 let saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};saved.data.finishedAt='2026-09-17T12:00:00.000Z';const writes=[];
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:null,saveRecord:async(kind,record)=>{writes.push(JSON.stringify(record));if(writes.length===1){saved={...record,version:record.version+1};throw new Error('Synthetic lost history acknowledgement');}return saved;}}});
 f.render();await flush();f.render();await flush();f.render();f.button('History').props.onClick();f.render();const review=f.all(node=>node.type==='./workout-review')[0];assert.ok(review);await review.props.onSave({...saved,data:{...saved.data,notes:'Synthetic late history note'}});f.render();
 const panel=f.all(node=>node.type==='./workout-panel'&&node.props.title==='Workout history')[0];assert.equal(panel.props.open,true);assert.equal(panel.props.closeDisabled,true);
 const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
 const retry=nodes(panel.props.children[0]).find(node=>node.props?.onClick&&node.props.children==='Retry workout save');assert.ok(retry,'retry is within the modal, not only behind it');await retry.props.onClick();f.render();assert.equal(writes[0],writes[1]);assert.equal(saved.data.notes,'Synthetic late history note');assert.equal(f.all(node=>node.type==='./workout-panel'&&node.props.title==='Workout history')[0].props.closeDisabled,false);f.unmount();
});

test('setup notes never substitute a different movement that reused the snapshot exercise ID',()=>{
 const exercise={...presets.presetExercise('Bench press'),setupNote:'Seat 4'},routine={id:randomUUID(),version:2,data:{name:'Changed variant',preferences:'',exercises:[{...exercise,name:'Incline dumbbell bench press',setupNote:'Incline peg 3'}],archived:false}},workout=session.createWorkoutSession({...routine,data:{...routine.data,exercises:[exercise]}},'2026-09-17').data;
 const f=component('exercise-setup-notes',{routine,workout,disabled:false,onDirty(){},onSaved(){}},{'./shared':{useWorkoutCancel:fn=>fn}});f.render();assert.equal(f.all(node=>node.type==='textarea').length,0);assert.equal(f.all(node=>node.props?.className==='exercise-setup-snapshot')[0].props.children,'Seat 4');f.unmount();
});

test('setup note conflict shows saved and local text then merges only reviewed notes into the latest program',async()=>{
 const exercise=presets.presetExercise('Bench press'),routine={id:randomUUID(),version:1,data:{name:'Original program',preferences:'',exercises:[{...exercise,setupNote:'Height 3'}],archived:false}},workout=session.createWorkoutSession(routine,'2026-09-17').data;
 const latest={...routine,version:2,data:{...routine.data,name:'Changed elsewhere',exercises:[{...routine.data.exercises[0],load:150,setupNote:'Height 5'}]}},writes=[];let saved;
 const f=component('exercise-setup-notes',{routine,workout,disabled:false,onDirty(){},onSaved:value=>{saved=value;}},{'./shared':{useWorkoutCancel:fn=>fn,request:async()=>({records:[latest]}),saveRecord:async(kind,record)=>{writes.push(structuredClone(record));if(writes.length===1)throw Object.assign(new Error('Conflict'),{status:409});return {...record,version:3};}}});
 f.render();f.all(node=>node.type==='textarea')[0].props.onChange({target:{value:'Height 4'}});f.render();await f.button('Save setup notes').props.onClick();f.render();await flush();f.render();
 assert.equal(f.all(node=>node.props?.className==='exercise-note-conflict').length,1);assert.equal(f.all(node=>node.type==='textarea')[0].props.value,'Height 4');f.button('Keep my setup notes').props.onClick();f.render();await f.button('Save setup notes').props.onClick();await flush();f.render();
 assert.equal(writes[1].version,2);assert.equal(saved.data.name,'Changed elsewhere');assert.equal(saved.data.exercises[0].load,150);assert.equal(saved.data.exercises[0].setupNote,'Height 4');assert.equal(workout.exercises[0].setupNote,'Height 3');f.unmount();
});

test('setup notes keep an unknown write through login expiry and reconcile an exact saved result',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Setup',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},workout=session.createWorkoutSession(routine,'2026-09-17').data,writes=[];let saved,acknowledged;
 const f=component('exercise-setup-notes',{routine,workout,disabled:false,onDirty(){},onSaved:value=>{acknowledged=value;}},{'./shared':{useWorkoutCancel:fn=>fn,request:async()=>({records:[saved]}),saveRecord:async(kind,record)=>{writes.push(JSON.stringify(record));if(writes.length===1){saved={...record,version:2};throw new Error('Unknown');}throw Object.assign(new Error('Synthetic rejection'),{status:writes.length===2?401:409});}}});
 f.render();f.all(node=>node.type==='textarea')[0].props.onChange({target:{value:'Incline peg 4'}});f.render();f.button('Save setup notes').props.onClick();await flush();f.render();f.button('Retry setup notes save').props.onClick();await flush();f.render();f.button('Retry setup notes save').props.onClick();await flush();f.render();
 assert.equal(new Set(writes).size,1);assert.equal(acknowledged.version,2);assert.equal(f.all(node=>node.type==='textarea')[0].props.value,'Incline peg 4');assert.equal(f.all(node=>node.props?.className==='exercise-note-conflict').length,0);f.unmount();
});

test('reps focus follows visible entry and does not steal focus from another page',()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Focus',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1};let focused=0;
 const f=component('workout-session',{workout,target:modules.nextSet(workout.data),visible:false,reps:'8',load:'135',warmup:false,remaining:0,editing:false,busy:false,pending:false,setDirty:false});
 f.render();const input=f.all(node=>node.type==='input'&&node.props.inputMode==='numeric')[0];input.props.ref.current={focus(){focused++;},select(){}};
 f.render({...f.props,visible:true});assert.equal(focused,1);f.render({...f.props,visible:false,busy:true});f.render({...f.props,busy:false});assert.equal(focused,1);f.unmount();
});

test('date fallback captures its dialog at the opening event and keeps Escape local',()=>{
 const f=component('date-input',{type:'date',value:'2026-09-17',label:'Workout date',onValueChange(){}},{},{},source=>source.replace('function CalendarInput(','export default function CalendarInput('));
 const dialog={name:'native workout dialog'};let focused=0,prevented=0,stopped=0;
 f.render();const trigger=f.all(node=>node.props?.className==='calendar-input-trigger')[0];
 trigger.props.ref.current={matches:()=>false,closest:selector=>selector==='dialog'?dialog:null,focus(){focused++;}};
 f.all(node=>node.type==='input')[0].props.ref.current={type:'date',showPicker(){throw Error('Synthetic unsupported picker');}};
 trigger.props.onClick();f.render();
 const content=f.all(node=>node.type==='PopoverContent')[0];assert.equal(content.props.container,dialog);
 content.props.onEscapeKeyDown({preventDefault(){prevented++;},stopPropagation(){stopped++;}});f.render();
 assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(f.all(node=>node.type==='Popover')[0].props.open,false);
 content.props.onCloseAutoFocus({preventDefault(){}});assert.equal(focused,1);f.unmount();
});

test('drag completion uses committed program props; cancellation and write locks never reorder',()=>{
 const first=presets.presetExercise('Bench press'),second=presets.presetExercise('Squat');
 const routine={id:randomUUID(),version:1,data:{name:'Committed program',preferences:'',exercises:[first,second],archived:false}},changes=[],abandonedChanges=[];
 const f=component('routine-editor',{routine,onChange:value=>changes.push(value),onSave(){},onCancel(){},busy:false,pending:false,error:''});
 const captures=new Set(),handle={setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
 const pointer=(y=20)=>({isPrimary:true,button:0,pointerId:1,pointerType:'mouse',clientX:50,clientY:y,currentTarget:handle,preventDefault(){}});
 const grip=()=>f.all(node=>node.props?.['aria-label']==='Reorder Bench press')[0];
 f.render();f.all(node=>node.props?.className?.includes('routine-sort-list'))[0].props.ref.current={getBoundingClientRect:()=>({left:0,right:200,top:0,bottom:200,height:200}),querySelectorAll:()=>[first,second].map((item,index)=>({dataset:{sortId:item.id},getBoundingClientRect:()=>({top:index*70,height:60})}))};
 grip().props.onPointerDown(pointer());[...f.timers.values()][0]();f.render();const finish=grip().props.onPointerUp;
 f.render({...f.props,routine:{...routine,data:{...routine.data,name:'Abandoned render'}},onChange:value=>abandonedChanges.push(value)},false);
 finish(pointer(150));f.render();
 assert.equal(changes.length,1);assert.equal(changes[0].name,'Committed program');assert.deepEqual(changes[0].exercises.map(item=>item.id),[second.id,first.id]);assert.equal(abandonedChanges.length,0);
 grip().props.onPointerDown(pointer());[...f.timers.values()][0]();f.render();f.environment.document.emit('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});f.render();grip().props.onPointerUp(pointer(150));assert.equal(changes.length,1);assert.equal(captures.size,0);
 grip().props.onPointerDown(pointer());[...f.timers.values()][0]();f.render();const staleFinish=grip().props.onPointerUp;f.render({...f.props,busy:true});staleFinish(pointer(150));assert.equal(changes.length,1);assert.equal(captures.size,0);f.unmount();
});


test('working weight uses two exact save stages and a lost set acknowledgement never repeats the program save',async()=>{
 let routine={id:randomUUID(),version:1,data:{name:'Weight stages',preferences:'',exercises:[{...presets.presetExercise('Bench press'),sets:3,load:100,restSeconds:0}],archived:false}};
 let saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};const snapshot=structuredClone(saved.data.exercises),writes=[];let lostProgram=true,lostSet=true;
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});if(kind==='routine'){routine={...record,version:2};if(lostProgram){lostProgram=false;throw new Error('Lost program acknowledgement');}return routine;}saved={...record,version:2};if(lostSet){lostSet=false;throw new Error('Lost set acknowledgement');}return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;f.render();await flush();f.render();await flush();f.render();view().onLoad('105');view().onReps('12');f.render();assert.equal(view().programWeightChanged,true);view().onSaveSet();await flush();f.render();assert.equal(view().pending,true);assert.equal(writes.length,1);
 await f.button('Retry weight & set save').props.onClick();await flush();f.render();assert.equal(writes.length,3);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[2].kind,'workout');assert.equal(view().pending,true);
 await f.button('Retry workout save').props.onClick();await flush();f.render();assert.deepEqual(writes[2],writes[3]);assert.equal(writes.filter(w=>w.kind==='routine').length,2);assert.equal(view().load,'105');assert.equal(routine.data.exercises[0].load,105);assert.deepEqual(saved.data.exercises,snapshot);
 view().onWarmup(true);view().onLoad('45');view().onReps('8');f.render();view().onSaveSet();await flush();f.render();assert.equal(view().load,'105');assert.equal(routine.data.exercises[0].load,105);assert.equal(writes.filter(w=>w.kind==='routine').length,2);f.unmount();
});

test('session-only working weight survives later sets, rest, navigation, warm-ups and reload without a program write',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Session load',preferences:'',exercises:[{...presets.presetExercise('Bench press'),sets:4,load:100,restSeconds:20}],archived:false}};let saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};const writes=[];
 const adapters={'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});saved={...record,version:record.version+1};return saved;}}};
 let f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},adapters);const view=()=>f.all(node=>node.type==='./workout-session')[0].props;
 f.render();await flush();f.render();await flush();f.render();view().onLoad('105');view().onReps('10');view().onSaveWeight(false);f.render();view().onSaveSet();await flush();f.render();assert.equal(view().load,'105');assert.equal(view().programWeightChanged,false);assert.equal(view().saveWeight,false);
 view().onSkipRest();await flush();f.render();f.render({...f.props,active:false});f.render({...f.props,active:true});await flush();f.render();view().onWarmup(true);f.render();view().onLoad('45');view().onReps('8');f.render();view().onSaveSet();await flush();f.render();assert.equal(view().load,'105');assert.equal(view().programWeightChanged,false);
 view().onReps('9');f.render();view().onSaveSet();await flush();f.render();assert.equal(writes.every(w=>w.kind==='workout'),true);f.unmount();
 f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},adapters);f.render();await flush();f.render();await flush();f.render();assert.equal(view().load,'105');assert.equal(view().programWeightChanged,false);view().onReps('9');f.render();view().onSaveSet();await flush();f.render();assert.equal(writes.every(w=>w.kind==='workout'),true);assert.equal(routine.data.exercises[0].load,100);f.unmount();
});

test('program weight conflict preserves set and merges only the explicit weight after saved/local review',async()=>{
 const exercise={...presets.presetExercise('Bench press'),sets:3,load:100,restSeconds:0};let routine={id:randomUUID(),version:1,data:{name:'Conflict weight',preferences:'',exercises:[exercise],archived:false}},saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};const writes=[];
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});if(kind==='routine'){if(writes.length===1){routine={...routine,version:2,data:{...routine.data,name:'Changed elsewhere',exercises:[{...exercise,setupNote:'Seat 7',load:110}]}};throw Object.assign(new Error('Changed'),{status:409});}routine={...record,version:3};return routine;}saved={...record,version:2};return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;f.render();await flush();f.render();await flush();f.render();view().onLoad('105');view().onReps('10');f.render();view().onSaveSet();await flush();f.render();assert.equal(saved.data.sets.length,0);f.button('Keep my weight for review').props.onClick();f.render();assert.equal(writes.length,1);await f.button('Save weight & set').props.onClick();await flush();f.render();assert.equal(routine.data.name,'Changed elsewhere');assert.equal(routine.data.exercises[0].setupNote,'Seat 7');assert.equal(routine.data.exercises[0].load,105);assert.equal(saved.data.sets[0].load,105);assert.equal(saved.data.exercises[0].load,100);f.unmount();
});

test('starting after every max-rep set invites explicit program weight review before either write',async()=>{
 const exercise={...presets.presetExercise('Bench press'),sets:2,reps:8,repMax:12,load:100};let routine={id:randomUUID(),version:1,data:{name:'Ready for progress',preferences:'',exercises:[exercise],archived:false}};const writes=[];
 const history={workoutId:randomUUID(),workoutName:'Previous day',exerciseName:exercise.name,date:'2026-09-16',finishedAt:'2026-09-16T12:00:00.000Z',plannedSets:2,reps:8,repMax:12,unit:'lb',sets:[{workingSetNumber:1,reps:12,load:100},{workingSetNumber:2,reps:13,load:100}],skipped:[]};
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[]}:path.startsWith('?exercise-performance')?{histories:{[exercise.id]:history}}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});if(kind==='routine')routine={...record,version:2};return {...record,version:record.version+1};}}});
 f.render();await flush();f.render();await flush();f.render();await f.all(node=>node.type==='./routine-preview')[0].props.onStart();await flush();f.render();assert.equal(writes.length,0);const input=f.all(node=>node.props?.['aria-label']==='Bench press working weight (lb)')[0];assert.ok(input);input.props.onChange({target:{value:'105'}});f.render();f.button('Save weights & start').props.onClick();await flush();f.render();assert.deepEqual(writes.map(w=>w.kind),['routine','workout']);assert.equal(writes[1].record.data.exercises[0].load,105);assert.equal(routine.data.exercises[0].load,105);f.unmount();
});


test('closing a pending weight review prevents a delayed read from starting the program',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Cancelled review',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},reading=deferred(),writes=[];
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[]}:path.startsWith('?exercise-performance')?reading.promise:null,saveRecord:async(kind,record)=>{writes.push({kind,record});return {...record,version:1};}}});
 f.render();await flush();f.render();await flush();f.render();f.all(node=>node.type==='./routine-preview')[0].props.onStart();f.render();f.button('Back to preview').props.onClick();f.render();reading.resolve({histories:{}});await flush();f.render();assert.equal(writes.length,0);assert.equal(f.all(node=>node.type==='./workout-panel'&&node.props.title==='Review your working weights')[0].props.open,false);f.unmount();
});

test('unknown program weight keeps the identical payload through login expiry and read-only acknowledgement',async()=>{
 let routine={id:randomUUID(),version:1,data:{name:'Weight retry',preferences:'',exercises:[{...presets.presetExercise('Bench press'),load:100}],archived:false}},saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};const writes=[];let programAttempts=0;
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});if(kind==='routine'){programAttempts++;if(programAttempts===1){routine={...record,version:2};throw new Error('Lost acknowledgement');}throw Object.assign(new Error('Login expired'),{status:401});}saved={...record,version:2};return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;f.render();await flush();f.render();await flush();f.render();view().onLoad('105');view().onReps('10');f.render();view().onSaveSet();await flush();f.render();await f.button('Retry weight & set save').props.onClick();await flush();f.render();assert.deepEqual(writes[0],writes[1]);assert.equal(view().pending,true);assert.equal(f.all(node=>node.type==='./workout-panel'&&node.props.title==='Save working weight')[0].props.closeDisabled,true);
 await f.button('Check saved program').props.onClick();await flush();f.render();assert.deepEqual(writes.map(w=>w.kind),['routine','routine','workout']);assert.equal(saved.data.sets.length,1);assert.equal(view().pending,false);assert.equal(view().load,'105');f.unmount();
});


test('discarding or acknowledging corrections cannot turn a carried session-only weight into a program edit',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Correction loads',preferences:'',exercises:[{...presets.presetExercise('Bench press'),sets:4,load:100,restSeconds:0}],archived:false}};let saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};saved.data=session.reviseWorkoutSet(saved.data,{exerciseId:routine.data.exercises[0].id,workingSetNumber:1,reps:10,load:105,warmup:false});const writes=[];
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});saved={...record,version:record.version+1};return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;f.render();await flush();f.render();await flush();f.render();view().onPlan();f.render();
 const information=()=>f.all(node=>node.type==='./workout-information')[0].props,detail=component('workout-information',{...information(),routine:undefined},{'./shared':{useWorkoutCancel:fn=>fn}});detail.render();detail.button('Correct').props.onClick();detail.render();detail.all(node=>node.type==='input'&&node.props.inputMode==='decimal')[0].props.onChange({target:{value:'115'}});detail.render();detail.button('Cancel').props.onClick();detail.render();assert.equal(view().load,'105');assert.equal(view().programWeightChanged,false);
 view().onLoad('130');view().onReps('');f.render();view().onSaveSet();f.render();f.button('Discard set draft and reload').props.onClick();await flush();f.render();assert.equal(view().load,'105');assert.equal(view().programWeightChanged,false);
 view().onPlan();f.render();detail.render({...information(),routine:undefined});detail.button('Correct').props.onClick();detail.render();detail.all(node=>node.type==='input'&&node.props.inputMode==='decimal')[0].props.onChange({target:{value:'115'}});detail.render();detail.button('Save correction').props.onClick();await flush();f.render();detail.render({...information(),routine:undefined});f.all(node=>node.type==='./workout-panel'&&node.props.title==='Your session')[0].props.onClose();f.render();assert.equal(saved.data.sets[0].load,115);assert.equal(view().load,'115');assert.equal(view().programWeightChanged,false);view().onReps('10');f.render();view().onSaveSet();await flush();f.render();assert.equal(writes.every(w=>w.kind==='workout'),true);assert.equal(routine.data.exercises[0].load,100);detail.unmount();f.unmount();
});

test('information correction stays editable inside the setup-note render wrapper while note editors are disabled',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Nested correction',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1};workout.data=session.reviseWorkoutSet(workout.data,{exerciseId:routine.data.exercises[0].id,reps:8,load:100,warmup:false},'2026-09-17T12:00:00.000Z');const writes=[];
 const information=component('workout-information',{workout,routine,busy:false,setDirty:false,reviewDirty:false,onSave:async record=>{writes.push(structuredClone(record));return true;},onReview(){},onProgramSaved(){},onDirty(){}},{'./shared':{useWorkoutCancel:fn=>fn}});
 const setupProps=()=>information.all(node=>node.type==='./exercise-setup-notes')[0].props;information.render();const setup=component('exercise-setup-notes',setupProps(),{'./shared':{useWorkoutCancel:fn=>fn}});setup.render();setup.button('Correct').props.onClick();information.render();setup.render(setupProps());assert.equal(setupProps().disabled,true,'reusable note editing pauses during a set correction');assert.ok(setup.all(node=>node.type==='textarea').every(node=>node.props.disabled===true));assert.ok(setup.all(node=>node.type==='fieldset').every(node=>node.props.disabled===false),'the aggregate setup-note wrapper does not disable its rendered correction rows');assert.equal(setup.button('Cancel').props.disabled,undefined);assert.equal(setup.button('Save correction').props.disabled,undefined);
 setup.all(node=>node.type==='input'&&node.props.inputMode==='decimal')[0].props.onChange({target:{value:'105.5'}});information.render();setup.render(setupProps());assert.equal(setup.all(node=>node.type==='input'&&node.props.inputMode==='decimal')[0].props.value,'105.5');setup.button('Cancel').props.onClick();information.render();setup.render(setupProps());assert.equal(writes.length,0);assert.equal(setup.all(node=>node.props?.className==='session-information-correction').length,0);
 setup.button('Correct').props.onClick();information.render();setup.render(setupProps());setup.all(node=>node.type==='input'&&node.props.inputMode==='decimal')[0].props.onChange({target:{value:'110'}});information.render();setup.render(setupProps());setup.button('Save correction').props.onClick();await flush();information.render();setup.render(setupProps());assert.equal(writes.length,1);assert.equal(writes[0].data.sets[0].load,110);assert.equal(writes[0].data.sets[0].completedAt,'2026-09-17T12:00:00.000Z');assert.deepEqual(writes[0].data.exercises,workout.data.exercises);assert.equal(setup.all(node=>node.props?.className==='session-information-correction').length,0);setup.unmount();information.unmount();
});

test('workout overview and resume retain the exact set draft, rest deadline and mounted summary review',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Return to overview',preferences:'',exercises:[{...presets.presetExercise('Bench press'),load:100}],archived:false}},workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1};workout.data.restUntil=new Date(Date.now()+120_000).toISOString();const deadline=workout.data.restUntil,reads=[],writes=[];
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>{reads.push(path);return path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[workout]}:path.startsWith('?exercise-performance')?{performance:null}:null;},saveRecord:async(kind,record)=>{writes.push({kind,record});return {...record,version:record.version+1};}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props,sessionView=()=>f.all(node=>node.props?.className==='workout-session-view')[0];f.render();await flush();f.render();await flush();f.render();view().onReps('9');view().onLoad('135.');f.render();view().onOverview();f.render();assert.equal(sessionView().props.hidden,true);assert.equal(view().visible,false);assert.ok(f.button('Resume workout'));assert.equal(view().load,'135.');assert.equal(view().reps,'9');assert.equal(view().workout.data.restUntil,deadline);assert.equal(f.all(node=>node.type==='./routine-preview').length,1);
 f.button('Resume workout').props.onClick();f.render();assert.equal(sessionView().props.hidden,false);assert.equal(view().load,'135.');assert.equal(view().reps,'9');assert.equal(view().workout.data.restUntil,deadline);
 view().onCancelCorrection();f.render();view().onPlan();f.render();f.all(node=>node.type==='./workout-information')[0].props.onReview();f.render();assert.equal(view().reviewing,true);const reviewKey=view().review.key,review=component('workout-review',view().review.props,{'./shared':{useWorkoutCancel:fn=>fn}});review.render();review.all(node=>node.type==='textarea')[0].props.onChange({target:{value:'Still checking my workout.'}});review.render();f.render();view().onOverview();f.render();review.render(view().review.props);assert.equal(sessionView().props.hidden,true);assert.equal(view().review.key,reviewKey);assert.equal(review.all(node=>node.type==='textarea')[0].props.value,'Still checking my workout.');f.button('Resume workout').props.onClick();f.render();review.render(view().review.props);assert.equal(view().reviewing,true);assert.equal(view().review.key,reviewKey);assert.equal(review.all(node=>node.type==='textarea')[0].props.value,'Still checking my workout.');assert.equal(view().workout.data.restUntil,deadline);assert.equal(reads.filter(path=>path==='?kind=workout').length,1);assert.equal(writes.length,0);review.unmount();f.unmount();
});

test('session-only added exercise writes only its workout and leaves the saved routine untouched',async()=>{
 const routine={id:randomUUID(),version:1,data:{name:'Additional set',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},programSnapshot=structuredClone(routine),workout={...session.createWorkoutSession(routine,'2026-09-17'),version:1},exercise={...presets.presetExercise('Hammer curl'),load:25},candidate={...workout,data:{...session.appendWorkoutExercise(workout.data,exercise,{reps:9,load:25,warmup:false},'2026-09-17T12:00:00.000Z'),notes:'One extra exercise.'}},writes=[];let saved=workout;
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});saved={...record,version:2};return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;f.render();await flush();f.render();await flush();f.render();assert.equal(await view().review.props.onAddExercise(candidate,exercise,false),true);f.render();assert.deepEqual(writes.map(write=>write.kind),['workout']);assert.deepEqual(writes[0].record,candidate);assert.deepEqual(routine,programSnapshot);assert.deepEqual(saved.data.exercises,workout.data.exercises);assert.equal(saved.data.additionalExercises[0].name,'Hammer curl');assert.equal(view().target.exercise.id,workout.data.exercises[0].id);f.unmount();
});

test('added exercise saves the routine first and a lost workout acknowledgement never repeats that routine save',async()=>{
 let routine={id:randomUUID(),version:1,data:{name:'Save this curl',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};const initialSnapshot=structuredClone(saved.data.exercises),exercise={...presets.presetExercise('Hammer curl'),load:25},candidate={...saved,data:session.appendWorkoutExercise(saved.data,exercise,{reps:9,load:25,warmup:false},'2026-09-17T12:00:00.000Z')},writes=[];let lose=true;
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});if(kind==='routine'){assert.equal(saved.data.sets.length,0);routine={...record,version:2};return routine;}assert.equal(routine.data.exercises.length,2);saved={...record,version:2};if(lose){lose=false;throw new Error('Lost added workout acknowledgement');}return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;f.render();await flush();f.render();await flush();f.render();assert.equal(await view().review.props.onAddExercise(candidate,exercise,true),false);f.render();assert.deepEqual(writes.map(write=>write.kind),['routine','workout']);assert.equal(view().pending,true);assert.equal(f.all(node=>node.type==='./workout-panel'&&node.props.title==='Save added exercise')[0].props.open,false);assert.equal(routine.data.exercises[1].name,exercise.name);assert.notEqual(routine.data.exercises[1].id,exercise.id);
 await f.button('Retry workout save').props.onClick();await flush();f.render();assert.deepEqual(writes.map(write=>write.kind),['routine','workout','workout']);assert.deepEqual(writes[1],writes[2]);assert.equal(view().pending,false);assert.deepEqual(saved.data.exercises,initialSnapshot);assert.equal(saved.data.sets.length,1);f.unmount();
});

test('unknown added routine save keeps its identical payload through login expiry and read-only acknowledgement',async()=>{
 let routine={id:randomUUID(),version:1,data:{name:'Unknown added routine',preferences:'',exercises:[presets.presetExercise('Bench press')],archived:false}},saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};const exercise={...presets.presetExercise('Hammer curl'),load:25},candidate={...saved,data:session.appendWorkoutExercise(saved.data,exercise,{reps:9,load:25,warmup:false},'2026-09-17T12:00:00.000Z')},writes=[];let routineAttempts=0;
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});if(kind==='routine'){routineAttempts++;if(routineAttempts===1){routine={...record,version:2};throw new Error('Lost added routine acknowledgement');}throw Object.assign(new Error('Login expired'),{status:401});}saved={...record,version:2};return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props,panel=()=>f.all(node=>node.type==='./workout-panel'&&node.props.title==='Save added exercise')[0].props;f.render();await flush();f.render();await flush();f.render();await view().review.props.onAddExercise(candidate,exercise,true);f.render();assert.equal(panel().open,true);assert.equal(panel().closeDisabled,true);assert.equal(saved.data.sets.length,0);f.button('Retry routine & exercise save').props.onClick();await flush();f.render();assert.deepEqual(writes[0],writes[1]);assert.equal(panel().closeDisabled,true);assert.equal(view().pending,true);assert.equal(f.all(node=>node.props?.onClick&&node.props.children==='Save exercise only to workout').length,0);assert.equal(saved.data.sets.length,0);
 f.button('Check saved routine').props.onClick();await flush();f.render();assert.deepEqual(writes.map(write=>write.kind),['routine','routine','workout']);assert.deepEqual(writes[2].record,candidate);assert.equal(saved.data.sets.length,1);assert.equal(view().pending,false);assert.equal(panel().open,false);f.unmount();
});

test('added exercise conflict requires explicit review and preserves unrelated routine changes and the session snapshot',async()=>{
 const original=presets.presetExercise('Bench press');let routine={id:randomUUID(),version:1,data:{name:'Conflict addition',weeklySessions:2,preferences:'Original preference',exercises:[original],archived:false}},saved={...session.createWorkoutSession(routine,'2026-09-17'),version:1};const initialSnapshot=structuredClone(saved.data.exercises),exercise={...presets.presetExercise('Hammer curl'),load:25},candidate={...saved,data:session.appendWorkoutExercise(saved.data,exercise,{reps:9,load:25,warmup:false},'2026-09-17T12:00:00.000Z')},squat=presets.presetExercise('Squat'),writes=[];
 const f=component('workouts',{profile:{timezone:'UTC'},active:true,onDirty(){}},{'./shared':{useUnsaved(){},request:async path=>path==='?kind=routine'?{records:[routine],hasMore:false}:path==='?kind=workout'?{records:[saved]}:path.startsWith('?exercise-performance')?{performance:null}:null,saveRecord:async(kind,record)=>{writes.push({kind,record:structuredClone(record)});if(kind==='routine'){if(writes.length===1){routine={...routine,version:2,data:{...routine.data,name:'Changed elsewhere',weeklySessions:4,preferences:'Reviewed seat preference',exercises:[{...original,load:110,setupNote:'Seat 7'},squat]}};throw Object.assign(new Error('Changed'),{status:409});}routine={...record,version:3};return routine;}saved={...record,version:2};return saved;}}});
 const view=()=>f.all(node=>node.type==='./workout-session')[0].props;f.render();await flush();f.render();await flush();f.render();await view().review.props.onAddExercise(candidate,exercise,true);f.render();assert.deepEqual(writes.map(write=>write.kind),['routine']);assert.equal(saved.data.sets.length,0);f.button('Keep added exercise in updated routine').props.onClick();f.render();assert.equal(writes.length,1,'review only stages the merge');f.button('Save routine & exercise').props.onClick();await flush();f.render();assert.deepEqual(writes.map(write=>write.kind),['routine','routine','workout']);assert.equal(writes[1].record.version,2);assert.equal(writes[1].record.data.exercises[2].id,writes[0].record.data.exercises[1].id);assert.equal(routine.data.name,'Changed elsewhere');assert.equal(routine.data.weeklySessions,4);assert.equal(routine.data.preferences,'Reviewed seat preference');assert.equal(routine.data.exercises[0].load,110);assert.equal(routine.data.exercises[0].setupNote,'Seat 7');assert.deepEqual(routine.data.exercises[1],squat);assert.equal(routine.data.exercises[2].name,exercise.name);assert.deepEqual(saved.data.exercises,initialSnapshot);assert.deepEqual(saved.data,candidate.data);f.unmount();
});
