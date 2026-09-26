import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {profileSchema} from '../lib/life/domain.ts';
import {budgetSchema,recurringSchema,occurrenceId,budgetSummary} from '../lib/life/modules.ts';
const month='2026-09',now=new Date('2026-09-11T12:00:00Z');
function fixture(){
 const raw=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const state={beforeWrite:null};
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){if(sql.startsWith('WITH incoming')&&state.beforeWrite){const hook=state.beforeWrite;state.beforeWrite=null;hook();}return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body,user='a',query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Origin:'https://life.test'}:{},body:body?JSON.stringify(body):undefined}),user,db,now);
 const change=(change,user)=>call({action:'budget-item',change:{month,...change}},user);
 async function setup(){await call({action:'profile',profile:profileSchema.parse({goal:'Synthetic budget',timezone:'UTC',modules:['money'],habits:[],version:0})});}
 const initial=budgetSchema.parse({currency:'USD',categories:['Bills','Food'].map(name=>({id:randomUUID(),name,limitCents:30000})),recurring:[],goals:{spending:'',saving:'',investing:''}});
 return {raw,call,change,setup,initial,state};
}

test('one recurring occurrence can move, skip and restore without changing its schedule or identity',async()=>{
 const f=fixture();try{await f.setup();const item=recurringSchema.parse({id:randomUUID(),title:'Massage',kind:'expense',amountCents:8000,categoryId:f.initial.categories[0].id,day:1,frequency:'monthly-weekday',week:'last',weekday:5});
 await f.change({kind:'recurring',initial:f.initial,previous:null,item});
 const override={period:month,date:month+'-09',skipped:false},change={kind:'occurrence',recurringId:item.id,period:month,previous:null,item:override};
 let response=await f.change(change);assert.equal(response.status,200);let plan=(await response.json()).record;
 const id=occurrenceId(month,item.id);let summary=budgetSummary(plan.data,[],month);
 assert.equal(summary.due[0].date,month+'-09');assert.equal(summary.due[0].originalDate,month+'-25');assert.equal(summary.due[0].id,id);assert.equal(summary.categories[0].scheduled,8000);
 assert.equal(budgetSummary(plan.data,[],'2026-10').due[0].date,'2026-10-30');
 assert.equal((await (await f.change(change)).json()).record.version,plan.version);
 const payment={kind:'transaction',id,version:0,data:{date:month+'-09',kind:'expense',amountCents:8000,categoryId:item.categoryId,note:item.title,recurringId:item.id,voided:false}};
 response=await f.call({action:'resource',record:payment});assert.equal(response.status,200);const paid=(await response.json()).record;
 assert.equal((await f.change({...change,previous:override,item:{...override,date:month+'-10'}})).status,409);
 response=await f.call({action:'resource',record:{id,version:paid.version,kind:'transaction',data:{...paid.data,deleted:true}}});assert.equal(response.status,200);const deleted=(await response.json()).record;
 const skipped={...override,skipped:true};response=await f.change({...change,previous:override,item:skipped});assert.equal(response.status,200);plan=(await response.json()).record;
 summary=budgetSummary(plan.data,[deleted],month);assert.equal(summary.due.length,0);assert.equal(summary.skipped[0].id,id);assert.equal(summary.categories[0].scheduled,0);assert.equal(summary.expenses,0);
 assert.equal((await f.call({action:'resource',record:{id,version:deleted.version,kind:'transaction',data:{...deleted.data,deleted:false}}})).status,409);
 const trash=f.raw.prepare("SELECT deleted_at FROM life_trash WHERE user_id='a' AND kind='transaction' AND record_id=?").get(id);
 const restore={action:'trash',change:{kind:'transaction',id,deletedAt:trash.deleted_at,operation:'restore'}};
 assert.equal((await f.call(restore)).status,409);
 assert.equal((await f.change({...change,previous:skipped,item:override})).status,200);
 assert.equal((await f.call(restore)).status,200);
 }finally{f.raw.close();}
});

