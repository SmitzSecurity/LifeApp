import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {debtSchema,debtEstimate} from '../lib/life/debt.ts';
import {LOAN_TYPES,LOAN_PRESETS,loanPreset} from '../lib/life/loan-presets.ts';
import {budgetSchema,budgetSummary,recurringSchema,occurrenceId,transactionSchema} from '../lib/life/modules.ts';
import {scheduledDatesInMonth,firstScheduledMonth} from '../lib/life/budget-schedule.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';

const month='2026-09',today='2026-09-16',categoryId='11111111-1111-4111-8111-111111111111';
const baseline={originalBalanceCents:100000,balanceCents:100000,balanceDate:'2026-08-31',annualRatePercent:0,interestMethod:'monthly',otherPaymentCents:0};
const loan=(extra={})=>recurringSchema.parse({id:randomUUID(),title:'Synthetic student loan',kind:'expense',categoryId,amountCents:10000,day:1,debt:{...baseline},...extra});
const plan=item=>budgetSchema.parse({currency:'USD',categories:[{id:categoryId,name:'Loans',limitCents:30000}],recurring:[item],goals:{spending:'',saving:'',investing:''}});
const payment=(item,amountCents=10000,extra={})=>({id:occurrenceId(month,item.id),version:1,data:transactionSchema.parse({date:'2026-09-01',kind:item.kind,categoryId:item.categoryId,amountCents,note:item.title,recurringId:item.id,voided:false,...extra})});
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body,user='a',query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{Origin:'https://life.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),user,db,new Date(today+'T12:00:00Z'));
 const ok=async(body,user='a',query='')=>{const r=await call(body,user,query),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;};
 const setup=()=>ok({action:'profile',profile:{goal:'Synthetic loan tracking',timezone:'UTC',modules:['money'],habits:[],version:0}});
 const save=({id,version,data})=>ok({action:'resource',record:{kind:'transaction',id,version,data}}).then(v=>v.record);
 return {raw,call,ok,setup,save};
}

test('common loan presets offer editable methods without inventing rates, principal or a repayment schedule',()=>{
 assert.deepEqual(LOAN_TYPES,['mortgage','credit-card','student','auto','personal','medical','other']);
 assert.equal(LOAN_PRESETS.length,LOAN_TYPES.length);
 for(const type of LOAN_TYPES){const debt=loanPreset(type,today);assert.equal(debtSchema.safeParse(debt).success,true);assert.equal(debt.paymentStatus,'balance-only');assert.equal(debt.annualRatePercent,undefined);assert.equal(debt.originalBalanceCents,undefined);assert.equal(debt.accruedInterestCents,undefined);assert.equal(debt.balanceCents,0);}
 assert.equal(loanPreset('student',today).interestMethod,'daily');assert.equal(loanPreset('student',today).interestAccrual,'unknown');
 assert.equal(loanPreset('credit-card',today).interestMethod,'statement');assert.equal(loanPreset('auto',today).interestMethod,'daily');
});

test('legacy loan payloads and exact normalization retain their existing monthly meaning',()=>{
 assert.deepEqual(debtSchema.parse(baseline),baseline);
 const item=loan(),estimate=debtEstimate(item,[payment(item)],'2026-09-01');
 assert.equal(estimate.estimateMode,'estimate');assert.equal(estimate.balanceCents,90000);assert.ok(Math.abs(estimate.progress-10)<0.000001);assert.equal(estimate.payoffDate,'2027-06-01');
 assert.equal(Object.hasOwn(item.debt,'loanType'),false);assert.equal(Object.hasOwn(item.debt,'paymentStatus'),false);
});

test('accrued interest is paid before principal and remains separate when interest pauses',()=>{
 const item=loan({debt:{...baseline,loanType:'student',interestMethod:'daily',interestAccrual:'paused',annualRatePercent:undefined,accruedInterestCents:15000}});
 const partial=debtEstimate(item,[payment(item)],'2026-09-01');assert.equal(partial.principalCents,100000);assert.equal(partial.accruedInterestCents,5000);assert.equal(partial.balanceCents,105000);assert.equal(partial.projectedInterestCents,0);assert.match(partial.assumption,/stays paused/);
 const covered=debtEstimate(item,[payment(item,20000)],'2026-09-16');assert.equal(covered.principalCents,95000);assert.equal(covered.accruedInterestCents,0);assert.equal(covered.balanceCents,95000);
 const daily=loan({debt:{...baseline,loanType:'student',interestMethod:'daily',interestAccrual:'accruing',annualRatePercent:3.65,accruedInterestCents:1000}});
 const grown=debtEstimate(daily,[payment(daily,2000)],'2026-09-01');assert.equal(grown.principalCents,99010);assert.equal(grown.accruedInterestCents,0);assert.equal(grown.balanceCents,99010);
});

