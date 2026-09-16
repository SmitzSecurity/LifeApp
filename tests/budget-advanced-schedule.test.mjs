import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {scheduledDatesInMonth,firstScheduledMonth,customScheduleSchema} from '../lib/life/budget-schedule.ts';
import {recurringSchema,transactionSchema,budgetSchema,budgetSummary,occurrenceId,incomeAllocations} from '../lib/life/modules.ts';
import {handleLife} from '../lib/life/service.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
import {buildReviewContext} from '../lib/life/review-context.ts';
const now=new Date('2026-09-30T12:00:00.000Z'),month='2026-09';
const category=randomUUID(),otherCategory=randomUUID();
const item=(patch={})=>recurringSchema.parse({id:randomUUID(),title:'Synthetic bill',kind:'expense',amountCents:1000,categoryId:category,day:1,...patch});
const dates=(r,month='2026-09')=>scheduledDatesInMonth(month,r);

test('weekly and biweekly dates stay anchored across month boundaries and count occurrences, not months',()=>{
 const weekly=item({frequency:'weekly',startDate:'2026-09-01'});
 assert.deepEqual(dates(weekly),['2026-09-01','2026-09-08','2026-09-15','2026-09-22','2026-09-29']);
 const biweekly={...weekly,frequency:'biweekly'};
 assert.deepEqual(dates(biweekly),['2026-09-01','2026-09-15','2026-09-29']);assert.deepEqual(dates(biweekly,'2026-10'),['2026-10-13','2026-10-27']);
 assert.deepEqual(dates({...biweekly,installments:3},'2026-10'),[]);
 assert.deepEqual(dates({...weekly,startDate:'2026-09-24',installments:3},'2026-10'),['2026-10-01','2026-10-08']);
 assert.deepEqual(dates({...weekly,endDate:'2026-09-15'}),['2026-09-01','2026-09-08','2026-09-15']);
 assert.deepEqual(dates(weekly,'2026-08'),[]);
});

test('custom week blocks are anchor-relative and support selected weekdays with bounded installments',()=>{
 const r=item({frequency:'custom',startDate:'2026-09-02',custom:{unit:'weeks',interval:2,weekdays:[1,5]}});
 assert.deepEqual(dates(r),['2026-09-04','2026-09-07','2026-09-18','2026-09-21']);
 assert.deepEqual(dates(r,'2026-10'),['2026-10-02','2026-10-05','2026-10-16','2026-10-19','2026-10-30']);
 assert.deepEqual(dates({...r,installments:5},'2026-10'),['2026-10-02']);
 assert.deepEqual(dates({...r,startDate:'2026-09-30',custom:{unit:'weeks',interval:60,weekdays:[1]}}),[]);
 assert.equal(firstScheduledMonth({...r,startDate:'2026-09-30',custom:{unit:'weeks',interval:60,weekdays:[1]}}),'2026-10');
 assert.deepEqual(dates({...r,startDate:'1900-01-01',installments:600},'9999-12'),[]);
});

test('custom monthly dates and weekday rules clamp and deduplicate before installment counting',()=>{
 const twice=item({frequency:'custom',startDate:'2026-09-10',custom:{unit:'months',interval:1,days:[1,15]}});
 assert.deepEqual(dates(twice),['2026-09-15']);assert.deepEqual(dates(twice,'2026-10'),['2026-10-01','2026-10-15']);
 assert.deepEqual(dates({...twice,installments:2},'2026-10'),['2026-10-01']);
 const everyOther={...twice,custom:{unit:'months',interval:2,days:[1,15]}};
 assert.deepEqual(dates(everyOther,'2026-10'),[]);assert.deepEqual(dates({...everyOther,installments:3},'2026-11'),['2026-11-01','2026-11-15']);assert.deepEqual(dates({...everyOther,installments:3},'2027-01'),[]);
 const rules={...twice,startDate:'2026-09-01',custom:{unit:'months',interval:1,weekdayRules:[{week:'first',weekday:1},{week:'last',weekday:5}]}};
 assert.deepEqual(dates(rules),['2026-09-07','2026-09-25']);
 assert.deepEqual(dates({...rules,startDate:'2026-02-01',installments:1,custom:{unit:'months',interval:1,weekdayRules:[{week:'fourth',weekday:5},{week:'last',weekday:5}]}},'2026-02'),['2026-02-27']);
 const clamped={...twice,startDate:'2027-02-01',custom:{unit:'months',interval:1,days:[28,29,30,31]},installments:2};
 assert.deepEqual(dates(clamped,'2027-02'),['2027-02-28']);assert.deepEqual(dates(clamped,'2027-03'),['2027-03-28']);
 assert.deepEqual(dates({...twice,startDate:'1900-01-01',installments:600},'9999-12'),[]);
});