test('advanced date overrides retain separate occurrence IDs, merge other edits and reject stale or cross-month changes',async()=>{
 const f=fixture();try{await f.setup();const item=recurringSchema.parse({id:randomUUID(),title:'Two visits',kind:'expense',amountCents:1000,categoryId:f.initial.categories[0].id,day:1,frequency:'custom',startDate:month+'-01',custom:{unit:'months',interval:1,days:[4,8]}});
 await f.change({kind:'recurring',initial:f.initial,previous:null,item});
 const change=(day,date)=>({kind:'occurrence',recurringId:item.id,period:month+'-'+day,previous:null,item:{period:month+'-'+day,date,skipped:false}});
 const results=await Promise.all([f.change(change('04',month+'-09')),f.change(change('08',month+'-09')),f.change({kind:'category',previous:f.initial.categories[1],item:{...f.initial.categories[1],limitCents:777}})]);
 assert.deepEqual(results.map(r=>r.status),[200,200,200]);
 const plan=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0],due=budgetSummary(plan.data,[],month).due;
 assert.equal(due.length,2);assert.equal(new Set(due.map(d=>d.id)).size,2);assert.ok(due.every(d=>d.date===month+'-09'));assert.deepEqual(due.map(d=>d.occurrenceDate),[month+'-04',month+'-08']);
 assert.equal(plan.data.categories[1].limitCents,777);
 assert.equal((await f.change(change('04',month+'-10'))).status,409);
 assert.equal((await f.change(change('04','2026-10-01'))).status,400);
 assert.equal((await f.change(change('05',month+'-10'))).status,409);
 for(const occurrence of due){const response=await f.call({action:'resource',record:{kind:'transaction',id:occurrence.id,version:0,data:{date:occurrence.date,kind:'expense',amountCents:1000,categoryId:item.categoryId,note:item.title,recurringId:item.id,occurrenceDate:occurrence.occurrenceDate,voided:false}}});assert.equal(response.status,200);}
 assert.equal((await f.change(change('04',month+'-09'),'b')).status,400);
 }finally{f.raw.close();}
});

test('creating in a future month atomically honors an earlier start while preserving saved history and category allowances',async()=>{
 const f=fixture();try{await f.setup();await f.change({kind:'initialize',initial:f.initial});const before=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];
 const future={...f.initial,categories:[...f.initial.categories,{id:randomUUID(),name:'Wellness',limitCents:99000}]};
 const item=recurringSchema.parse({id:randomUUID(),title:'Massage',kind:'expense',amountCents:9000,categoryId:future.categories[2].id,day:1,frequency:'monthly-weekday',week:'last',weekday:5,startDate:'2026-08-01'});
 const change={kind:'recurring',month:'2026-10',initial:future,previous:null,item};
 let response=await f.change(change);assert.equal(response.status,200);const result=await response.json();assert.equal(result.plans.length,3);
 const plans=(await (await f.call(undefined,'a','?kind=budget')).json()).records.sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(plans.map(p=>p.id),['2026-08',month,'2026-10']);
 for(const plan of plans){assert.equal(plan.data.recurring[0].id,item.id);assert.equal(budgetSummary(plan.data,[],plan.id).due.length,1);}
 assert.deepEqual(plans[1].data.categories.slice(0,2),before.data.categories);assert.equal(plans[1].data.categories[2].limitCents,0);assert.ok(plans[0].data.categories.every(c=>c.limitCents===0));assert.equal(plans[2].data.categories[2].limitCents,99000);
 const versions=plans.map(p=>p.version);response=await f.change(change);assert.equal(response.status,200);assert.equal((await response.json()).plans.length,2);
 assert.deepEqual((await (await f.call(undefined,'a','?kind=budget')).json()).records.sort((a,b)=>a.id.localeCompare(b.id)).map(p=>p.version),versions);
 assert.equal((await f.change({kind:'recurring',month,previous:item,item:{...item,deleted:true,active:false}})).status,200);
 assert.equal((await f.change(change)).status,200);const historical=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.equal(historical.data.recurring[0].deleted,true,'retry never resurrects an earlier item');
 assert.equal((await f.change(change,'b')).status,400);assert.equal(f.raw.prepare("SELECT count(*) n FROM life_resources WHERE user_id='b'").get().n,0);
 }finally{f.raw.close();}
});

test('backdated creation rejects a full earlier plan without leaving any partial month writes',async()=>{
 const f=fixture();try{await f.setup();f.initial.recurring=Array.from({length:60},(_,i)=>recurringSchema.parse({id:randomUUID(),title:'Existing '+i,kind:'expense',amountCents:100,categoryId:f.initial.categories[0].id,day:1}));await f.change({kind:'initialize',initial:f.initial});
 const before=f.raw.prepare('SELECT * FROM life_resources').all(),item=recurringSchema.parse({id:randomUUID(),title:'New item',kind:'income',amountCents:100,categoryId:'',day:1,startDate:'2026-08-01'});
 const response=await f.change({kind:'recurring',month:'2026-10',initial:{...f.initial,recurring:[]},previous:null,item});assert.equal(response.status,400);assert.deepEqual(f.raw.prepare('SELECT * FROM life_resources').all(),before);
 }finally{f.raw.close();}
});