test('unknown rates, unknown accrual and statement methods preserve snapshots without manufactured payoff or progress',()=>{
 for(const debt of [{...baseline,annualRatePercent:undefined},{...baseline,interestAccrual:'unknown'},{...baseline,interestMethod:'statement'}]){
  const item=loan({debt}),estimate=debtEstimate(item,[payment(item)],today);assert.equal(estimate.estimateMode,'statement');assert.equal(estimate.balanceCents,100000);assert.equal(estimate.payoffDate,null);assert.equal(estimate.projectedPayments,0);assert.equal(estimate.progress,null);assert.equal(estimate.confirmedPaymentCents,10000);
 }
 const missingOriginal=loan({debt:{...baseline,originalBalanceCents:undefined}});assert.equal(debtEstimate(missingOriginal,[],today).progress,null);assert.equal(debtEstimate(missingOriginal,[],today).estimateMode,'estimate');
 for(const interestMethod of ['statement','daily']){const missingInterest=loan({debt:{...baseline,loanType:'student',interestMethod}});assert.match(debtEstimate(missingInterest,[],today).assumption,/Accrued interest.*not supplied/);}
});

test('balance-only loans create no expected payments, category forecast or payoff despite an active flag',()=>{
 for(const active of [true,false]){
  const item=loan({active,amountCents:0,startDate:'2026-09-01',debt:{...baseline,paymentStatus:'balance-only'}});
  assert.deepEqual(scheduledDatesInMonth(month,item),[]);assert.equal(firstScheduledMonth(item),null);assert.equal(budgetSummary(plan(item),[],month).due.length,0);assert.equal(budgetSummary(plan(item),[],month).categories[0].scheduled,0);
  const estimate=debtEstimate(item,[],today);assert.equal(estimate.payoffDate,null);assert.equal(estimate.projectedPayments,0);assert.equal(estimate.estimateMode,'statement');
 }
 const daily=loan({amountCents:0,debt:{...baseline,paymentStatus:'balance-only',interestMethod:'daily',annualRatePercent:3.65}}),estimate=debtEstimate(daily,[],today);
 assert.equal(estimate.balanceCents,100160);assert.equal(estimate.payoffDate,null);assert.equal(estimate.projectedPayments,0);assert.match(estimate.reason,/Balance tracking only/);
 assert.equal(debtEstimate({...daily,debt:{...daily.debt,balanceCents:0}},[],today).payoffDate,null);
});

test('remaining accrued interest keeps a scheduled bill visible when principal is zero',()=>{
 const item=loan({debt:{...baseline,balanceCents:0,accruedInterestCents:1500}}),summary=budgetSummary(plan(item),[],month);
 assert.equal(summary.due.length,1);assert.equal(debtEstimate(item,[],'2026-08-31').balanceCents,1500);assert.equal(debtEstimate(item,[],'2026-08-31').payoffDate,'2026-09-01');
});

test('credit card balance tracking requires transfers and never subtracts logged payments from a stale statement',()=>{
 const item=loan({title:'Synthetic card',kind:'transfer',categoryId:'',amountCents:0,debt:{...loanPreset('credit-card','2026-08-31'),paymentStatus:'scheduled',balanceCents:100000}});
 const actual=payment(item,20000),summary=budgetSummary(plan(item),[actual],month),estimate=debtEstimate(item,[actual],today);
 assert.equal(summary.expenses,0);assert.equal(summary.saving,0);assert.equal(summary.cashFlow,0);assert.equal(summary.due[0].actualCents,20000);
 assert.equal(estimate.balanceCents,100000);assert.equal(estimate.confirmedPaymentCents,20000);assert.equal(estimate.estimateMode,'statement');assert.equal(estimate.payoffDate,null);
 for(const change of [{kind:'expense',categoryId},{debt:{...item.debt,interestMethod:'daily'}},{debt:{...item.debt,otherPaymentCents:1}},{debt:{...item.debt,loanType:'personal'}},{debt:{...item.debt,accruedInterestCents:100}}])assert.equal(recurringSchema.safeParse({...item,...change}).success,false);
});

