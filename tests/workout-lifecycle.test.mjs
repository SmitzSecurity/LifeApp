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
 const imports={react,'react/jsx-runtime':jsx,'@/lib/life/modules':modules,'@/lib/life/domain':domain,'@/lib/life/workout-session':session,'@/lib/life/exercise-presets':presets,'@/lib/life/date-display':dates,'@/lib/life/muscle-groups':muscles,'@/lib/life/muscle-volume':volume,'@/lib/life/exercise-names':names,'@/lib/life/exercise-symbols':symbols,'@/lib/life/write-retry':{definiteClientRejection},
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
