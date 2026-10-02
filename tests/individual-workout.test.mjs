import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as draftTools from '../lib/life/individual-workout.ts';
import * as modules from '../lib/life/modules.ts';
import * as presets from '../lib/life/exercise-presets.ts';
import * as names from '../lib/life/exercise-names.ts';
import * as domain from '../lib/life/domain.ts';
import * as retry from '../lib/life/write-retry.ts';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const date='2026-10-02';
function example(){const draft=draftTools.freshIndividualWorkout(date),exercise=presets.presetExercise('Biceps curl');draft.exercises=[exercise];draft.sets=[draftTools.freshIndividualSet(exercise.id,1)];draft.lastSerials={[exercise.id]:1};return draft;}

test('individual exercise logging requires actual reps and load, including intentional zeroes',()=>{
 const draft=example();assert.throws(()=>draftTools.individualWorkoutRecord(draft,date),/Enter reps and load/);
 draft.sets[0].reps=0;assert.throws(()=>draftTools.individualWorkoutRecord(draft,date),/Enter reps and load/);
 draft.sets[0].load=0;const saved=draftTools.individualWorkoutRecord(draft,date);
 assert.equal(saved.version,0);assert.equal(saved.data.structured.sets[0].reps,0);assert.equal(saved.data.structured.sets[0].load,0);
 assert.equal(saved.data.structured.sets[0].workingSetNumber,1);assert.equal(saved.data.structured.exercises[0].sets,1);
 assert.equal(draft.exercises[0].sets,3,'preset targets are not modified by logging');
 assert.throws(()=>draftTools.individualWorkoutRecord({...draft,date:'2026-10-03'},date),/earlier workout date/);
 assert.throws(()=>draftTools.individualWorkoutRecord({...draft,sets:[{...draft.sets[0],load:NaN}]},date));
 assert.throws(()=>draftTools.individualWorkoutRecord({...draft,sets:[{...draft.sets[0],reps:8.5}]},date));
});

test('warm-ups retain serials and do not consume individual working ordinals or prescribe completed sets',()=>{
 const draft=example(),id=draft.exercises[0].id;
 draft.sets=[{...draftTools.freshIndividualSet(id,2,true),reps:12,load:10},{...draftTools.freshIndividualSet(id,4),reps:8,load:25},{...draftTools.freshIndividualSet(id,5),reps:7,load:25}];
 const saved=draftTools.individualWorkoutRecord(draft,date);
 assert.deepEqual(saved.data.structured.sets.map(set=>set.setNumber),[2,4,5]);
 assert.deepEqual(saved.data.structured.sets.map(set=>set.workingSetNumber),[undefined,1,2]);
 assert.equal(saved.data.structured.exercises[0].sets,2);
 draft.sets=Array.from({length:21},(_,index)=>({...draftTools.freshIndividualSet(id,index+1),reps:8,load:25}));
 assert.throws(()=>draftTools.individualWorkoutRecord(draft,date),/20 working sets/);
 draft.sets=draft.sets.map(set=>({...set,warmup:true}));assert.throws(()=>draftTools.individualWorkoutRecord(draft,date),/20 warm-ups/);
});