test('loan validation rejects nonfinite terms, invalid types and incompatible schedules but allows genuinely missing terms',()=>{
 for(const field of ['originalBalanceCents','balanceCents','accruedInterestCents','annualRatePercent','otherPaymentCents'])for(const value of [NaN,Infinity,-Infinity])assert.equal(debtSchema.safeParse({...baseline,[field]:value}).success,false);
 for(const change of [{loanType:'imaginary'},{paymentStatus:'unknown'},{interestAccrual:'sometimes'},{originalBalanceCents:0},{accruedInterestCents:-1}])assert.equal(debtSchema.safeParse({...baseline,...change}).success,false);
 for(const frequency of ['annual','weekly','biweekly','custom'])assert.equal(recurringSchema.safeParse({...loan(),frequency,month:9,startDate:'2026-09-01',...(frequency==='custom'?{custom:{unit:'months',interval:1,days:[1]}}:{})}).success,false);
 assert.equal(debtSchema.safeParse({...baseline,originalBalanceCents:undefined,annualRatePercent:undefined}).success,true);
});

test('balance-only HTTP records reject invented confirmations then retain ordinary exact monthly payment retries and exports',async t=>{
 const f=fixture(t);await f.setup();const item=loan({amountCents:0,debt:{...loanPreset('student','2026-08-31'),balanceCents:100000,accruedInterestCents:1500}}),initial=plan(item);
 const request={action:'budget-item',change:{month,kind:'initialize',initial}};await f.ok(request);assert.equal((await f.ok(request)).record.version,1);
 const transaction=payment(item,10000),confirm={action:'resource',record:{kind:'transaction',...transaction,version:0}};
 const blocked=await f.call(confirm);assert.equal(blocked.status,409);assert.match((await blocked.json()).error,/monthly payment/);
 const scheduled={...item,amountCents:10000,debt:{...item.debt,paymentStatus:'scheduled',annualRatePercent:0,interestAccrual:'accruing'}};
 await f.ok({action:'budget-item',change:{month,kind:'recurring',previous:item,item:scheduled}});
 const first=(await f.ok(confirm)).record;assert.equal((await f.ok(confirm)).record.version,first.version);
 assert.equal((await f.call({action:'budget-item',change:{month,kind:'recurring',previous:scheduled,item}})).status,400);
 const deleted=await f.save({...first,data:{...first.data,deleted:true}});await f.ok({action:'budget-item',change:{month,kind:'recurring',previous:scheduled,item}});
 assert.equal((await f.ok(null,'a','?debt-payments&month='+month)).records[0].data.deleted,true);
 assert.equal((await f.ok(null,'b','?debt-payments&month='+month)).records.length,0);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
 assert.equal((await f.save({...deleted,data:{...deleted.data,deleted:false}})).id,first.id); // historical correction retains identity and terms
});

test('credit card statement records save and export as transfers while deleted and voided payments stay out of estimates',async t=>{
 const f=fixture(t);await f.setup();const item=loan({kind:'transfer',categoryId:'',amountCents:20000,debt:{...loanPreset('credit-card','2026-08-31'),paymentStatus:'scheduled',balanceCents:100000}});
 await f.ok({action:'budget-item',change:{month,kind:'initialize',initial:plan(item)}});
 const saved=await f.save({...payment(item,20000),version:0});assert.equal(saved.data.kind,'transfer');assert.equal(saved.data.categoryName,'');
 const read=await f.ok(null,'a','?debt-payments&month='+month);assert.equal(read.records.length,1);assert.deepEqual(read.suppressedOccurrences,[]);
 const voided=await f.save({...saved,data:{...saved.data,voided:true}});assert.equal(debtEstimate(item,[voided],today).confirmedPayments,0);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});

test('permanently deleted loan payments retire the same occurrence in the dedicated loan read',async t=>{
 const f=fixture(t);await f.setup();const item=loan();await f.ok({action:'budget-item',change:{month,kind:'initialize',initial:plan(item)}});
 const saved=await f.save({...payment(item),version:0});await f.save({...saved,data:{...saved.data,deleted:true}});
 const trash=(await f.ok(null,'a','?trash')).items.find(r=>r.id===saved.id);
 await f.ok({action:'trash',change:{kind:'transaction',id:saved.id,deletedAt:trash.deletedAt,operation:'purge'}});
 const state=await f.ok(null,'a','?debt-payments&month='+month);assert.deepEqual(state.suppressedOccurrences,[saved.id]);assert.equal(state.records.length,0);
 assert.equal((await f.call({action:'resource',record:{kind:'transaction',...payment(item),version:0}})).status,410);
 assert.deepEqual((await f.ok(null,'b','?debt-payments&month='+month)).suppressedOccurrences,[]);
});