test('backdated creation retries its entire atomic write after concurrent edits or an intermediate month is initialized',async()=>{
 const f=fixture();try{await f.setup();await f.change({kind:'initialize',initial:f.initial});
 const interim={...f.initial,categories:f.initial.categories.map(c=>({...c,limitCents:321})),goals:{spending:'Preserve this month',saving:'',investing:''}},item=recurringSchema.parse({id:randomUUID(),title:'Future-created appointment',kind:'expense',amountCents:5000,categoryId:f.initial.categories[0].id,day:5,startDate:'2026-08-01'});
 f.state.beforeWrite=()=>{
  f.raw.prepare("UPDATE life_resources SET payload=json_set(payload,'$.categories[0].limitCents',777),version=version+1 WHERE user_id='a' AND kind='budget' AND resource_id=?").run(month);
  f.raw.prepare("INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at) VALUES('a','budget','2026-10','2026-10',?,1,?)").run(JSON.stringify(interim),now.toISOString());
 };
 const response=await f.change({kind:'recurring',month:'2026-12',initial:f.initial,previous:null,item});assert.equal(response.status,200);
 const plans=(await (await f.call(undefined,'a','?kind=budget')).json()).records.sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(plans.map(p=>p.id),['2026-08',month,'2026-10','2026-12']);assert.ok(plans.every(p=>p.data.recurring.filter(r=>r.id===item.id).length===1));assert.equal(plans[1].data.categories[0].limitCents,777);assert.equal(plans[1].version,3);assert.deepEqual(plans[2].data.categories,interim.categories);assert.deepEqual(plans[2].data.goals,interim.goals);assert.equal(plans[2].version,2);
 }finally{f.raw.close();}
});