test('custom yearly intervals use explicit anchor, month and day without making the first interval annual',()=>{
 const r=item({frequency:'custom',startDate:'2026-03-01',month:2,day:29,custom:{unit:'years',interval:2},installments:2});
 assert.equal(firstScheduledMonth(r),'2028-02');assert.deepEqual(dates(r,'2027-02'),[]);assert.deepEqual(dates(r,'2028-02'),['2028-02-29']);assert.deepEqual(dates(r,'2029-02'),[]);assert.deepEqual(dates(r,'2030-02'),['2030-02-28']);assert.deepEqual(dates(r,'2032-02'),[]);
 assert.deepEqual(dates({...r,endDate:'2028-02-28'},'2028-02'),[]);
 const legacy=item({frequency:'annual',month:2,day:29,startDate:'2026-03-01',installments:2});assert.equal(firstScheduledMonth(legacy),'2027-02');assert.deepEqual(dates(legacy,'2028-02'),['2028-02-29']);
});

test('advanced schemas reject missing anchors and ambiguous rules; transfers never become expenses or loans',()=>{
 const base=item();for(const frequency of ['weekly','biweekly','custom'])assert.equal(recurringSchema.safeParse({...base,frequency}).success,false);
 for(const custom of [
  {unit:'weeks',interval:1}, {unit:'weeks',interval:1,weekdays:[1,1]}, {unit:'weeks',interval:1,weekdays:[7]},
  {unit:'months',interval:1,days:[1],weekdayRules:[{week:'first',weekday:1}]}, {unit:'months',interval:1,days:[]},
  {unit:'years',interval:1,days:[1]}, {unit:'months',interval:61,days:[1]},
  {unit:'months',interval:1,weekdayRules:[{week:'last',weekday:5},{week:'last',weekday:5}]}
 ])assert.equal(customScheduleSchema.safeParse(custom).success,false);
 assert.equal(recurringSchema.safeParse({...base,frequency:'custom',startDate:'2026-01-01',custom:{unit:'years',interval:1}}).success,false);
 const card=item({kind:'transfer',categoryId:'',amountCents:0,paymentDueDay:25});assert.equal(card.kind,'transfer');
 for(const patch of [{categoryId:category},{incomePlan:{withholdings:[]}},{frequency:'weekly',startDate:'2026-09-01'},{debt:{originalBalanceCents:100,balanceCents:100,balanceDate:'2026-09-01',annualRatePercent:0,interestMethod:'monthly',otherPaymentCents:0}}])assert.equal(recurringSchema.safeParse({...card,...patch}).success,false);
 assert.equal(recurringSchema.safeParse({...base,amountCents:0}).success,false);
 assert.equal(recurringSchema.safeParse({...base,frequency:'biweekly',startDate:'2026-09-01',debt:{originalBalanceCents:100,balanceCents:100,balanceDate:'2026-09-01',annualRatePercent:0,interestMethod:'monthly',otherPaymentCents:0}}).success,false);
});

