import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {profileSchema} from '../lib/life/domain.ts';
import {budgetSchema,occurrenceId,budgetSummary} from '../lib/life/modules.ts';
const month='2026-09',now=new Date('2026-09-11T12:00:00Z');
function fixture(){
 const raw=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body,user='a',query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Origin:'https://life.test'}:{},body:body?JSON.stringify(body):undefined}),user,db,now);
 const change=(change,user)=>call({action:'budget-item',change:{month,...change}},user);
 async function setup(){await call({action:'profile',profile:profileSchema.parse({goal:'Synthetic budget',timezone:'UTC',modules:['money'],habits:[],version:0})});}
 const initial=budgetSchema.parse({currency:'USD',categories:['Bills','Food'].map(name=>({id:randomUUID(),name,limitCents:30000})),recurring:[],goals:{spending:'',saving:'',investing:''}});
 return {raw,call,change,setup,initial};
}
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
