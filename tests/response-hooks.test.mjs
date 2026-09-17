import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {DraftSync} from '../lib/life/draft-sync.ts';
import {createAIStatusPoll} from '../lib/life/ai-status-poll.ts';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function eventTarget(extra={}){const events=new Map();return {...extra,addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener(name,fn){events.get(name)?.delete(fn);},emit(name){for(const fn of events.get(name)||[])fn();},count(){return [...events.values()].reduce((sum,set)=>sum+set.size,0);}};}

// Run the real hooks with a small commit-aware lifecycle adapter. Effects from
// speculative renders are discarded, and cleanup runs before replacement setup.
// This specifically exercises the committed callback / asynchronous reply races.
function mount(file,{adapters={},globals={},exportName='default'}={}){
 let cursor=0,slots=[],pending=[],renderAgain=false,rendering=false,tree,key;
 const same=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 function effect(fn,deps){const i=cursor++,slot=slots[i]??(slots[i]={});if(!same(slot.deps,deps))pending.push({slot,fn,deps});}
 const react={
  useState(initial){const i=cursor++,slot=slots[i]??(slots[i]={value:typeof initial==='function'?initial():initial});return [slot.value,value=>{const next=typeof value==='function'?value(slot.value):value;if(!Object.is(next,slot.value)){slot.value=next;if(rendering)renderAgain=true;}}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useEffect:effect,useLayoutEffect:effect,
  useCallback(fn,deps){const i=cursor++,slot=slots[i]??(slots[i]={});if(!same(slot.deps,deps)){slot.deps=deps;slot.value=fn;}return slot.value;},
  useContext(context){return context.value;},
  createContext(value){return {value};},
  useSyncExternalStore(_subscribe,getSnapshot){cursor++;return getSnapshot();}
 };
 const modules={react,'react/jsx-runtime':jsx,...adapters},output={};
 const code=transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports:output,require:name=>modules[name]||new Proxy({},{get:(_,name)=>String(name)}),setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,...globals});
 const cleanup=()=>{for(const slot of slots)slot?.cleanup?.();};
 return {
  output,
  render(args,commit=true){
   // Component wrappers may key the actual stateful panel by resource identity.
   const wrapped=output[exportName];
   let passes=0;
   do{
    cursor=0;pending=[];renderAgain=false;rendering=true;tree=wrapped(...args);
    if(typeof tree?.type==='function'){
     if(key!==undefined&&tree.key!==key){cleanup();slots=[];cursor=0;pending=[];}
     key=tree.key;tree=tree.type(tree.props);
    }
    rendering=false;
    assert.ok(++passes<10,'Render state adjustment must converge');
   }while(renderAgain);
   if(commit)for(const item of pending){item.slot.cleanup?.();item.slot.deps=item.deps;item.slot.cleanup=item.fn();}
   pending=[];return tree;
  },
  unmount(){cleanup();slots=[];pending=[];}
 };
}
function text(node){if(typeof node==='string'||typeof node==='number')return String(node);if(!node||typeof node!=='object')return '';return [node.props?.children].flat(Infinity).map(text).join('');}
function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;}
const button=(tree,label)=>find(tree,node=>!!node.props?.onClick&&(node.props['aria-label']===label||text(node)===label));

test('AI status uses only committed callbacks and drops old-scope responses and listeners',async()=>{
 const window=eventTarget(),document=eventTarget({visibilityState:'visible'}),reads=[],seen=[];
 const view=mount('app/life/use-ai-status.ts',{exportName:'useAIStatus',adapters:{'@/lib/life/ai-status-poll':{createAIStatusPoll}},globals:{window,document}});
 const config=(scope,label)=>({scope,load:()=>{const read=deferred();reads.push(read);return read.promise;},onData:data=>seen.push([label,data]),shouldPoll:()=>false});
 let state=view.render([config('a','committed')]);assert.equal(reads.length,1);
 view.render([config('a','speculative')],false);
 reads[0].resolve('first');await settle();assert.deepEqual(seen,[['committed','first']]);
 view.render([config('a','new committed')]);const checking=state.check();assert.equal(reads.length,2);
 view.render([config('b','next scope')]);assert.equal(reads.length,3);
 reads[1].resolve('stale');reads[2].resolve('current');await checking;await settle();
 assert.deepEqual(seen,[['committed','first'],['next scope','current']]);
 state=view.render([{...config('b','disabled'),enabled:false}]);assert.equal(state.checking,false);assert.equal(window.count()+document.count(),0);
 view.unmount();
});

test('draft saves keep stable open identity and do not publish through an abandoned callback',async()=>{
 const acknowledgements=[],save=deferred(),original={date:'2026-09-16',journal:'Original',context:{},habits:[],version:1,complete:false};
 const view=mount('app/life/use-draft-sync.ts',{exportName:'useDraftSync',adapters:{'@/lib/life/draft-sync':{DraftSync}},globals:{fetch:()=>save.promise}});
 const first=view.render([entry=>acknowledgements.push(['first',entry.journal]),false]);first.open(original);
 let hook=view.render([entry=>acknowledgements.push(['committed',entry.journal]),false]);assert.equal(first.open,hook.open);
 hook.edit({...original,journal:'Saved text'});hook=view.render([entry=>acknowledgements.push(['committed',entry.journal]),false]);
 const saving=hook.commit(false);
 view.render([entry=>acknowledgements.push(['speculative',entry.journal]),false],false);
 save.resolve(Response.json({entry:{...original,journal:'Saved text',version:2}}));await saving;
 assert.deepEqual(acknowledgements,[['committed','Saved text']]);view.unmount();
});

