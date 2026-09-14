import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {budgetSchema,recurringSchema,transactionSchema,budgetSummary,occurrenceId} from '../lib/life/modules.ts';
import {scheduledInMonth,firstScheduledMonth,scheduleDate} from '../lib/life/budget-schedule.ts';
import {debtEstimate} from '../lib/life/debt.ts';
import {budgetBuildInput,parseBudgetDraft,budgetImageSchema} from '../lib/life/budget-build-schema.ts';
import {geminiProvider,AI_MODEL,RESERVATION_MICROS} from '../lib/life/ai-provider.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
const now=new Date('2026-09-14T12:00:00.000Z'),month='2026-09';
const debt={originalBalanceCents:60000,balanceCents:60000,balanceDate:'2026-08-31',annualRatePercent:0,interestMethod:'monthly',otherPaymentCents:0};
const rawItem={title:'Medical loan',kind:'expense',category:'Bills',amountCents:10000,day:1,frequency:'monthly-day',week:'first',weekday:1,variable:false,startDate:'2026-09-01',endDate:null,installments:6,debt};
const output={notes:'Check the dates and payment amount.',categories:[{name:'Bills',limitCents:60000}],recurring:[rawItem]};
const providerResult={text:JSON.stringify(output),inputTokens:100,outputTokens:150,thoughtTokens:0,costMicros:500,providerId:'synthetic',modelVersion:AI_MODEL,finishReason:'STOP'};
const png={mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbeQAAAAASUVORK5CYII='};
function loan(patch={}){const {category,endDate,...base}=rawItem;return recurringSchema.parse({...base,id:randomUUID(),categoryId:randomUUID(),...patch});}
function tx(item,date,amount=10000,patch={}){return {id:occurrenceId(date.slice(0,7),item.id),version:1,data:transactionSchema.parse({date,amountCents:amount,kind:'expense',categoryId:item.categoryId,note:item.title,recurringId:item.id,voided:false,...patch})};}
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const state={calls:[],result:providerResult,hook:null};
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const ai={enabled:true,userCapMicros:1000000,globalCapMicros:5000000,provider:{generate:async(input,purpose,image)=>{state.calls.push({input:JSON.parse(input),purpose,image});if(state.hook)await state.hook();return state.result;}}};
 const call=(body,user='a',query='',date=now)=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,date,ai);
 const setup=async(user='a')=>{assert.equal((await call({action:'profile',profile:{goal:'Private journal goal',moduleGoals:{money:'Spend intentionally',fitness:'Private training goal'},timezone:'UTC',modules:['money','fitness'],habits:[],version:0}},user)).status,200);};
 const build=(patch={})=>({action:'budget-build',build:{requestId:randomUUID(),month,text:'Bills allowance $600; medical loan $100/month for six months at 0%.',consent:true,...patch}});
 const initial=budgetSchema.parse({currency:'USD',categories:[{id:randomUUID(),name:'Food',limitCents:30000}],recurring:[],goals:{spending:'',saving:'',investing:''}});
 const change=(change,user='a')=>call({action:'budget-item',change:{month,...change}},user);
 const plan=async()=>((await (await call(null,'a','?kind=budget&month='+month)).json()).records[0]);
 return {raw,db,state,ai,call,setup,build,initial,change,plan};
}
test('finite monthly schedules respect inclusive dates, last weekdays, month ends and first eligible installment',()=>{
 const r=loan({day:31,startDate:'2026-01-31',installments:2});assert.equal(scheduleDate('2026-02',r),'2026-02-28');assert.equal(scheduledInMonth('2026-02',r),true);assert.equal(scheduledInMonth('2026-03',r),false);
 const nth=loan({frequency:'monthly-weekday',week:'last',weekday:5,startDate:'2026-09-26',installments:2});assert.equal(firstScheduledMonth(nth),'2026-10');assert.equal(scheduleDate('2026-10',nth),'2026-10-30');assert.equal(scheduledInMonth('2026-09',nth),false);assert.equal(scheduledInMonth('2026-11',nth),true);assert.equal(scheduledInMonth('2026-12',nth),false);
 assert.equal(scheduledInMonth('2026-10',{...nth,endDate:'2026-10-30'}),true);assert.equal(scheduledInMonth('2026-10',{...nth,endDate:'2026-10-29'}),false);
 assert.equal(recurringSchema.safeParse({...r,startDate:undefined}).success,false);assert.equal(recurringSchema.safeParse({...r,endDate:'2025-01-01'}).success,false);
});
test('expired forecasts disappear while confirmed actual spending survives unchanged',()=>{
 const r=loan({installments:1}),plan=budgetSchema.parse({currency:'USD',categories:[{id:r.categoryId,name:'Bills',limitCents:10000}],recurring:[r],goals:{spending:'',saving:'',investing:''}});
 const result=budgetSummary(plan,[tx(r,'2026-10-01')],'2026-10');assert.equal(result.due.length,0);assert.equal(result.expenses,10000);assert.equal(result.categories[0].spent,10000);
});
test('zero-interest payoff uses confirmed payments and never assumes missed installments were paid',()=>{
 const r=loan();let estimate=debtEstimate(r,[],'2026-08-31');assert.equal(estimate.payoffDate,'2027-02-01');assert.equal(estimate.projectedPayments,6);assert.equal(estimate.projectedInterestCents,0);
 estimate=debtEstimate(r,[tx(r,'2026-09-01')],'2026-09-14');assert.equal(estimate.balanceCents,50000);assert.equal(estimate.confirmedPayments,1);assert.equal(estimate.payoffDate,'2027-02-01');assert.equal(estimate.projectedPayments,5);
 estimate=debtEstimate(r,[],'2026-09-14');assert.equal(estimate.balanceCents,60000);assert.equal(estimate.payoffDate,null);assert.equal(estimate.remainingAtEndCents,10000);assert.match(estimate.reason,/schedule ends/);
 const ignored=[tx(r,'2026-09-01',10000,{voided:true}),tx(r,'2026-09-02',10000,{deleted:true}),tx(r,'2026-10-01'),tx(r,'2026-08-31')];assert.equal(debtEstimate(r,ignored,'2026-09-14').balanceCents,60000);
});
test('monthly interest and non-loan portions are excluded from principal; underpayments have no false payoff date',()=>{
 const r=loan({installments:undefined,amountCents:11000,debt:{...debt,balanceCents:100000,originalBalanceCents:100000,annualRatePercent:12,otherPaymentCents:1000}});
 const e=debtEstimate(r,[tx(r,'2026-09-01',11000)],'2026-09-01');assert.equal(e.balanceCents,91000);assert.equal(e.confirmedPaymentCents,11000);assert.ok(e.projectedInterestCents>0);
 const small=debtEstimate({...r,amountCents:1100},[],'2026-08-31');assert.equal(small.payoffDate,null);assert.match(small.reason,/does not cover/);
 assert.equal(recurringSchema.safeParse({...r,amountCents:1000}).success,false);
});
test('daily simple interest uses elapsed days and updated statement balances reset the estimate baseline',()=>{
 const r=loan({installments:undefined,debt:{...debt,originalBalanceCents:1000000,balanceCents:1000000,balanceDate:'2026-09-01',annualRatePercent:6.8,interestMethod:'daily'}});
 assert.equal(debtEstimate(r,[],'2026-09-02').balanceCents,1000186);
 assert.equal(debtEstimate({...r,debt:{...r.debt,balanceCents:500000,balanceDate:'2026-09-14'}},[tx(r,'2026-09-01',100000)],'2026-09-14').balanceCents,500000);
});
test('budget AI returns durable drafts without changing plans, exposing unrelated context or mixing build namespaces',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');const request=f.build();
 const response=await f.call(request);assert.equal(response.status,200);const result=await response.json();assert.equal(result.build.status,'complete');assert.equal(result.build.result.recurring[0].debt.balanceCents,60000);
 assert.equal(f.raw.prepare('SELECT count(*) n FROM life_resources').get().n,0);assert.equal(f.state.calls[0].purpose,'budget');assert.doesNotMatch(JSON.stringify(f.state.calls),/Private journal|Private training/);
 assert.deepEqual(await (await f.call(request)).json(),result);assert.equal(f.state.calls.length,1);
 assert.equal((await f.call({...request,build:{...request.build,month:'2026-10'}})).status,409);
 assert.equal((await (await f.call(null,'a','?routine-builds')).json()).builds.length,0);assert.equal((await (await f.call(null,'a','?budget-builds')).json()).builds.length,1);assert.equal((await (await f.call(null,'b','?budget-builds')).json()).builds.length,0);
 const backup=validateBackup(await (await f.call(null,'a','?export')).text());assert.equal(backup.routineBuilds.length,1);
});
test('image-only builds send bounded inline media once, persist only its fingerprint, and reject changed-image retries',async t=>{
 const f=fixture(t);await f.setup();const request=f.build({text:'',image:png});assert.equal((await f.call(request,'a','?budget-build')).status,200);assert.deepEqual(f.state.calls[0].image,png);
 const snapshot=f.raw.prepare('SELECT input_snapshot FROM life_routine_builds').get().input_snapshot;assert.doesNotMatch(snapshot,/iVBOR/);assert.match(snapshot,/sha256/);assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
 assert.equal((await f.call(request,'a','?budget-build')).status,200);assert.equal(f.state.calls.length,1);
 assert.equal((await f.call({...request,build:{...request.build,text:'Different screenshot'}})).status,409);
 assert.equal((await f.call(f.build({image:{...png,data:'PGh0bWw+Tm8gaW1hZ2U8L2h0bWw+'}}),'a','?budget-build')).status,400);
});
const hugePNG=Buffer.from(png.data,'base64');hugePNG.writeUInt32BE(9000,16);
test('invalid or oversized image requests and missing consent fail before a reservation',async t=>{
 const f=fixture(t);await f.setup();for(const patch of [{consent:false},{text:'',image:undefined},{image:{mimeType:'image/svg+xml',data:png.data}},{image:{...png,data:'A'.repeat(1_400_004)}},{image:{...png,data:hugePNG.toString('base64')}}])assert.equal((await f.call(f.build(patch),'a','?budget-build')).status,400);
 assert.equal(f.state.calls.length,0);assert.equal(f.raw.prepare('SELECT count(*) n FROM life_ai_usage').get().n,0);
 const huge=new Request('https://life.test/api/life?budget-build',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(1_500_001)});assert.equal((await handleLife(huge,'a',f.db,now,f.ai)).status,413);
 assert.equal((await f.call({action:'profile',profile:{}},'a','?budget-build')).status,400);
});
test('Gemini budget requests use a fixed extraction instruction, JSON schema and inline image rather than arbitrary URLs',async()=>{
 let body;const provider=geminiProvider('synthetic-key',async(url,init)=>{assert.equal(url,`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`);body=JSON.parse(init.body);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(output)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:100,totalTokenCount:200}});});
 await provider.generate('{}','budget',png);assert.match(body.systemInstruction.parts[0].text,/You organize a pasted budget/);assert.deepEqual(body.contents[0].parts[1],{inlineData:png});assert.equal(body.generationConfig.responseFormat.text.mimeType,'application/json');assert.ok(body.generationConfig.responseFormat.text.schema.properties.recurring);
});
test('malformed, truncated or unknown-category responses never create a plan and retain measured usage',async t=>{
 for(const patch of [{text:'not json'},{finishReason:'MAX_TOKENS'},{text:JSON.stringify({...output,recurring:[{...rawItem,category:'Unknown'}]})}]){const f=fixture(t);await f.setup();f.state.result={...providerResult,...patch};const body=await (await f.call(f.build())).json();assert.equal(body.build.status,'failed');assert.equal(body.build.result,null);assert.equal(f.raw.prepare('SELECT cost_micros FROM life_ai_usage').get().cost_micros,500);assert.equal(f.raw.prepare('SELECT count(*) n FROM life_resources').get().n,0);}
 const draft=parseBudgetDraft(JSON.stringify({...output,recurring:[{...rawItem,amountCents:0,debt:null}]}));assert.equal(draft.recurring[0].amountCents,0);assert.equal(recurringSchema.safeParse(draft.recurring[0]).success,false);
});
test('budget builds honor shared cost caps, per-purpose limits, concurrent retries and uncertain outcomes',async t=>{
 const f=fixture(t);await f.setup();f.ai.userCapMicros=RESERVATION_MICROS-1;assert.equal((await f.call(f.build())).status,429);f.ai.userCapMicros=1000000;
 const request=f.build();await Promise.all([f.call(request),f.call(request)]);assert.equal(f.state.calls.length,1);assert.equal((await f.call(f.build())).status,200);assert.equal((await f.call(f.build())).status,429);
 const g=fixture(t);await g.setup();g.state.hook=()=>{throw Error('Synthetic network failure');};const pending=g.build();assert.equal((await g.call(pending)).status,502);assert.equal((await g.call(pending)).status,200);assert.equal((await g.call(g.build())).status,429);assert.equal(g.state.calls.length,1);assert.equal(g.raw.prepare('SELECT reserved_micros FROM life_ai_usage').get().reserved_micros,RESERVATION_MICROS);
});
test('reviewed budget import commits atomically, preserves unrelated items and retries without duplicates',async t=>{
 const f=fixture(t);await f.setup();const draft=parseBudgetDraft(JSON.stringify(output));const change={kind:'import',initial:f.initial,categories:draft.categories.map(item=>({previous:null,item})),recurring:draft.recurring.map(item=>({previous:null,item}))};
 const response=await f.change(change);assert.equal(response.status,200);assert.equal((await response.json()).record.version,1);assert.equal((await (await f.change(change)).json()).record.version,1);
 const saved=await f.plan();assert.equal(saved.data.categories.length,2);assert.equal(saved.data.recurring.length,1);assert.equal(saved.data.categories[0].name,'Food');assert.equal(f.raw.prepare("SELECT count(*) n FROM life_resources WHERE kind='transaction'").get().n,0);
 assert.equal((await f.change({...change,recurring:[{previous:null,item:{...draft.recurring[0],id:randomUUID()}}]})).status,409);assert.equal((await f.plan()).data.recurring.length,1);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});