function component(file,props,adapters={}){
 const slots=[],effects=new Map();let cursor=0,changed=false,tree;
 const effect=(fn,deps)=>{const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))effects.set(index,{fn,deps});};
 const react={useState(initial){const index=cursor++;slots[index]??={value:typeof initial==='function'?initial():initial};return [slots[index].value,value=>{const next=typeof value==='function'?value(slots[index].value):value;if(!Object.is(next,slots[index].value)){slots[index].value=next;changed=true;}}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect:effect,useId(){return 'preset-panel-'+cursor++;}};
 const imports={react,'react/jsx-runtime':jsx,'@/lib/life/individual-workout':draftTools,'@/lib/life/modules':modules,'@/lib/life/exercise-presets':presets,'@/lib/life/exercise-names':names,'@/lib/life/domain':domain,'@/lib/life/write-retry':retry,'./shared':{request:async()=>({exercises:[]}),useUnsaved(){},useWorkoutCancel:fn=>fn},...adapters};
 const output={},code=transpileModule(readFileSync('app/life/'+file+'.tsx','utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports:output,crypto:{randomUUID},structuredClone,Date,console,Map,require:name=>imports[name]||new Proxy({},{get:(_,key)=>key==='default'?name:String(key)})});
 function render(){let count=0;do{cursor=0;changed=false;effects.clear();tree=output.default(props);assert.ok(++count<15);}while(changed);for(const [index,value] of effects){slots[index]?.cleanup?.();slots[index]={deps:value.deps,cleanup:value.fn()};}return tree;}
 function walk(predicate,node){if(!node||typeof node!=='object')return [];return [...(predicate(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>walk(predicate,child))];}
 const all=predicate=>walk(predicate,tree),text=node=>typeof node==='string'||typeof node==='number'?String(node):[node?.props?.children].flat(Infinity).map(child=>child?text(child):'').join('');
 function button(label){const node=all(item=>item.props?.onClick&&(item.props['aria-label']===label||text(item)===label))[0];assert.ok(node,'Missing '+label);return node;}
 return {render,all,button,unmount(){for(const slot of slots)slot?.cleanup?.();}};
}

test('preset search filters standard and personal exercises and returns an independent fresh snapshot',async()=>{
 const personal={...presets.presetExercise('Biceps curl'),unit:'kg',load:18,setupNote:'Personal grip.'},chosen=[];
 const f=component('exercise-preset-picker',{onSelect:exercise=>chosen.push(exercise)},{'./shared':{request:async()=>({exercises:[personal,{name:'Invalid private record'}]})}});
 f.render();await flush();f.render();f.all(node=>node.props?.className==='exercise-preset-toggle')[0].props.onClick();f.render();
 f.all(node=>node.props?.type==='search')[0].props.onChange({target:{value:' CuRL '}});f.render();
 const results=f.all(node=>node.type==='button'&&node.props.onClick&&node.props.className===undefined);
 assert.ok(results.length>1);assert.ok(results.every(node=>node.props.children.toLowerCase().includes('curl')));
 assert.equal(results.filter(node=>node.props.children==='Biceps curl').length,1,'personal definition replaces the matching standard');
 f.button('Biceps curl').props.onClick();f.render();assert.equal(chosen[0].unit,'kg');assert.equal(chosen[0].setupNote,'Personal grip.');assert.notEqual(chosen[0].id,personal.id);
 chosen[0].muscles.direct.push('abs');assert.deepEqual(personal.muscles.direct,['biceps'],'selected exercise does not mutate a stored definition');
 f.all(node=>node.props?.className==='exercise-preset-toggle')[0].props.onClick();f.render();f.button('Biceps curl').props.onClick();assert.notEqual(chosen[1].id,chosen[0].id);
 f.render();f.all(node=>node.props?.className==='exercise-preset-toggle')[0].props.onClick();f.render();f.all(node=>node.props?.type==='search')[0].props.onChange({target:{value:'NoSuchExercise'}});f.render();assert.equal(f.all(node=>node.props?.role==='status')[0].props.children,'No matching exercises.');f.unmount();
});

test('individual log freezes its entire atomic save through a lost acknowledgement and later expired login',async()=>{
 const writes=[],dirty=[];let attempts=0,saves=0;
 const f=component('individual-workout-log',{profile:{timezone:'UTC'},onDirty:value=>dirty.push(value),onSaved:()=>saves++,onCancel(){}},{'./shared':{useUnsaved:(value,report)=>report(value),useWorkoutCancel:fn=>fn,saveRecord:async(kind,record)=>{assert.equal(kind,'workout-note');writes.push(structuredClone(record));attempts++;if(attempts===1)throw Object.assign(new Error('Acknowledgement lost.'),{status:503});if(attempts===2)throw Object.assign(new Error('Sign in again.'),{status:401});return {...record,version:1};}}});
 f.render();f.all(node=>node.type==='./exercise-preset-picker')[0].props.onSelect(presets.presetExercise('Hammer curl'));f.render();
 const reps=()=>f.all(node=>node.props?.['aria-label']==='Hammer curl set 1 reps')[0],load=()=>f.all(node=>node.props?.['aria-label']==='Hammer curl set 1 load')[0];
 assert.equal(reps().props.value,null);assert.equal(load().props.value,null);reps().props.onValueChange(9);f.render();load().props.onValueChange(22.5);f.render();
 f.button('Save workout').props.onClick();await flush();f.render();assert.equal(writes.length,1);assert.equal(f.all(node=>node.type==='fieldset')[0].props.disabled,true);
 f.button('Retry workout save').props.onClick();await flush();f.render();assert.equal(f.all(node=>node.type==='fieldset')[0].props.disabled,true,'a later login failure cannot release the original unknown write');
 f.button('Retry workout save').props.onClick();await flush();f.render();assert.equal(saves,1);assert.deepEqual(writes[0],writes[1]);assert.deepEqual(writes[1],writes[2]);assert.equal(writes[0].version,0);assert.equal(writes[0].data.structured.sets[0].load,22.5);assert.equal(dirty.at(-1),false);f.unmount();
});

test('individual draft retains removed set serials and guards a repeated save before React commits',async()=>{
 const writes=[];let release;const acknowledgement=new Promise(resolve=>release=resolve),exercise=presets.presetExercise('Curl');
 const f=component('individual-workout-log',{profile:{timezone:'UTC'},onDirty(){},onSaved(){},onCancel(){}},{'./shared':{useUnsaved(){},useWorkoutCancel:fn=>fn,saveRecord:async(_kind,record)=>{writes.push(structuredClone(record));await acknowledgement;return {...record,version:1};}}});
 f.render();f.all(node=>node.type==='./exercise-preset-picker')[0].props.onSelect(exercise);f.render();f.button('Remove Curl set 1').props.onClick();f.render();f.button('Add working set').props.onClick();f.render();
 f.all(node=>node.props?.['aria-label']==='Curl set 1 reps')[0].props.onValueChange(8);f.render();f.all(node=>node.props?.['aria-label']==='Curl set 1 load')[0].props.onValueChange(0);f.render();
 const save=f.button('Save workout');save.props.onClick();save.props.onClick();assert.equal(writes.length,1);assert.equal(writes[0].data.structured.sets[0].setNumber,2,'removed draft serial is never recycled');release();await flush();f.render();f.unmount();
});