test('history ignores abandoned searches and refreshes selected filters from the first page',async()=>{
 const reads=[];
 const view=mount('app/life/history.tsx',{adapters:{'./shared':{request:(_path,body)=>{const read=deferred();reads.push({...read,filters:body.filters});return read.promise;}},'@/lib/life/date-display':{formatDate:value=>value},'@/lib/life/domain':{score:()=>({percent:null})}}});
 const props={disabled:false,onOpen(){},onDeleted(){},onBusy(){},searchOpen:true,refreshKey:0};
 let tree=view.render([props]);assert.equal(reads.length,1);
 find(tree,node=>node.type==='input'&&node.props.type==='search').props.onChange({target:{value:'new filter'}});
 tree=view.render([props]);find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
 tree=view.render([props]);assert.equal(reads[1].filters.query,'new filter');
 const row=date=>({date,journal:date,habits:[],complete:true});
 reads[1].resolve({entries:[row('2026-09-16')],nextCursor:'2026-09-16'});await settle();
 reads[0].resolve({entries:[row('2025-01-01')],nextCursor:null});await settle();tree=view.render([props]);
 assert.ok(text(tree).includes('2026-09-16'));assert.ok(!text(tree).includes('2025-01-01'));
 button(tree,'Load older responses').props.onClick();tree=view.render([props]);assert.equal(reads[2].filters.before,'2026-09-16');
 reads[2].resolve({entries:[row('2026-09-15')],nextCursor:null});await settle();tree=view.render([props]);
 assert.equal(button(tree,'Load older responses'),null,'An exhausted page must not reuse its previous cursor');
 find(tree,node=>node.type==='input'&&node.props.type==='search').props.onChange({target:{value:'unapplied draft'}});
 tree=view.render([{...props,refreshKey:1}]);assert.equal(reads[3].filters.query,'new filter');assert.equal(reads[3].filters.before,null);
 assert.equal(find(tree,node=>node.type==='input'&&node.props.type==='search').props.value,'unapplied draft');
 view.unmount();reads[3].resolve({entries:[],nextCursor:null});await settle();
});

test('dictation replaces provisional speech, uses committed callbacks and detaches on hidden-editor unmount',()=>{
 const visible={value:true},instances=[],heard=[],listening=[];
 class Recognition{constructor(){instances.push(this);}start(){}stop(){}abort(){this.aborted=true;}}
 const view=mount('app/life/dictation.tsx',{adapters:{'./shared':{WorkoutToolVisible:visible}},globals:{window:{SpeechRecognition:Recognition},navigator:{language:'en-US'}}});
 const cancelRef={current:null},props={value:'Saved',onChange:value=>heard.push(['committed',value]),onListening:value=>listening.push(value),cancelRef};
 let tree=view.render([props]);button(tree,'Dictate').props.onClick();const r=instances[0],late=r.onresult;
 view.render([{...props,onChange:value=>heard.push(['speculative',value])}],false);
 const event=transcript=>({results:[{isFinal:false,0:{transcript}}]});
 r.onresult(event('one'));r.onresult(event('one sentence'));
 assert.deepEqual(heard,[['committed','Saved\none'],['committed','Saved\none sentence']]);
 view.unmount();assert.equal(cancelRef.current,null);assert.equal(r.aborted,true);assert.equal(r.onresult,null);
 late(event('late transcript'));assert.equal(heard.length,2);assert.equal(listening.at(-1),false);
 visible.value=false;assert.equal(view.render([props]),null);view.unmount();
});

test('workout cancellation retains the last committed discard and registers blocking changes',()=>{
 const registrations=[],discarded=[];
 const context={value:{register(fn,blocked){registrations.push({fn,blocked});return ()=>{registrations.at(-1).removed=true;};},close(){registrations.at(-1).fn();}}};
 const view=mount('app/life/shared.tsx',{exportName:'useWorkoutCancel'});
 view.output.WorkoutCancellation.value=context.value;
 let close=view.render([()=>discarded.push('saved'),false]);
 view.render([()=>discarded.push('speculative'),false],false);close();assert.deepEqual(discarded,['saved']);
 close=view.render([()=>discarded.push('latest'),true]);close();assert.equal(registrations.at(-1).blocked,true);assert.equal(discarded.length,1);
 close=view.render([()=>discarded.push('latest'),false]);close();assert.deepEqual(discarded,['saved','latest']);view.unmount();
});

test('a new analysis period resets local UI and cannot accept the previous period mutation callback',async()=>{
 const write=deferred(),generated=[];let status,checks=0;
 const check=async()=>{checks++;};
 const view=mount('app/life/ai-review.tsx',{adapters:{'./shared':{request:()=>write.promise},'./use-ai-status':{useAIStatus:options=>{status=options;return {check,error:'',delayed:false};}}},globals:{crypto:{randomUUID}}});
 const props={date:'2026-09-16',cadence:'weekly',profile:{version:1,reviewPreferences:{daily:{time:'04:00'}}},synced:true,onBusy(){},onProfileSaved(){},onSettings(){},onGenerated:()=>generated.push('old scope')};
 view.render([props]);
 status.onData({available:true,regenerationsRemaining:3,reports:[{id:'old-report',revision:1,status:'complete',text:'Old period analysis'}]});
 let tree=view.render([props]);const deleting=button(tree,'Delete').props.onClick();
 tree=view.render([{...props,date:'2026-09-17'}]);assert.ok(!text(tree).includes('Old period analysis'));assert.ok(text(tree).includes('Opening analysis'));
 const before=checks;write.resolve({});await deleting;assert.equal(checks,before);assert.deepEqual(generated,[]);view.unmount();
});
