import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as modules from '../lib/life/modules.ts';
import * as schedule from '../lib/life/budget-schedule.ts';
import * as fund from '../lib/life/annual-fund.ts';
import * as loans from '../lib/life/loan-presets.ts';
import * as income from '../lib/life/income-planning.ts';

// Render the real dialog with hook/IO adapters, then invoke its exposed buttons.
// This checks action behavior without adding a browser-test runtime dependency.
function dialog(amount){
 const saved=modules.recurringSchema.parse({id:'11111111-1111-4111-8111-111111111111',title:'Electric',kind:'expense',amountCents:8000,categoryId:'22222222-2222-4222-8222-222222222222',day:5});
 const plan={id:'2026-09',version:1,data:modules.budgetSchema.parse({currency:'USD',categories:[{id:saved.categoryId,name:'Bills',limitCents:20000}],recurring:[saved],goals:{spending:'',saving:'',investing:''}})};
 const draft={...saved,title:'Unfinished title',day:NaN},writes=[],errors=[];let state=0,closed=false;
 const pending={kind:'recurring',month:plan.id,previous:saved,item:{...saved,deleted:true,active:false}};
 const operation={busy:false,pending:null,error:'',setError:value=>errors.push(value),submit:async value=>{writes.push(value);return plan;}};
 const adapters={react:{useState:initial=>[[draft,amount,'never'][state++]??initial,()=>{}]},'react/jsx-runtime':jsx,'@/lib/life/modules':modules,'@/lib/life/budget-schedule':schedule,'@/lib/life/annual-fund':fund,'@/lib/life/loan-presets':loans,'./budget-fields':{useBudgetDirty(){},useItemSave:()=>operation,CurrencyInput:'input'}};
 const code=transpileModule(readFileSync('app/life/budget-recurring.tsx','utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;
 const output={};runInNewContext(code,{exports:output,require:name=>adapters[name]||new Proxy({},{get:(_,key)=>String(key)})});
 const tree=output.default({item:saved,previous:saved,plan,onSave:async()=>plan,onClose:()=>{closed=true;},onDirty(){}});
 function find(node,label){if(!node||typeof node!=='object')return null;if(node.props?.children===label&&node.props.onClick)return node;for(const child of [node.props?.children].flat(Infinity)){const found=find(child,label);if(found)return found;}return null;}
 return {saved,pending,writes,errors,operation,find:label=>find(tree,label),closed:()=>closed};
}

test('recurring Delete uses the saved record even when amount and schedule drafts are invalid',async()=>{
 for(const amount of ['', 'invalid', 'NaN']){
  const f=dialog(amount);f.find('Delete item').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.writes.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0])),f.pending);assert.equal(f.closed(),true);assert.deepEqual(f.errors,[]);
 }
});

test('ordinary recurring Save still rejects invalid draft values without writing',async()=>{
 const f=dialog('invalid');f.find('Save').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.writes.length,0);assert.equal(f.closed(),false);assert.equal(f.errors.length,1);
});

test('a pending recurring mutation retries exactly despite unrelated invalid form drafts',async()=>{
 const f=dialog('invalid');f.operation.pending=f.pending;f.find('Save').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.writes.length,1);assert.equal(f.writes[0],f.pending);assert.equal(f.closed(),true);assert.deepEqual(f.errors,[]);
});