test('a permanently retired occurrence cannot be revived by rescheduling it',async()=>{
 const f=fixture();try{await f.setup();const item=recurringSchema.parse({id:randomUUID(),title:'Retired payment',kind:'expense',amountCents:5000,categoryId:f.initial.categories[0].id,day:5});await f.change({kind:'recurring',initial:f.initial,previous:null,item});
 f.raw.prepare("INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) VALUES('a','transaction',?,?,?)").run(occurrenceId(month,item.id),'2026-09-01T12:00:00.000Z',now.toISOString());
 const response=await f.change({kind:'occurrence',recurringId:item.id,period:month,previous:null,item:{period:month,date:month+'-07',skipped:false}});assert.equal(response.status,410);
 }finally{f.raw.close();}
});
test('first transaction can initialize its month automatically without a separate plan save',async()=>{
 const f=fixture();try{await f.setup();const init=await f.change({kind:'initialize',initial:f.initial});assert.equal(init.status,200);
 const record={kind:'transaction',id:randomUUID(),version:0,data:{date:month+'-11',kind:'expense',amountCents:1925,categoryId:f.initial.categories[0].id,note:'Synthetic first transaction',recurringId:null,voided:false}};
 assert.equal((await f.call({action:'resource',record})).status,200);assert.equal((await f.call({action:'resource',record})).status,200);
 assert.equal(f.raw.prepare('SELECT count(*) n FROM life_resources').get().n,2);
 const saved=(await (await f.change({kind:'initialize',initial:{...f.initial,categories:[]}})).json()).record;assert.equal(saved.version,1);assert.equal(saved.data.categories.length,2);
 }finally{f.raw.close();}
});
test('independent concurrent allowance saves merge; unrelated values and ordering survive',async()=>{
 const f=fixture();try{await f.setup();await f.change({kind:'initialize',initial:f.initial});const [a,b]=f.initial.categories;
 const responses=await Promise.all([f.change({kind:'category',previous:a,item:{...a,limitCents:42500}}),f.change({kind:'category',previous:b,item:{...b,name:'Groceries',limitCents:17500}})]);
 assert.deepEqual(responses.map(r=>r.status),[200,200]);const plan=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];
 assert.deepEqual(plan.data.categories.map(c=>[c.id,c.name,c.limitCents]),[[a.id,'Bills',42500],[b.id,'Groceries',17500]]);assert.equal(plan.version,3);
 }finally{f.raw.close();}
});
test('same-item conflicts retain current data; exact retries are idempotent and cannot replay over newer edits',async()=>{
 const f=fixture();try{await f.setup();const category=f.initial.categories[0],change={kind:'category',initial:f.initial,previous:category,item:{...category,limitCents:50000}};
 let response=await f.change(change);assert.equal(response.status,200);assert.equal((await response.json()).record.version,1);
 assert.equal((await (await f.change(change)).json()).record.version,1);
 const conflict=await f.change({...change,item:{...category,limitCents:1}});assert.equal(conflict.status,409);assert.equal((await conflict.json()).record.data.categories[0].limitCents,50000);
 assert.equal((await f.change({kind:'category',previous:change.item,item:{...category,limitCents:60000}})).status,200);
 assert.equal((await f.change(change)).status,409);
 }finally{f.raw.close();}
});
test('new recurring item and first transaction initialization can race without dropping either change',async()=>{
 const f=fixture();try{await f.setup();const item={id:randomUUID(),title:'Electric',kind:'expense',amountCents:8000,categoryId:f.initial.categories[0].id,day:1,frequency:'monthly-weekday',week:'second',weekday:1,variable:true,active:true,deleted:false};
 const results=await Promise.all([f.change({kind:'recurring',initial:f.initial,previous:null,item}),f.change({kind:'initialize',initial:f.initial})]);assert.deepEqual(results.map(r=>r.status),[200,200]);
 const plan=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.equal(plan.data.recurring[0].title,'Electric');assert.equal(plan.data.categories.length,2);
 assert.equal((await f.change({kind:'recurring',previous:null,item:{...item,id:randomUUID(),amountCents:0}})).status,400);
 assert.equal((await f.change({kind:'recurring',previous:{...item,id:randomUUID()},item})).status,400);
 assert.equal((await f.change({kind:'recurring',previous:item,item:{...item,deleted:true,active:false}})).status,200);
 const removed=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.equal(budgetSummary(removed.data,[],month).due.length,0);assert.equal(removed.data.recurring.length,1);
 }finally{f.raw.close();}
});
test('recurring item edits preserve recorded-payment identity and remain scoped to the signed-in account',async()=>{
 const f=fixture();try{await f.setup();const item={id:randomUUID(),title:'Electric',kind:'expense',amountCents:8000,categoryId:f.initial.categories[0].id,day:1,frequency:'monthly-day',week:'first',weekday:1,variable:false,active:true,deleted:false};
 await f.change({kind:'recurring',initial:f.initial,previous:null,item});const record={kind:'transaction',id:occurrenceId(month,item.id),version:0,data:{date:month+'-01',kind:'expense',amountCents:8100,categoryId:item.categoryId,note:item.title,recurringId:item.id,voided:false}};assert.equal((await f.call({action:'resource',record})).status,200);
 assert.equal((await f.change({kind:'recurring',previous:item,item:{...item,categoryId:f.initial.categories[1].id}})).status,400);
 assert.equal((await f.change({kind:'recurring',previous:item,item:{...item,amountCents:9000}})).status,200);
 assert.equal((await f.change({kind:'recurring',previous:item,item:{...item,deleted:true}},'b')).status,400);
 assert.equal((await f.call({action:'budget-item',change:{kind:'initialize',month,initial:f.initial}},null)).status,401);
 assert.equal(f.raw.prepare("SELECT count(*) n FROM life_resources WHERE user_id='b'").get().n,0);
 }finally{f.raw.close();}
});