function fixture(t,recurring=[]){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const state={beforeWrite:null};
 const db={prepare(sql){return {bind(...params){return {async first(){if(sql.startsWith('INSERT INTO life_resources')&&state.beforeWrite){const fn=state.beforeWrite;state.beforeWrite=null;fn(sql,params);}return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body,user='a',query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,now);
 const initial=budgetSchema.parse({currency:'USD',categories:[{id:category,name:'Original category',limitCents:30000},{id:otherCategory,name:'New category',limitCents:40000}],recurring,goals:{spending:'',saving:'',investing:''}});
 const save=({kind,id,version,data},user='a')=>call({action:'resource',record:{kind,id,version,data}},user);
 const setup=async()=>{assert.equal((await call({action:'profile',profile:{goal:'Synthetic',timezone:'UTC',modules:['money'],habits:[],version:0}})).status,200);assert.equal((await save({kind:'budget',id:month,version:0,data:initial})).status,200);};
 const records=async()=> (await (await call(null,'a','?kind=transaction&month='+month)).json()).records;
 const plan=async()=> (await (await call(null,'a','?kind=budget&month='+month)).json()).records[0];
 const payment=(r,date,patch={})=>({kind:'transaction',id:occurrenceId(date,r.id),version:0,data:transactionSchema.parse({date:'2026-09-30',occurrenceDate:date,kind:r.kind,amountCents:r.amountCents||2500,categoryId:r.categoryId,note:r.title,recurringId:r.id,voided:false,...patch})});
 return {raw,state,call,save,setup,records,plan,payment,initial};
}

test('each advanced occurrence confirms once; deleting one does not unconfirm the other, and reconfirmation can use a corrected category',async t=>{
 const r=item({frequency:'weekly',startDate:'2026-09-04'}),f=fixture(t,[r]);await f.setup();
 const first=f.payment(r,'2026-09-04'),second=f.payment(r,'2026-09-11');
 for(const record of [first,first,second])assert.equal((await f.save(record)).status,200);
 assert.equal((await f.records()).length,2);let summary=budgetSummary(f.initial,await f.records(),month);assert.equal(summary.expenses,2000);assert.equal(summary.due.filter(d=>d.recorded).length,2);assert.equal(summary.categories[0].scheduled,2000);
 assert.equal((await f.save({...first,id:occurrenceId(month,r.id),data:{...first.data,occurrenceDate:undefined}})).status,409);
 assert.equal((await f.save(f.payment(r,'2026-09-05'))).status,409);
 assert.equal((await f.save({...first,version:1,data:{...first.data,deleted:true}})).status,200);
 const changed={...r,categoryId:otherCategory};const edit=()=>f.call({action:'budget-item',change:{month,kind:'recurring',previous:r,item:changed}});
 assert.equal((await edit()).status,400);assert.equal((await f.save({...second,version:1,data:{...second.data,deleted:true}})).status,200);assert.equal((await edit()).status,200);
 assert.equal((await f.save({...first,version:2,data:{...first.data,categoryId:otherCategory}})).status,200);assert.equal((await f.save({...first,version:2,data:{...first.data,categoryId:otherCategory}})).status,200);
 let rows=await f.records();assert.equal(rows.find(x=>x.id===first.id).version,3);assert.equal(rows.find(x=>x.id===first.id).data.categoryName,'New category');
 const trash=(await (await f.call(null,'a','?trash')).json()).items.find(x=>x.id===second.id);
 assert.equal((await f.call({action:'trash',change:{kind:'transaction',id:second.id,deletedAt:trash.deletedAt,operation:'restore'}})).status,200);
 rows=await f.records();const restored=rows.find(x=>x.id===second.id);assert.equal(restored.data.categoryId,category);assert.equal(restored.data.categoryName,'Original category');
 assert.equal((await f.save({...restored,kind:'transaction',data:{...restored.data,note:'Historical correction'}})).status,200);
 summary=budgetSummary((await f.plan()).data,await f.records(),month);assert.equal(summary.expenses,2000);assert.equal(summary.due.filter(d=>d.recorded).length,2);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('advanced income creates distinct allocation IDs; permanent prompt deletion never recreates that occurrence',async t=>{
 const policy={withholdings:[],saving:{mode:'percent',value:10}},r=item({kind:'income',categoryId:'',frequency:'biweekly',startDate:'2026-09-01',amountCents:100000,incomePlan:policy}),f=fixture(t,[r]);await f.setup();
 for(const date of ['2026-09-01','2026-09-15'])assert.equal((await f.save(f.payment(r,date,{incomeDetails:{grossCents:100000,plan:policy}}))).status,200);
 const sources=await f.records(),allocations=incomeAllocations(sources,month);assert.equal(allocations.length,2);assert.equal(new Set(allocations.map(a=>a.id)).size,2);assert.match(allocations[0].id,/^allocation:2026-09-(01|15):/);
 const target=allocations[0];assert.equal((await f.save({...target,kind:'transaction',data:{...target.data,deleted:true}})).status,200);
 const trash=(await (await f.call(null,'a','?trash')).json()).items.find(x=>x.id===target.id);assert.equal((await f.call({action:'trash',change:{kind:'transaction',id:target.id,deletedAt:trash.deletedAt,operation:'purge'}})).status,200);
 const loaded=await (await f.call(null,'a','?kind=transaction&month='+month)).json();assert.ok(loaded.suppressedAllocations.includes(target.id));assert.equal(incomeAllocations(loaded.records,month,loaded.suppressedAllocations).length,1);
 assert.equal((await f.save({...target,kind:'transaction',data:{...target.data,planned:false}})).status,410);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('monthly credit card reminders preserve legacy IDs and deadline while actual transfers never inflate budget totals',async t=>{
 const card=item({kind:'transfer',categoryId:'',amountCents:0,day:15,paymentDueDay:25}),f=fixture(t,[card]);await f.setup();
 const before=budgetSummary(f.initial,[],month);assert.equal(before.due[0].id,occurrenceId(month,card.id));assert.equal(before.due[0].paymentDueDate,'2026-09-25');assert.equal(before.due[0].amountCents,0);
 const tx={kind:'transaction',id:occurrenceId(month,card.id),version:0,data:{date:'2026-09-20',kind:'transfer',amountCents:25000,categoryId:'',note:'Credit card payment',recurringId:card.id,voided:false}};
 assert.equal((await f.save({...tx,data:{...tx.data,amountCents:0}})).status,400);assert.equal((await f.save(tx)).status,200);assert.equal((await f.save(tx)).status,200);
 const after=budgetSummary(f.initial,await f.records(),month);assert.equal(after.due[0].recorded,true);assert.equal(after.due[0].actualCents,25000);for(const key of ['income','expenses','saving','investing','cashFlow'])assert.equal(after[key],0);
 assert.equal(after.categories.reduce((n,c)=>n+c.spent+c.scheduled,0),0);validateBackup(await (await f.call(null,'a','?export')).text());
});

test('undoing one advanced income confirmation preserves separately recorded allocations and exact reconfirmation',async t=>{
 const policy={withholdings:[],saving:{mode:'fixed',value:10000}},r=item({kind:'income',categoryId:'',frequency:'weekly',startDate:'2026-09-04',amountCents:100000,incomePlan:policy}),f=fixture(t,[r]);await f.setup();
 const payment=f.payment(r,'2026-09-04',{incomeDetails:{grossCents:100000,plan:policy}});assert.equal((await f.save(payment)).status,200);
 const source=(await f.records())[0],allocation=incomeAllocations([source],month)[0];assert.equal((await f.save({...allocation,kind:'transaction',data:{...allocation.data,planned:false}})).status,200);
 assert.equal((await f.save({...source,kind:'transaction',data:{...source.data,deleted:true}})).status,200);
 let rows=await f.records(),summary=budgetSummary(f.initial,rows,month);assert.equal(summary.income,0);assert.equal(summary.saving,10000);assert.equal(summary.due[0].recorded,false);assert.equal(incomeAllocations(rows,month).length,0);
 const retry={...payment,version:2};assert.equal((await f.save(retry)).status,200);assert.equal((await f.save(retry)).status,200);
 rows=await f.records();summary=budgetSummary(f.initial,rows,month);assert.equal(rows.length,2);assert.equal(summary.income,100000);assert.equal(summary.saving,10000);assert.equal(incomeAllocations(rows,month).length,0);assert.equal(rows.find(x=>x.id===source.id).version,3);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('fresh confirmations and direct budget edits atomically reject conflicting type/category/schedule races',async t=>{
 const r=item({frequency:'weekly',startDate:'2026-09-04'}),f=fixture(t,[r]);await f.setup();
 f.state.beforeWrite=()=>f.raw.prepare("UPDATE life_resources SET payload=json_set(payload,'$.recurring[0].startDate','2026-09-05'),version=version+1 WHERE kind='budget'").run();
 assert.equal((await f.save(f.payment(r,'2026-09-04'))).status,409);assert.equal((await f.records()).length,0);
 f.raw.prepare("UPDATE life_resources SET payload=?,version=1 WHERE kind='budget'").run(JSON.stringify(f.initial));
 f.state.beforeWrite=()=>f.raw.prepare("UPDATE life_resources SET payload=json_set(payload,'$.categories[0].limitCents',31000),version=version+1 WHERE kind='budget'").run();
 assert.equal((await f.save(f.payment(r,'2026-09-04'))).status,200);
 const plan=await f.plan();assert.equal((await f.save({kind:'budget',...plan,data:{...plan.data,recurring:[{...r,categoryId:otherCategory}]}})).status,400);
 const paid=(await f.records())[0];assert.equal((await f.save({kind:'transaction',...paid,data:{...paid.data,deleted:true}})).status,200);
 f.state.beforeWrite=()=>f.raw.prepare("UPDATE life_resources SET payload=json_set(payload,'$.deleted',json('false')),version=version+1 WHERE kind='transaction'").run();
 assert.equal((await f.save({kind:'budget',...plan,data:{...plan.data,recurring:[{...r,categoryId:otherCategory}]}})).status,409);
 assert.equal((await f.plan()).data.recurring[0].categoryId,category);
});

test('permanently deleted occurrences stay out of forecasts and AI; stable IDs remain retired',async t=>{
 const monthly=item(),weekly=item({frequency:'weekly',startDate:'2026-09-04'}),f=fixture(t,[monthly,weekly]);await f.setup();
 const first={...f.payment(monthly,'2026-09-01'),id:occurrenceId(month,monthly.id),data:{...f.payment(monthly,'2026-09-01').data,occurrenceDate:undefined}},second=f.payment(weekly,'2026-09-04');
 for(const record of [first,second]){
  assert.equal((await f.save(record)).status,200);assert.equal((await f.save({...record,version:1,data:{...record.data,deleted:true}})).status,200);
  const trash=(await (await f.call(null,'a','?trash')).json()).items.find(x=>x.id===record.id);
  assert.equal((await f.call({action:'trash',change:{kind:'transaction',id:record.id,deletedAt:trash.deletedAt,operation:'purge'}})).status,200);
  assert.equal((await f.save(record)).status,410);
 }
 const response=await (await f.call(null,'a','?kind=transaction&month='+month)).json();assert.deepEqual(new Set(response.suppressedOccurrences),new Set([first.id,second.id]));assert.equal(response.records.length,0);
 const summary=budgetSummary(f.initial,response.records,month,response.suppressedOccurrences);assert.equal(summary.due.length,3);assert.equal(summary.categories[0].scheduled,3000);
 const profile=(await (await f.call(null)).json()).profile;
 const context=buildReviewContext({profile,from:'2026-09-30',through:'2026-09-30',entries:[],budget:{id:month,data:f.initial,version:1},transactions:[],suppressedOccurrences:response.suppressedOccurrences});
 assert.equal(context.money.summary.due.length,3);assert.equal(context.money.summary.categories[0].scheduled,3000);
 assert.deepEqual((await (await f.call(null,'b','?kind=transaction&month='+month)).json()).suppressedOccurrences,[]);
 assert.deepEqual((await (await f.call(null,'a','?kind=transaction&month=2026-10')).json()).suppressedOccurrences,[]);
 const fresh={...first,id:randomUUID(),data:{...first.data,recurringId:null}};assert.equal((await f.save(fresh)).status,200);
 validateBackup(await (await f.call(null,'a','?export')).text());
});

test('expired occurrence tombstones suppress forecasts even before the next maintenance purge',async t=>{
 const r=item({frequency:'weekly',startDate:'2026-09-04'}),f=fixture(t,[r]);await f.setup();const payment=f.payment(r,'2026-09-04');
 assert.equal((await f.save(payment)).status,200);assert.equal((await f.save({...payment,version:1,data:{...payment.data,deleted:true}})).status,200);
 f.raw.prepare("UPDATE life_trash SET deleted_at='2026-09-23T12:00:00.000Z' WHERE user_id='a' AND kind='transaction' AND record_id=?").run(payment.id);
 const response=await (await f.call(null,'a','?kind=transaction&month='+month)).json();assert.deepEqual(response.suppressedOccurrences,[payment.id]);
 assert.equal(budgetSummary(f.initial,response.records,month,response.suppressedOccurrences).due.some(d=>d.id===payment.id),false);
 assert.equal((await f.save({...payment,version:2})).status,410);
});

test('schedule edits preserve active paid identities, allow equivalent monthly dates and exact retries',async t=>{
 const r=item({day:4}),f=fixture(t,[r]);await f.setup();
 const original=f.payment(r,'2026-09-04'),payment={...original,id:occurrenceId(month,r.id),data:{...original.data,occurrenceDate:undefined}};assert.equal((await f.save(payment)).status,200);
 const moved={...r,day:5},change={action:'budget-item',change:{month,kind:'recurring',previous:r,item:moved}};
 assert.equal((await f.call(change)).status,200);assert.equal((await f.call(change)).status,200);
 const weekly={...moved,frequency:'weekly',startDate:'2026-09-04'},replace={action:'budget-item',change:{month,kind:'recurring',previous:moved,item:weekly}};
 assert.equal((await f.call(replace)).status,400);const plan=await f.plan();assert.equal((await f.save({kind:'budget',...plan,data:{...plan.data,recurring:[weekly]}})).status,400);
 assert.equal((await f.save({...payment,version:1,data:{...payment.data,deleted:true}})).status,200);
 assert.equal((await f.call(replace)).status,200);assert.equal((await f.call(replace)).status,200);
 assert.equal((await f.save(f.payment(weekly,'2026-09-04'))).status,200);assert.equal(budgetSummary((await f.plan()).data,await f.records(),month).due.filter(d=>d.recorded).length,1);
});

test('advanced schedule changes may retain paid dates but cannot replace them, including concurrent confirmations',async t=>{
 const r=item({frequency:'weekly',startDate:'2026-09-04'}),f=fixture(t,[r]);await f.setup();const payment=f.payment(r,'2026-09-04');assert.equal((await f.save(payment)).status,200);
 const replace=async(previous,item)=>f.call({action:'budget-item',change:{month,kind:'recurring',previous,item}});
 const biweekly={...r,frequency:'biweekly'};assert.equal((await replace(r,biweekly)).status,200);
 const paused={...biweekly,active:false};assert.equal((await replace(biweekly,paused)).status,200);assert.equal((await replace(paused,biweekly)).status,200);
 const changed={...biweekly,startDate:'2026-09-05'};assert.equal((await replace(biweekly,changed)).status,400);
 const paid=(await f.records())[0];assert.equal((await f.save({kind:'transaction',...paid,data:{...paid.data,deleted:true}})).status,200);
 const plan=await f.plan();f.state.beforeWrite=()=>f.raw.prepare("UPDATE life_resources SET payload=json_set(payload,'$.deleted',json('false')),version=version+1 WHERE kind='transaction'").run();
 assert.equal((await f.save({kind:'budget',...plan,data:{...plan.data,recurring:[changed]}})).status,409);
 assert.equal((await f.plan()).data.recurring[0].startDate,r.startDate);
});

test('inactive payment replacement revalidates annual-fund membership while historical restoration keeps its snapshot',async t=>{
 const r=item({frequency:'annual',month:9}),f=fixture(t,[r]);await f.setup();
 assert.equal((await f.call({action:'annual-fund-settings',change:{previous:null,item:{enabled:true}}})).status,200);
 const payment={kind:'transaction',id:occurrenceId(month,r.id),version:0,data:transactionSchema.parse({date:'2026-09-30',kind:'expense',amountCents:1000,categoryId:category,note:r.title,recurringId:r.id,voided:false,annualFund:'payment'})};
 assert.equal((await f.save(payment)).status,200);assert.equal((await f.save({...payment,version:1,data:{...payment.data,voided:true}})).status,200);
 const monthly={...r,frequency:'monthly-day',month:undefined,categoryId:otherCategory};assert.equal((await f.call({action:'budget-item',change:{month,kind:'recurring',previous:r,item:monthly}})).status,200);
 assert.equal((await f.save({...payment,version:2,data:{...payment.data,categoryId:otherCategory}})).status,400);
 assert.equal((await f.call({action:'annual-fund-settings',change:{previous:{enabled:true},item:{enabled:false}}})).status,200);
 assert.equal((await f.save({...payment,version:2})).status,200);
 assert.equal((await f.records())[0].data.categoryName,'Original category');
});