function budgetFields(save){
 const states=[];let cursor=0;
 const react={useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];}};
 const adapters={react,'react/jsx-runtime':jsx,'@/lib/life/modules':modules};
 const code=transpileModule(readFileSync('app/life/budget-fields.tsx','utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;
 const output={};runInNewContext(code,{exports:output,require:name=>adapters[name]||new Proxy({},{get:(_,key)=>String(key)})});
 return {...output,render:()=>{cursor=0;return output.useItemSave(save);}};
}

test('Budget retry classification retains earlier unknown outcomes after authentication rejection',()=>{
 const {definiteBudgetRejection}=budgetFields(async()=>{});
 for(const status of [undefined,500,503])for(const retrying of [false,true])assert.equal(definiteBudgetRejection(status,retrying),false);
 for(const status of [401,403]){assert.equal(definiteBudgetRejection(status,false),true);assert.equal(definiteBudgetRejection(status,true),false);}
 for(const status of [400,404,409,422,429])assert.equal(definiteBudgetRejection(status,true),true);
});

test('Budget item saves keep the exact lost-write snapshot through auth failures until acknowledgement',async()=>{
 const statuses=[503,401,403,200],writes=[],original={id:'saved-record',amount:123},edited={id:'saved-record',amount:999};
 const f=budgetFields(async item=>{writes.push(item);const status=statuses.shift();if(status!==200)throw Object.assign(Error('Synthetic rejection'),{status});return {saved:true};});
 await f.render().submit(original);
 for(let attempt=0;attempt<2;attempt++){
  const operation=f.render();assert.equal(operation.pending,original);assert.equal(operation.busy,false);await operation.submit(edited);
 }
 assert.equal(f.render().pending,original);
 assert.deepEqual(await f.render().submit(edited),{saved:true});assert.equal(f.render().pending,null);
 assert.equal(writes.length,4);assert.ok(writes.every(item=>item===original));
});

test('a first Budget item authentication rejection still unlocks the unsaved draft',async()=>{
 for(const status of [401,403]){
  const f=budgetFields(async()=>{throw Object.assign(Error('Sign in again'),{status});});
  await f.render().submit({id:'unsaved'});assert.equal(f.render().pending,null);assert.equal(f.render().busy,false);
 }
});

function component(file,props,{request=async()=>({records:[]}),saveRecord=async(_kind,record)=>({...record,version:record.version+1}),globals={}}={}){
 const slots=[];let cursor=0,changed=false,tree;
 const same=(a,b)=>!!a&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;changed=true;}}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
  useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
  useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!same(previous?.deps,deps))slots[i]={deps,fn,cleanup:previous?.cleanup,pending:true};},
  useId:()=>react.useMemo(()=> 'synthetic-section',[]),
  useSyncExternalStore(subscribe,snapshot){const [value,setValue]=react.useState(snapshot);react.useEffect(()=>subscribe(()=>setValue(snapshot())),[subscribe,snapshot]);return value;},
 };
 const adapters={react,'react/jsx-runtime':jsx,'@/lib/life/modules':modules,'@/lib/life/budget-schedule':schedule,'@/lib/life/annual-fund':fund,'@/lib/life/loan-presets':loans,'@/lib/life/income-planning':income,'@/lib/life/domain':{todayIn:()=> '2026-09-17'},'./shared':{request,saveRecord,useUnsaved(){}},'./budget-fields':{useBudgetDirty(){},useItemSave:()=>({busy:false,pending:null,error:'',setError(){}})}};
 const code=transpileModule(readFileSync('app/life/'+file+'.tsx','utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,output={};
 runInNewContext(code,{exports:output,crypto,structuredClone,...globals,require:name=>adapters[name]||new Proxy({},{get:(_,key)=>String(key)})});
 function render(){let attempts=0;do{changed=false;cursor=0;tree=output.default(props);assert.ok(++attempts<10,'render state should settle');}while(changed);for(const slot of slots)if(slot?.pending){slot.pending=false;slot.cleanup?.();slot.cleanup=slot.fn();}return tree;}
 function walk(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(child=>walk(child))];}
 const nodes=()=>walk(tree);
 render();return {props,render,nodes,find:predicate=>nodes().find(predicate),unmount(){for(const slot of slots)slot?.cleanup?.();},async flush(){await new Promise(resolve=>setImmediate(resolve));return render();}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const categoryId='22222222-2222-4222-8222-222222222222',billId='11111111-1111-4111-8111-111111111111',incomeId='33333333-3333-4333-8333-333333333333';
const budgetPlan=()=>({id:'2026-09',version:1,data:modules.budgetSchema.parse({currency:'USD',categories:[{id:categoryId,name:'Bills',limitCents:20000}],recurring:[{id:billId,title:'Electric',kind:'expense',amountCents:8000,categoryId,day:5},{id:incomeId,title:'Payday',kind:'income',categoryId:'',amountCents:100000,day:16}],goals:{spending:'',saving:'',investing:''}})});

test('Budget keeps scoped due and allocation editors after independent saved records change, then releases them on cancel',async()=>{
 const plan=budgetPlan(),source={id:modules.occurrenceId(plan.id,incomeId),version:1,data:modules.transactionSchema.parse({date:'2026-09-16',kind:'income',amountCents:100000,categoryId:'',note:'Payday',recurringId:incomeId,voided:false,incomeDetails:{grossCents:100000,plan:{withholdings:[],saving:{mode:'percent',value:10}}}})};
 const initial=deferred();let savedPlan=plan;
 const f=component('budget',{profile:{timezone:'UTC'},onDirty(){},onProfileSaved(){}},{request:async(path,body)=>{
  if(body)return {record:savedPlan};await initial.promise;
  if(path==='?kind=budget')return {records:[plan]};if(path.startsWith('?kind=budget&'))return {records:[plan]};return {records:[source]};
 }});
 initial.resolve();await f.flush();
 const expected=id=>f.find(node=>node.type?.name==='ExpectedItem'&&node.props.due.id===id),dueId=modules.occurrenceId(plan.id,billId),allocationId=income.incomeAllocationId(source.id,'saving');
 assert.ok(expected(dueId));assert.ok(expected(allocationId));
 expected(dueId).props.onDirty('transaction-editor:due:'+dueId,true);expected(allocationId).props.onDirty('transaction-editor:category-due:'+categoryId+':'+allocationId,true);f.render();
 savedPlan={...plan,version:2,data:{...plan.data,recurring:plan.data.recurring.filter(item=>item.id!==billId)}};
 await f.find(node=>node.props?.category?.id===categoryId).props.onSave({kind:'recurring',month:plan.id,previous:plan.data.recurring[0],item:{...plan.data.recurring[0],deleted:true}});f.render();
 assert.ok(expected(dueId),'an open confirmation survives deletion of its schedule elsewhere');
 await expected(allocationId).props.onSave({...source,data:{...source.data,deleted:true}});f.render();
 assert.ok(expected(allocationId),'an open allocation survives deletion of its income source elsewhere');
 assert.equal(expected(allocationId).props.transaction.data.planned,true);
 expected(dueId).props.onDirty('transaction-editor:due:'+dueId,false);expected(allocationId).props.onDirty('transaction-editor:category-due:'+categoryId+':'+allocationId,false);f.render();
 assert.equal(expected(dueId),undefined);assert.equal(expected(allocationId),undefined);
 const month=f.find(node=>node.props?.['aria-label']==='Budget month');month.props.onValueChange('2026-09');f.render();
 assert.ok(f.find(node=>node.props?.category?.id===categoryId),'reselecting the current month must not hide a loaded budget');
});

test('loan reads hide stale figures immediately and ignore results from an earlier plan while preserving card identity',async()=>{
 const plan=budgetPlan();plan.data.recurring=[{...plan.data.recurring[0],debt:loans.loanPreset('other','2026-09-01')}];
 const reads=[],f=component('budget-debts',{plan,today:'2026-09-17',transactions:[],dirtyItems:{},onEdit(){},onAdd(){},onSave(){},onDirty(){}},{request:()=>{const read=deferred();reads.push(read);return read.promise;}});
 const card=()=>f.find(node=>node.type?.name==='LoanCard'),key=card().key;assert.equal(card().props.loaded,false);
 f.props.plan={...plan,version:2};f.render();assert.equal(reads.length,2);
 reads[1].resolve({records:[],suppressedOccurrences:['current']});await f.flush();assert.equal(card().props.loaded,true);assert.deepEqual(card().props.suppressedOccurrences,['current']);
 reads[0].resolve({records:[],suppressedOccurrences:['stale']});await f.flush();assert.deepEqual(card().props.suppressedOccurrences,['current']);assert.equal(card().key,key);
 f.props.plan={...plan,version:3};f.render();assert.equal(card().props.loaded,false);assert.equal(card().props.payments.length,0);assert.equal(card().key,key,'a new read must not remount an open payment editor');
 reads[2].reject(Error('Synthetic read failure'));await f.flush();assert.equal(card().props.loaded,false);f.find(node=>node.props?.children==='Retry').props.onClick();f.render();assert.equal(reads.length,4);
 reads[3].resolve({records:[]});await f.flush();assert.equal(card().props.loaded,true);
});

test('annual fund reloads use only the current request, including disable/re-enable transitions',async()=>{
 const reads=[],profile={version:1,annualFund:{enabled:true}},f=component('budget-annual-fund',{profile,plan:budgetPlan(),today:'2026-09-17',transactions:[],setup:null,onSetup(){},onProfileSaved(){},onSave(){},onDirty(){}},{request:()=>{const read=deferred();reads.push(read);return read.promise;}});
 const balance=cents=>({balance:{balanceCents:cents,monthContributionsCents:cents}}),display=()=>f.nodes().filter(node=>node.type==='strong').map(node=>node.props.children);
 assert.ok(display().includes('…'));reads[0].resolve(balance(12300));await f.flush();assert.ok(display().includes('$123.00'));
 f.props.profile={version:2,annualFund:{enabled:false}};f.render();f.props.profile=profile;f.render();assert.ok(display().includes('…'),'re-enabling must not flash an earlier balance');
 assert.equal(reads.length,2);f.props.profile={...profile,version:3};f.render();reads[2].resolve(balance(45600));await f.flush();assert.ok(display().includes('$456.00'));
 reads[1].resolve(balance(99900));await f.flush();assert.ok(display().includes('$456.00'));assert.ok(!display().includes('$999.00'));
});

test('Budget section preferences subscribe to storage changes without unmounting editor children',()=>{
 const storage=new Map(),listeners=new Map(),window={addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);}};
 let storageFull=false;const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(storageFull)throw Error('Storage full');storage.set(key,value);}},editor=jsx.jsx('input',{defaultValue:'Unsaved synthetic draft'}),f=component('budget-section',{id:'expected',title:'Expected',children:editor},{globals:{window,localStorage,Event}});
 const body=()=>f.find(node=>node.props?.className==='budget-section-body'),toggle=()=>f.find(node=>node.props?.className==='budget-section-toggle');
 toggle().props.onClick();f.render();assert.equal(body().props.hidden,true);assert.equal(body().props.children,editor);assert.equal(storage.get('lifeapp:budget:section:expected'),'closed');
 storage.set('lifeapp:budget:section:expected','open');window.dispatchEvent({type:'storage',key:'lifeapp:budget:section:expected'});f.render();assert.equal(body().props.hidden,false);assert.equal(body().props.children,editor);
 storageFull=true;toggle().props.onClick();f.render();assert.equal(body().props.hidden,true,'storage write failure must not prevent collapsing the section');assert.equal(storage.get('lifeapp:budget:section:expected'),'open');
 toggle().props.onClick();f.render();assert.equal(body().props.hidden,false);
 f.unmount();assert.equal(listeners.get('storage').size,0);assert.equal(listeners.get('lifeapp:budget:section-change').size,0);
});