test('a real purged recurring placeholder does not block live monthly edits or exact retries',async()=>{
 const f=fixture();try{
  await f.setup();const category=f.initial.categories[0];
  const retired=recurringSchema.parse({id:randomUUID(),title:'Retired private bill',kind:'expense',amountCents:8000,categoryId:category.id,day:1});
  const live=recurringSchema.parse({...retired,id:randomUUID(),title:'Current monthly bill',amountCents:12000});
  const initial={...f.initial,recurring:[retired,live]};
  assert.equal((await f.change({kind:'initialize',initial})).status,200);
  const payment={kind:'transaction',id:occurrenceId(month,retired.id),version:0,data:{date:month+'-01',kind:'expense',amountCents:8100,categoryId:category.id,note:'Historical actual payment',recurringId:retired.id,voided:false}};
  assert.equal((await f.call({action:'resource',record:payment})).status,200);
  assert.equal((await f.change({kind:'recurring',previous:retired,item:{...retired,active:false,deleted:true}})).status,200);
  const trash=f.raw.prepare("SELECT * FROM life_trash WHERE user_id='a' AND kind='recurring'").get();
  assert.equal((await f.call({action:'trash',change:{kind:'recurring',id:trash.record_id,deletedAt:trash.deleted_at,operation:'purge'}})).status,200);
  const read=()=>JSON.parse(f.raw.prepare("SELECT payload FROM life_resources WHERE user_id='a' AND kind='budget'").get().payload);
  const placeholder=read().recurring.find(item=>item.id===retired.id),protectedData=recurringSchema.parse(placeholder);
  assert.notEqual(JSON.stringify(placeholder),JSON.stringify(protectedData),'the actual SQLite purge and schema use different key order');
  const historical=f.raw.prepare("SELECT * FROM life_resources WHERE kind='transaction'").all(),retirement=f.raw.prepare('SELECT * FROM life_trash').all();
  const change={kind:'recurring',previous:live,item:{...live,amountCents:12500,title:'Updated current bill'}};
  const edited=await f.change(change);assert.equal(edited.status,200,await edited.clone().text());const saved=(await edited.json()).record;
  assert.equal(saved.data.recurring.find(item=>item.id===live.id).amountCents,12500);
  assert.deepEqual(saved.data.recurring.find(item=>item.id===retired.id),protectedData);
  const retry=await f.change(change);assert.equal(retry.status,200);assert.equal((await retry.json()).record.version,saved.version);
  const allowance=await f.change({kind:'category',previous:category,item:{...category,limitCents:40000}});assert.equal(allowance.status,200,await allowance.clone().text());
  const latest=(await allowance.json()).record,record={kind:'budget',id:month,version:latest.version,data:{...latest.data,goals:{...latest.data.goals,spending:'A still-editable month'}}};
  const direct=await f.call({action:'resource',record});assert.equal(direct.status,200,await direct.clone().text());const directSaved=(await direct.json()).record;
  assert.equal((await (await f.call({action:'resource',record})).json()).record.version,directSaved.version);
  for(const patch of [{title:'Resurrected private text'},{amountCents:2},{purged:undefined},{deleted:false},{active:true}]){
   const altered={...directSaved.data,recurring:directSaved.data.recurring.map(item=>item.id===retired.id?{...item,...patch}:item)};
   assert.equal((await f.call({action:'resource',record:{kind:'budget',id:month,version:directSaved.version,data:altered}})).status,410,JSON.stringify(patch));
  }
  assert.equal((await f.change({kind:'recurring',previous:protectedData,item:{...protectedData,title:'Changed hidden item'}})).status,410);
  assert.equal((await f.call({action:'trash',change:{kind:'recurring',id:trash.record_id,deletedAt:trash.deleted_at,operation:'restore'}})).status,410);
  assert.deepEqual(f.raw.prepare("SELECT * FROM life_resources WHERE kind='transaction'").all(),historical);
  assert.deepEqual(f.raw.prepare('SELECT * FROM life_trash').all(),retirement);
  assert.deepEqual(budgetSummary(read(),[],month).due.map(item=>item.recurringId),[live.id]);
  await f.call({action:'profile',profile:profileSchema.parse({goal:'Separate synthetic account',timezone:'UTC',modules:['money'],habits:[],version:0})},'b');
  assert.equal((await f.call({action:'budget-item',change:{kind:'initialize',month,initial}},'b')).status,200);
  assert.equal((await f.change({kind:'recurring',previous:retired,item:{...retired,title:'Other account active item'}},'b')).status,200);
  assert.deepEqual(read().recurring.find(item=>item.id===retired.id),protectedData);
 }finally{f.raw.close();}
});

test('category order saves for a new month, retains archived identities and retries without another version',async()=>{
 const f=fixture();try{await f.setup();f.initial.categories.push({id:randomUUID(),name:'Archived',limitCents:1200,archived:true});
 const ids=f.initial.categories.map(c=>c.id),order=[ids[1],ids[0],ids[2]],change={kind:'category-order',previous:ids,order,initial:f.initial};
 let response=await f.change(change);assert.equal(response.status,200);const saved=(await response.json()).record;assert.equal(saved.version,1);assert.deepEqual(saved.data.categories.map(c=>c.id),order);
 assert.deepEqual([...saved.data.categories].sort((a,b)=>a.id.localeCompare(b.id)),[...f.initial.categories].sort((a,b)=>a.id.localeCompare(b.id)));
 assert.equal((await (await f.change(change)).json()).record.version,1);
 const read=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.deepEqual(read.data.categories.map(c=>c.id),order);
 }finally{f.raw.close();}
});