test('same-item import conflict rolls back all draft items while unrelated concurrent edits merge',async t=>{
 const f=fixture(t);await f.setup();await f.change({kind:'initialize',initial:f.initial});const old=f.initial.categories[0];
 const draft=parseBudgetDraft(JSON.stringify(output)),change={kind:'import',categories:[{previous:old,item:{...old,limitCents:50000}},...draft.categories.map(item=>({previous:null,item}))],recurring:draft.recurring.map(item=>({previous:null,item}))};
 await f.change({kind:'category',previous:old,item:{...old,limitCents:60000}});assert.equal((await f.change(change)).status,409);assert.equal((await f.plan()).data.recurring.length,0);assert.equal((await f.plan()).data.categories.length,1);
 change.categories.shift();const existing=(await f.plan()).data.categories[0];const responses=await Promise.all([f.change(change),f.change({kind:'category',previous:existing,item:{...existing,limitCents:70000}})]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal((await f.plan()).data.categories[0].limitCents,70000);
});
test('loan payments are account scoped, carry into an unsaved later month, and expired new occurrences are rejected',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');const r=loan({categoryId:f.initial.categories[0].id,installments:1});await f.change({kind:'recurring',previous:null,item:r,initial:f.initial});
 const payment=tx(r,'2026-09-01');payment.version=0;assert.equal((await f.call({action:'resource',record:{kind:'transaction',...payment}})).status,200);
 assert.equal((await (await f.call(null,'a','?debt-payments&month=2026-10')).json()).records.length,1);assert.equal((await (await f.call(null,'b','?debt-payments&month=2026-10')).json()).records.length,0);
 const plan=(await f.plan()).data;assert.equal((await f.call({action:'budget-item',change:{kind:'initialize',month:'2026-10',initial:plan}})).status,200);
 assert.equal((await f.call({action:'resource',record:{kind:'transaction',...tx(r,'2026-10-01'),version:0}},'a','',new Date('2026-10-14T12:00:00Z'))).status,409);
});
test('loan trash purges debt details but preserves payment references; AI draft purge preserves accounting and blocks reuse',async t=>{
 const f=fixture(t);await f.setup();const r=loan({categoryId:f.initial.categories[0].id});await f.change({kind:'recurring',previous:null,item:r,initial:f.initial});await f.change({kind:'recurring',previous:r,item:{...r,active:false,deleted:true}});
 const trash=await (await f.call(null,'a','?trash')).json();assert.equal(trash.items[0].kind,'recurring');const row=trash.items[0];assert.equal((await f.call({action:'trash',change:{kind:row.kind,id:row.id,deletedAt:row.deletedAt,operation:'purge'}})).status,200);assert.equal((await f.plan()).data.recurring[0].debt,undefined);
 const request=f.build();const generated=await (await f.call(request)).json();await f.call({action:'record-deletion',change:{kind:'build',id:'budget:'+generated.build.id,deleted:true}});const list=await (await f.call(null,'a','?trash')).json(),build=list.items.find(i=>i.kind==='build');await f.call({action:'trash',change:{kind:'build',id:build.id,deletedAt:build.deletedAt,operation:'purge'}});
 assert.equal((await f.call(request)).status,410);assert.equal(f.raw.prepare('SELECT cost_micros FROM life_ai_usage').get().cost_micros,500);assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});
