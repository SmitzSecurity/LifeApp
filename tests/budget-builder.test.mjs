import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {budgetSchema,recurringSchema,transactionSchema,budgetSummary,occurrenceId} from '../lib/life/modules.ts';
import {scheduledInMonth,firstScheduledMonth,scheduleDate} from '../lib/life/budget-schedule.ts';
import {debtEstimate} from '../lib/life/debt.ts';
import {budgetBuildInput,parseBudgetDraft,budgetImageSchema,budgetBuildResult,budgetOutputSchema,budgetInstruction,BUDGET_UPLOAD_BYTES,BUDGET_TEXT_LIMIT} from '../lib/life/budget-build-schema.ts';
import {geminiProvider,AI_MODEL,RESERVATION_MICROS,AIInputRejected} from '../lib/life/ai-provider.ts';
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
test('annual schedules retain the full charge, require a renewal month and leave old monthly items unchanged',()=>{
 const annual=loan({debt:undefined,frequency:'annual',month:9,day:10,installments:undefined,amountCents:11999});
 for(const month of ['2026-08','2026-10','2027-01'])assert.equal(scheduledInMonth(month,annual),false);
 for(const month of ['2026-09','2027-09','2030-09'])assert.equal(scheduledInMonth(month,annual),true);
 for(const month of [undefined,null,0,13,9.5])assert.equal(recurringSchema.safeParse({...annual,month}).success,false);
 const invalid=recurringSchema.safeParse({...annual,debt});assert.equal(invalid.success,false);assert.match(invalid.error.issues[0].message,/monthly payments/);
 const old=loan(),normalized=recurringSchema.parse(old);assert.deepEqual(normalized,old);assert.equal(Object.hasOwn(normalized,'month'),false);
 const plan=budgetSchema.parse({currency:'USD',categories:[{id:annual.categoryId,name:'Subscriptions',limitCents:20000}],recurring:[annual],goals:{spending:'',saving:'',investing:''}});
 assert.equal(budgetSummary(plan,[],'2026-08').categories[0].scheduled,0);
 const due=budgetSummary(plan,[],'2026-09');assert.equal(due.categories[0].scheduled,11999);assert.equal(due.due[0].date,'2026-09-10');assert.equal(due.expenses,0);
});
test('annual start/end dates and installment counts follow yearly occurrences including leap-day clamping',()=>{
 const annual=loan({debt:undefined,frequency:'annual',month:2,day:29,startDate:'2026-03-01',installments:2});
 assert.equal(firstScheduledMonth(annual),'2027-02');assert.equal(scheduleDate('2027-02',annual),'2027-02-28');assert.equal(scheduleDate('2028-02',annual),'2028-02-29');
 assert.equal(scheduledInMonth('2026-02',annual),false);assert.equal(scheduledInMonth('2027-02',annual),true);assert.equal(scheduledInMonth('2028-02',annual),true);assert.equal(scheduledInMonth('2029-02',annual),false);
 assert.equal(firstScheduledMonth({...annual,startDate:'2026-02-28'}),'2026-02');assert.equal(firstScheduledMonth({...annual,startDate:'2028-02-29'}),'2028-02');
 assert.equal(scheduledInMonth('2028-02',{...annual,endDate:'2028-02-29'}),true);assert.equal(scheduledInMonth('2028-02',{...annual,endDate:'2028-02-28'}),false);
 assert.equal(firstScheduledMonth({...annual,month:1,startDate:'2026-12-31'}),'2027-01');
 assert.equal(scheduledInMonth('2027-02',{...annual,active:false}),true); // eligibility is independent of the caller's active/Trash filter
});
test('annual actual payments keep deterministic monthly occurrence IDs, reject off-month charges and preserve history',async t=>{
 const f=fixture(t);await f.setup();const annual=loan({categoryId:f.initial.categories[0].id,debt:undefined,frequency:'annual',month:9,day:10,installments:2,amountCents:11999});
 await f.change({kind:'recurring',previous:null,item:annual,initial:f.initial});const plan=(await f.plan()).data;
 const first={action:'resource',record:{kind:'transaction',...tx(annual,'2026-09-10',11999),version:0}};
 for(let i=0;i<2;i++){const response=await f.call(first);assert.equal(response.status,200);assert.equal((await response.json()).record.version,1);}
 let records=(await (await f.call(null,'a','?kind=transaction&month=2026-09')).json()).records;
 assert.equal(records.length,1);let totals=budgetSummary(plan,records,'2026-09');assert.equal(totals.expenses,11999);assert.equal(totals.categories[0].scheduled,0);
 for(const target of ['2026-10','2027-09','2028-09']){
  assert.equal((await f.call({action:'budget-item',change:{kind:'initialize',month:target,initial:plan}})).status,200);
  const response=await f.call({action:'resource',record:{kind:'transaction',...tx(annual,target+'-10',11999),version:0}},'a','',new Date('2029-01-01T12:00:00Z'));
  assert.equal(response.status,target==='2027-09'?200:409);
 }
 const changed={...annual,endDate:'2026-09-01'};assert.equal((await f.change({kind:'recurring',previous:annual,item:changed})).status,200);
 assert.equal((await f.call(first)).status,200);records=(await (await f.call(null,'a','?kind=transaction&month=2026-09')).json()).records;
 totals=budgetSummary((await f.plan()).data,records,'2026-09');assert.equal(totals.expenses,11999);assert.equal(totals.due.length,0);assert.equal(records[0].id,occurrenceId('2026-09',annual.id));
 assert.ok(validateBackup(await (await f.call(null,'a','?export',new Date('2029-01-01T12:00:00Z'))).text()));
});
test('annual AI drafts round-trip, adopt without division and preserve exact generation and item retries',async t=>{
 const f=fixture(t);await f.setup();const annual={...rawItem,title:'Annual subscription',frequency:'annual',month:9,day:10,amountCents:11999,startDate:null,installments:null,debt:null};
 f.state.result={...providerResult,text:JSON.stringify({...output,recurring:[annual]})};
 const request=f.build({text:'Subscription is $119.99 each year on September 10. Bills monthly allowance $600.'});
 const response=await f.call(request);assert.equal(response.status,200);const result=await response.json(),draft=result.build.result;
 assert.equal(result.build.status,'complete');assert.equal(draft.recurring[0].frequency,'annual');assert.equal(draft.recurring[0].month,9);assert.equal(draft.recurring[0].amountCents,11999);
 assert.deepEqual(await (await f.call(request)).json(),result);assert.equal(f.state.calls.length,1);
 const change={kind:'import',initial:f.initial,categories:draft.categories.map(item=>({previous:null,item})),recurring:draft.recurring.map(item=>({previous:null,item}))};
 for(let i=0;i<2;i++){const saved=await f.change(change);assert.equal(saved.status,200);assert.equal((await saved.json()).record.version,1);}
 assert.equal((await f.plan()).data.recurring.length,1);assert.equal(budgetSummary((await f.plan()).data,[],'2026-09').due[0].amountCents,11999);assert.equal(budgetSummary((await f.plan()).data,[],'2026-10').due.length,0);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
 assert.throws(()=>parseBudgetDraft(JSON.stringify({...output,recurring:[{...annual,month:null}]})));
 assert.throws(()=>parseBudgetDraft(JSON.stringify({...output,recurring:[{...annual,debt}]})));
 assert.equal(budgetBuildResult.safeParse({...draft,recurring:[{...draft.recurring[0],month:undefined}]}).success,false);
 assert.equal(Object.hasOwn(parseBudgetDraft(JSON.stringify({...output,recurring:[{...rawItem,month:null}]})).recurring[0],'month'),false);
 assert.ok(budgetOutputSchema.properties.recurring.items.properties.frequency.enum.includes('annual'));assert.match(budgetInstruction,/never divide it by 12/);
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
 const huge=new Request('https://life.test/api/life?budget-build',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(BUDGET_UPLOAD_BYTES+1)});assert.equal((await handleLife(huge,'a',f.db,now,f.ai)).status,413);
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

test('large budget documents retain every character and round-trip through exact retry and export',async t=>{
 const f=fixture(t);await f.setup();const text='Synthetic monthly allowance $300.\n'.repeat(9800);
 const request=f.build({text});assert.ok(text.length>320000);
 const response=await f.call(request,'a','?budget-build');assert.equal(response.status,200);
 assert.equal(f.state.calls[0].input.description,text.trim());assert.equal((await f.call(request,'a','?budget-build')).status,200);assert.equal(f.state.calls.length,1);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
 assert.equal((await f.call(f.build({text:'x'.repeat(BUDGET_TEXT_LIMIT+1)}),'a','?budget-build')).status,400);
 assert.equal((await f.call(f.build({text:'界'.repeat(350000)}),'a','?budget-build')).status,413);
});
const pdf={mimeType:'application/pdf',data:Buffer.from('%PDF-1.7\nSynthetic fixture only\n%%EOF').toString('base64')};
test('PDFs are signature bounded, mutually exclusive with images and fingerprinted for retries',async t=>{
 const f=fixture(t);await f.setup();const request=f.build({text:'',document:pdf});assert.equal((await f.call(request,'a','?budget-build')).status,200);assert.deepEqual(f.state.calls[0].image,pdf);
 const snapshot=f.raw.prepare('SELECT input_snapshot FROM life_routine_builds').get().input_snapshot;assert.match(snapshot,/application\/pdf/);assert.doesNotMatch(snapshot,/Synthetic fixture/);
 assert.equal((await f.call(request,'a','?budget-build')).status,200);assert.equal(f.state.calls.length,1);
 assert.equal((await f.call({...request,build:{...request.build,document:{...pdf,data:Buffer.from('%PDF-1.7\nChanged\n%%EOF').toString('base64')}}},'a','?budget-build')).status,409);
 for(const patch of [{document:pdf,image:png},{document:{...pdf,data:Buffer.from('<html>Not a PDF</html>').toString('base64')}},{document:{...pdf,mimeType:'text/html'}}])assert.equal((await f.call(f.build(patch),'a','?budget-build')).status,400);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});
test('large/PDF inputs preflight complete token cost before generation, keeping existing reservation',async()=>{
 for(const [text,attachment] of [['x'.repeat(320000),undefined],['{}',pdf]]){
  const calls=[];const provider=geminiProvider('synthetic-key',async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return url.endsWith(':countTokens')?Response.json({totalTokens:170000}):Response.json({candidates:[{content:{parts:[{text:JSON.stringify(output)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:170000,candidatesTokenCount:100,totalTokenCount:170100}});});
  const result=await provider.generate(text,'budget',attachment);assert.equal(calls.length,2);assert.match(calls[0].url,/:countTokens$/);assert.equal(calls[0].body.generateContentRequest.contents[0].parts[0].text,text);
  assert.deepEqual(calls[0].body.generateContentRequest.contents,calls[1].body.contents);assert.ok(result.costMicros<RESERVATION_MICROS);
 }
 for(const reply of [()=>Response.json({totalTokens:180001}),()=>new Response('no',{status:503}),()=>Response.json({totalTokens:-1}),()=>{throw Error('network');}]){
  let calls=0;const provider=geminiProvider('synthetic',async url=>{calls++;assert.match(url,/:countTokens$/);return reply();});
  await assert.rejects(provider.generate('{}','budget',pdf),AIInputRejected);assert.equal(calls,1);
 }
});
test('known input preflight failures release only their own reservation and cannot become a permanent block',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=()=>{throw new AIInputRejected('Use a smaller file.');};
 const request=f.build({document:pdf});assert.equal((await f.call(request,'a','?budget-build')).status,422);
 const row=f.raw.prepare('SELECT status,cost_micros,error_code FROM life_ai_usage').get();assert.equal(row.status,'failed');assert.equal(row.cost_micros,0);assert.equal(row.error_code,'input_preflight_rejected');
 assert.equal((await f.call(request,'a','?budget-build')).status,200);assert.equal(f.state.calls.length,1);
 f.state.hook=null;assert.equal((await f.call(f.build(),'a','?budget-build')).status,200);
});

test('granted budget recovery works through HTTP once, retains old hold and restores building only after known outcome',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=()=>{throw Error('unconfirmed');};const old=f.build();await f.call(old);
 const sourceId=old.build.requestId,stamp=now.toISOString();f.raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,1,?,NULL)').run('a','ai-recovery',sourceId,'',JSON.stringify({sourceId,purpose:'budget',expiresAt:'2026-09-16T12:00:00.000Z'}),stamp);
 let list=await (await f.call(null,'a','?budget-builds')).json();assert.equal(list.recovery.sourceId,sourceId);assert.equal(list.blockedReason,null);
 assert.equal((await f.call(f.build())).status,429);f.state.hook=null;const retry=f.build({recoveryOf:sourceId});
 assert.equal((await f.call(retry)).status,200);assert.equal((await f.call(retry)).status,200);assert.equal(f.state.calls.length,2);
 assert.equal((await f.call(f.build({recoveryOf:sourceId}))).status,429);
 list=await (await f.call(null,'a','?budget-builds')).json();assert.equal(list.recovery,null);assert.equal(list.builds.find(b=>b.id===sourceId).resolvedBlocker,true);assert.equal(list.blockedReason,null);
 const original=f.raw.prepare('SELECT status,cost_micros,reserved_micros FROM life_routine_builds WHERE request_id=?').get('budget:'+sourceId);assert.equal(original.status,'uncertain');assert.equal(original.cost_micros,null);assert.equal(original.reserved_micros,RESERVATION_MICROS);
 assert.equal((await f.call(f.build())).status,429); // regular daily purpose limit still applies
 assert.equal((await f.call(f.build(),'a','',new Date('2026-09-17T12:00:00Z'))).status,200); // even after grant expiry
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});
test('unknown recovery or unrelated pending job blocks new builds without freeing either reservation',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=()=>{throw Error('unconfirmed');};const old=f.build();await f.call(old);const sourceId=old.build.requestId;
 f.raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,1,?,NULL)').run('a','ai-recovery',sourceId,'',JSON.stringify({sourceId,purpose:'budget',expiresAt:'2026-09-16T12:00:00.000Z'}),now.toISOString());
 assert.equal((await f.call(f.build({recoveryOf:sourceId}))).status,502);const list=await (await f.call(null,'a','?budget-builds')).json();assert.equal(list.recovery,null);assert.match(list.blockedReason,/unconfirmed/);
 assert.equal((await f.call(f.build(),'a','',new Date('2026-09-15T12:00:00Z'))).status,429);assert.equal(f.raw.prepare('SELECT SUM(reserved_micros) n FROM life_ai_usage WHERE cost_micros IS NULL').get().n,RESERVATION_MICROS*2);
});

test('a budget recovery grant never hides or bypasses an unrelated pending build',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=()=>{throw Error('unconfirmed');};const old=f.build();await f.call(old);const sourceId=old.build.requestId,stamp=now.toISOString();
 f.raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,1,?,NULL)').run('a','ai-recovery',sourceId,'',JSON.stringify({sourceId,purpose:'budget',expiresAt:'2026-09-16T12:00:00.000Z'}),stamp);
 f.raw.prepare("INSERT INTO life_routine_builds(user_id,request_id,status,input_snapshot,model,price_version,reserved_micros,created_at) VALUES(?,?,'generating','{}',?,?,?,?)").run('a','routine:'+randomUUID(),AI_MODEL,'synthetic',RESERVATION_MICROS,stamp);
 const listed=await (await f.call(null,'a','?budget-builds')).json();assert.equal(listed.recovery.sourceId,sourceId);assert.match(listed.blockedReason,/unconfirmed/);
 assert.equal((await f.call(f.build({recoveryOf:sourceId}))).status,429);assert.equal(f.state.calls.length,1);
});