test('reordering merges concurrent allowance edits and preserves transactions and recurring references',async()=>{
 const f=fixture();try{await f.setup();const [a,b]=f.initial.categories;
 const item={id:randomUUID(),title:'Electric',kind:'expense',amountCents:8000,categoryId:a.id,day:1,frequency:'monthly-day',week:'first',weekday:1,variable:false,active:true,deleted:false};
 await f.change({kind:'recurring',initial:f.initial,previous:null,item});
 const tx={kind:'transaction',id:randomUUID(),version:0,data:{date:month+'-01',kind:'expense',amountCents:8100,categoryId:a.id,note:'Existing payment',recurringId:null,voided:false}};
 assert.equal((await f.call({action:'resource',record:tx})).status,200);const txBefore=f.raw.prepare("SELECT * FROM life_resources WHERE kind='transaction'").all();
 const responses=await Promise.all([f.change({kind:'category-order',previous:[a.id,b.id],order:[b.id,a.id]}),f.change({kind:'category',previous:a,item:{...a,name:'Utilities',limitCents:45000}})]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
 const saved=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.deepEqual(saved.data.categories.map(c=>c.id),[b.id,a.id]);assert.equal(saved.data.categories[1].limitCents,45000);assert.equal(saved.data.categories[1].name,'Utilities');assert.deepEqual(saved.data.recurring,[item]);assert.deepEqual(f.raw.prepare("SELECT * FROM life_resources WHERE kind='transaction'").all(),txBefore);
 }finally{f.raw.close();}
});

test('category reorder rejects malformed lists, stale order or changed membership and stays account scoped',async()=>{
 const f=fixture();try{await f.setup();f.initial.categories.push({id:randomUUID(),name:'Travel',limitCents:5000,archived:false});await f.change({kind:'initialize',initial:f.initial});const ids=f.initial.categories.map(c=>c.id),reverse=[...ids].reverse();
 for(const order of [[ids[0],ids[0],ids[2]],ids.slice(1),[ids[0],ids[1],randomUUID()]])assert.equal((await f.change({kind:'category-order',previous:ids,order})).status,400);
 assert.equal((await f.change({kind:'category-order',previous:ids,order:reverse})).status,200);
 const conflict=await f.change({kind:'category-order',previous:ids,order:[ids[1],ids[0],ids[2]]});assert.equal(conflict.status,409);assert.deepEqual((await conflict.json()).record.data.categories.map(c=>c.id),reverse);
 const category={id:randomUUID(),name:'New category',limitCents:0,archived:false};await f.change({kind:'category',previous:null,item:category});
 assert.equal((await f.change({kind:'category-order',previous:reverse,order:ids})).status,409);
 assert.equal((await f.change({kind:'category-order',previous:reverse,order:ids},'b')).status,400);assert.equal(f.raw.prepare("SELECT count(*) n FROM life_resources WHERE user_id='b'").get().n,0);
 assert.equal((await f.call({action:'budget-item',change:{kind:'category-order',month,previous:reverse,order:ids}},null)).status,401);
 }finally{f.raw.close();}
});

test('category editor saves names, allowances, removal and order atomically while retaining payment references',async()=>{
 const f=fixture();try{await f.setup();const [a,b]=f.initial.categories;
 const recurring={id:randomUUID(),title:'Electric',kind:'expense',amountCents:8000,categoryId:a.id,day:1,frequency:'monthly-day',week:'first',weekday:1,variable:true,active:true,deleted:false};
 await f.change({kind:'recurring',initial:f.initial,previous:null,item:recurring});
 const record={kind:'transaction',id:occurrenceId(month,recurring.id),version:0,data:{date:month+'-01',kind:'expense',amountCents:7200,categoryId:a.id,note:'Electric payment',recurringId:recurring.id,voided:false}};
 assert.equal((await f.call({action:'resource',record})).status,200);const before=f.raw.prepare("SELECT * FROM life_resources WHERE kind='transaction'").all();
 const change={kind:'category-edit',categories:[{previous:a,item:{...a,name:'Utilities',limitCents:24000}},{previous:b,item:{...b,archived:true}}],ordering:{previous:[a.id,b.id],order:[b.id,a.id]}};
 const response=await f.change(change);assert.equal(response.status,200);const saved=(await response.json()).record;assert.equal(saved.version,2);assert.deepEqual(saved.data.categories,[{...b,archived:true},{...a,name:'Utilities',limitCents:24000}]);
 assert.deepEqual(saved.data.recurring,[recurring]);assert.deepEqual(f.raw.prepare("SELECT * FROM life_resources WHERE kind='transaction'").all(),before);
 assert.equal((await (await f.change(change)).json()).record.version,2);
 const tx=(await (await f.call(undefined,'a','?kind=transaction&month='+month)).json()).records;assert.equal(budgetSummary(saved.data,tx,month).expenses,7200);
 }finally{f.raw.close();}
});

test('category editor conflicts reject the entire change, including order and deletions',async()=>{
 const f=fixture();try{await f.setup();const [a,b]=f.initial.categories;await f.change({kind:'initialize',initial:f.initial});
 await f.change({kind:'category',previous:b,item:{...b,name:'Groceries'}});
 const conflict=await f.change({kind:'category-edit',categories:[{previous:a,item:{...a,archived:true}},{previous:b,item:{...b,limitCents:70000}}],ordering:{previous:[a.id,b.id],order:[b.id,a.id]}});
 assert.equal(conflict.status,409);const saved=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.equal(saved.version,2);assert.deepEqual(saved.data.categories,[a,{...b,name:'Groceries'}]);
 }finally{f.raw.close();}
});

test('category editor merges unrelated concurrent edits and does not require an unchanged order when only fields change',async()=>{
 const f=fixture();try{await f.setup();const [a,b]=f.initial.categories;await f.change({kind:'initialize',initial:f.initial});
 const responses=await Promise.all([f.change({kind:'category-edit',categories:[{previous:a,item:{...a,name:'Utilities'}}]}),f.change({kind:'category',previous:b,item:{...b,limitCents:77700}}),f.change({kind:'category-order',previous:[a.id,b.id],order:[b.id,a.id]})]);assert.deepEqual(responses.map(r=>r.status),[200,200,200]);
 const saved=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.deepEqual(saved.data.categories,[{...b,limitCents:77700},{...a,name:'Utilities'}]);
 }finally{f.raw.close();}
});

test('category editor validates IDs and ordering, rejects stale resurrection and remains account scoped',async()=>{
 const f=fixture();try{await f.setup();const [a,b]=f.initial.categories;await f.change({kind:'initialize',initial:f.initial});
 const edited={previous:a,item:{...a,archived:true}};
 for(const change of [{categories:[edited,edited]},{categories:[{previous:a,item:{...a,id:randomUUID()}}]},{categories:[],ordering:{previous:[a.id,b.id],order:[a.id,a.id]}},{categories:[{previous:{...a,id:randomUUID()},item:a}]}])assert.equal((await f.change({kind:'category-edit',...change})).status,400);
 assert.equal((await f.change({kind:'category-edit',categories:[edited]})).status,200);
 assert.equal((await f.change({kind:'category-edit',categories:[{previous:a,item:{...a,name:'Stale'}}]})).status,409);
 assert.equal((await f.change({kind:'category-edit',categories:[edited]},'b')).status,400);
 assert.equal((await f.call({action:'budget-item',change:{kind:'category-edit',month,categories:[edited]}},null)).status,401);
 }finally{f.raw.close();}
});

test('category editor adds, reorders, edits and archives together with idempotent retries',async()=>{
 const f=fixture();try{await f.setup();const [a,b]=f.initial.categories;
 const added={id:randomUUID(),name:'Travel',limitCents:6500,archived:false};
 const change={kind:'category-edit',initial:f.initial,categories:[{previous:null,item:added},{previous:a,item:{...a,name:'Utilities',limitCents:22000}},{previous:b,item:{...b,archived:true}}],ordering:{previous:[a.id,b.id],order:[added.id,b.id,a.id]}};
 const response=await f.change(change);assert.equal(response.status,200);const saved=(await response.json()).record;
 assert.equal(saved.version,1);assert.deepEqual(saved.data.categories,[added,{...b,archived:true},{...a,name:'Utilities',limitCents:22000}]);
 assert.equal((await (await f.change(change)).json()).record.version,1);
 assert.equal((await f.change({kind:'category',previous:added,item:{...added,limitCents:9000}})).status,200);
 assert.equal((await f.change(change)).status,409);
 const current=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.equal(current.version,2);assert.equal(current.data.categories[0].limitCents,9000);
 }finally{f.raw.close();}
});

test('category editor additions merge unrelated additions, allowances and saved order',async()=>{
 const f=fixture();try{await f.setup();const [a,b]=f.initial.categories;await f.change({kind:'initialize',initial:f.initial});
 await f.change({kind:'category-order',previous:[a.id,b.id],order:[b.id,a.id]});
 const added={id:randomUUID(),name:'Travel',limitCents:6500,archived:false},other={id:randomUUID(),name:'Health',limitCents:12000,archived:false};
 const change={kind:'category-edit',categories:[{previous:null,item:added},{previous:a,item:{...a,name:'Utilities'}}]};
 const responses=await Promise.all([f.change(change),f.change({kind:'category',previous:null,item:other}),f.change({kind:'category',previous:b,item:{...b,limitCents:45000}})]);
 assert.deepEqual(responses.map(r=>r.status),[200,200,200]);
 const saved=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];
 assert.deepEqual(saved.data.categories.slice(0,2),[{...b,limitCents:45000},{...a,name:'Utilities'}]);assert.equal(saved.data.categories.length,4);assert.deepEqual(saved.data.categories.find(c=>c.id===added.id),added);assert.deepEqual(saved.data.categories.find(c=>c.id===other.id),other);
 assert.equal((await (await f.change(change)).json()).record.version,saved.version);
 }finally{f.raw.close();}
});

