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