test('category editor addition conflicts are atomic and reject malformed extended orders',async()=>{
 const f=fixture();try{await f.setup();const [a,b]=f.initial.categories;await f.change({kind:'initialize',initial:f.initial});
 const added={id:randomUUID(),name:'Travel',limitCents:6500,archived:false},edit={previous:null,item:added},previous=[a.id,b.id];
 for(const change of [
  {categories:[edit,edit]},
  {categories:[edit],ordering:{previous,order:previous}},
  {categories:[edit],ordering:{previous,order:[a.id,added.id,added.id]}},
  {categories:[edit],ordering:{previous,order:[a.id,b.id,randomUUID()]}},
  {categories:[{previous:null,item:a}],ordering:{previous,order:previous}},
 ])assert.equal((await f.change({kind:'category-edit',...change})).status,400);
 await f.change({kind:'category',previous:b,item:{...b,name:'Groceries'}});
 const conflict=await f.change({kind:'category-edit',categories:[edit,{previous:b,item:{...b,archived:true}}],ordering:{previous,order:[added.id,b.id,a.id]}});
 assert.equal(conflict.status,409);let saved=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.equal(saved.version,2);assert.deepEqual(saved.data.categories,[a,{...b,name:'Groceries'}]);
 await f.change({kind:'category',previous:null,item:{...added,name:'Different saved item'}});
 assert.equal((await f.change({kind:'category-edit',categories:[edit,{previous:a,item:{...a,archived:true}}]})).status,409);
 saved=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.equal(saved.data.categories[0].archived,false);assert.equal(saved.data.categories[2].name,'Different saved item');
 }finally{f.raw.close();}
});

test('category editor can add to an empty month and respects membership, size and account limits',async()=>{
 const f=fixture();try{await f.setup();const added={id:randomUUID(),name:'First category',limitCents:0,archived:false};
 const initial={...f.initial,categories:[]},change={kind:'category-edit',initial,categories:[{previous:null,item:added}],ordering:{previous:[],order:[added.id]}};
 assert.equal((await f.change(change)).status,200);assert.equal((await (await f.change(change)).json()).record.version,1);
 const another={id:randomUUID(),name:'Second category',limitCents:1,archived:false};
 assert.equal((await f.change({kind:'category',previous:null,item:another})).status,200);
 assert.equal((await f.change({...change,initial:undefined})).status,409);
 assert.equal((await f.change(change,'b')).status,400);assert.equal((await f.call({action:'budget-item',change:{...change,month}},null)).status,401);
 const additions=Array.from({length:29},(_,i)=>({previous:null,item:{id:randomUUID(),name:'Category '+i,limitCents:0,archived:false}}));
 assert.equal((await f.change({kind:'category-edit',categories:additions})).status,400);
 const saved=(await (await f.call(undefined,'a','?kind=budget&month='+month)).json()).records[0];assert.equal(saved.version,2);assert.deepEqual(saved.data.categories,[added,another]);assert.equal(f.raw.prepare("SELECT count(*) n FROM life_resources WHERE user_id='b'").get().n,0);
 }finally{f.raw.close();}
});
