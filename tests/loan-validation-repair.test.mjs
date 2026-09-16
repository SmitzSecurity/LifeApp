import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBudgetDraft,loanInstruction,budgetInstruction} from '../lib/life/budget-build-schema.ts';
import {budgetSchema,budgetSummary} from '../lib/life/modules.ts';
import {beginBudgetReview,addBudgetReviewCategory,budgetReviewImport} from '../lib/life/budget-build-review.ts';

const student=index=>({title:`Student group ${index+1}`,kind:'expense',amountCents:0,category:null,frequency:'monthly-day',day:null,week:null,weekday:null,variable:false,
 debt:{loanType:'student',paymentStatus:'balance-only',balanceCents:150000+index*1000,accruedInterestCents:index*100,balanceDate:'2026-09-14',annualRatePercent:4.5,interestMethod:'daily',interestAccrual:'accruing',otherPaymentCents:0}});
const incomplete={title:'Dental installment loan',kind:'expense',amountCents:8450,category:null,frequency:'monthly-day',day:null,week:null,weekday:null,variable:false,startDate:'2026-10-01',endDate:'2027-03-31',installments:6,
 debt:{loanType:'medical',paymentStatus:'scheduled',balanceCents:47500,accruedInterestCents:0,balanceDate:'2026-09-16',annualRatePercent:0,interestMethod:'monthly',interestAccrual:'accruing',otherPaymentCents:500}};
const wrap=recurring=>({notes:'Rates and balances are from their dated statements.',categories:[],recurring});
const parse=(item,intent='loans')=>parseBudgetDraft(JSON.stringify(wrap([item])),intent);

test('fifteenth loan with missing monthly day becomes a reviewed balance, never a guessed bill',()=>{
 const input=wrap([...Array.from({length:14},(_,i)=>student(i)),incomplete,{...incomplete,title:'Scheduled medical loan',day:12}]);
 const before=structuredClone(input),parsed=parseBudgetDraft(JSON.stringify(input),'loans'),loan=parsed.recurring[14];
 assert.equal(parsed.recurring.length,16);assert.deepEqual(input,before);
 assert.equal(loan.title,incomplete.title);assert.equal(loan.amountCents,0);assert.equal(loan.day,1);assert.equal(loan.frequency,'monthly-day');
 assert.deepEqual(loan.debt,{...incomplete.debt,paymentStatus:'balance-only'});
 for(const key of ['startDate','endDate','installments','paymentDueDay','custom','month'])assert.equal(loan[key],undefined);
 assert.match(parsed.notes,/Dental installment loan: Balance only because the monthly payment day was not supplied/);
 for(const fact of ['$84.50','$5.00','10/01/2026','03/31/2027','6 installments'])assert.ok(parsed.notes.includes(fact));
 assert.ok(parsed.notes.startsWith(input.notes));assert.equal(parsed.recurring[15].debt.paymentStatus,'scheduled');assert.equal(parsed.recurring[15].day,12);
 const initial=budgetSchema.parse({currency:'USD',categories:[],recurring:[],goals:{spending:'',saving:'',investing:''}});
 let review=beginBudgetReview(parsed,initial);assert.throws(()=>budgetReviewImport(review,'2026-09'),/category/i);
 review=addBudgetReviewCategory(review,'Loan payments','200',loan.id);
 const categoryId=review.categories[0].item.id;review={...review,recurring:review.recurring.map(item=>({...item,categoryId}))};
 const change=budgetReviewImport(review,'2026-10');
 const plan=budgetSchema.parse({...initial,categories:change.categories.map(c=>c.item),recurring:change.recurring.map(r=>r.item)});
 const due=budgetSummary(plan,[],'2026-10').due;
 assert.equal(due.length,1);assert.equal(due[0].recurringId,parsed.recurring[15].id);assert.equal(due[0].date,'2026-10-12');
});

test('only absent monthly timing is normalized and known partial weekday facts are visible',()=>{
 for(const day of [undefined,null])assert.equal(parse({...incomplete,day}).recurring[0].debt.paymentStatus,'balance-only');
 for(const [week,weekday,known] of [['second',null,'week: second'],[null,1,'weekday: Monday'],[null,null,'complete monthly weekday rule']]){
  const result=parse({...incomplete,frequency:'monthly-weekday',week,weekday});
  assert.equal(result.recurring[0].debt.paymentStatus,'balance-only');assert.match(result.notes,/Confirm the payment schedule before enabling bills/);assert.ok(result.notes.includes(known));
 }
 const complete=parse({...incomplete,frequency:'monthly-weekday',week:'second',weekday:1});
 assert.equal(complete.recurring[0].debt.paymentStatus,'scheduled');assert.equal(complete.recurring[0].amountCents,8450);assert.equal(complete.notes,wrap([]).notes);
});

test('credit card with only a separately supplied deadline retains that fact without inventing payment timing',()=>{
 const result=parse({...incomplete,title:'Card A',kind:'transfer',amountCents:0,paymentDueDay:25,debt:{loanType:'credit-card',paymentStatus:'scheduled',balanceCents:150000,balanceDate:'2026-09-16',interestMethod:'statement',interestAccrual:'unknown',otherPaymentCents:0}});
 const card=result.recurring[0];assert.equal(card.kind,'transfer');assert.equal(card.debt.paymentStatus,'balance-only');assert.equal(card.paymentDueDay,undefined);assert.equal(card.categoryId,'');assert.match(result.notes,/creditor deadline: day 25/);
});

test('malformed money, dates, debt data and unsupported schedules still fail before normalization',()=>{
 const invalid=[
  {day:0},{day:32},{day:'15'},{weekday:8},{week:'fifth'},{amountCents:-1},{amountCents:0},{amountCents:1.5},{amountCents:null},{amountCents:100000001},
  {startDate:'2026-02-30'},{endDate:'2026-01-01'},{installments:0},{frequency:'weekly',startDate:'2026-10-01'},
  {frequency:'annual',month:10},{frequency:'monthly-day',custom:{unit:'months',interval:1,days:[5]}},
  {kind:'income'},{debt:{...incomplete.debt,balanceDate:'2026-02-30'}},{debt:{...incomplete.debt,balanceCents:-1}},
  {debt:{...incomplete.debt,annualRatePercent:-1}},{debt:{...incomplete.debt,otherPaymentCents:8450}},
  {debt:{...incomplete.debt,loanType:undefined}},
  {unexpected:'not permitted'},{debt:{...incomplete.debt,unexpected:'not permitted'}}
 ];
 for(const patch of invalid)assert.throws(()=>parse({...incomplete,...patch}),JSON.stringify(patch));
});

test('general Budget parser stays strict and existing loan warnings are never truncated',()=>{
 assert.throws(()=>parseBudgetDraft(JSON.stringify(wrap([incomplete]))));
 assert.throws(()=>parse({...incomplete,debt:undefined}));
 assert.throws(()=>parseBudgetDraft(JSON.stringify({...wrap([incomplete]),categories:[{name:'Bills',limitCents:0}]}),'loans'));
 assert.throws(()=>parseBudgetDraft(JSON.stringify({...wrap([incomplete]),notes:'Original financial warning. '.repeat(111)}),'loans'));
 const canonical=wrap([student(0)]),parsed=parseBudgetDraft(JSON.stringify(canonical),'loans');assert.equal(parsed.notes,canonical.notes);assert.deepEqual(parsed.recurring[0].debt,canonical.recurring[0].debt);
});

test('loan instructions are scoped to loans and explicitly handle missing timing without invented dates',()=>{
 assert.ok(!loanInstruction.startsWith(budgetInstruction));
 for(const text of ['categories array must be empty','Do not include income, subscriptions','required day, week, weekday','Describe any known payment amount','Never substitute day 1','balance-only','Never estimate current rates'])assert.ok(loanInstruction.includes(text));
});

test('balance-only loans preserve unused payment facts in review notes without creating bills',()=>{
 const original={...student(0),amountCents:8500,day:19,startDate:'2026-10-01',endDate:'2027-01-31',installments:4};
 const draft=parse(original),loan=draft.recurring[0];
 assert.equal(loan.amountCents,0);assert.equal(loan.day,1);assert.equal(loan.startDate,undefined);assert.equal(loan.endDate,undefined);assert.equal(loan.installments,undefined);
 assert.deepEqual(loan.debt,original.debt);
 for(const fact of ['$85.00','payment day: 19','10/01/2026','01/31/2027','4 installments'])assert.ok(draft.notes.includes(fact));
 const plan=budgetSchema.parse({currency:'USD',categories:[{id:crypto.randomUUID(),name:'Loans',limitCents:0}],recurring:[],goals:{spending:'',saving:'',investing:''}});
 plan.recurring=[{...loan,categoryId:plan.categories[0].id}];assert.equal(budgetSummary(plan,[],'2026-10').due.length,0);
 const ordinary=parseBudgetDraft(JSON.stringify(wrap([original]))).recurring[0];assert.equal(ordinary.amountCents,8500);assert.equal(ordinary.day,19);
});

test('missing loan statuses become explicit unknown statement tracking without invented accrual',()=>{
 for(const missing of [undefined,null]){
  const original={...incomplete,day:20,debt:{...incomplete.debt,paymentStatus:missing,interestAccrual:missing}},draft=parse(original),loan=draft.recurring[0];
  assert.equal(loan.debt.paymentStatus,'balance-only');assert.equal(loan.debt.interestAccrual,'unknown');assert.equal(loan.debt.interestMethod,'statement');
  assert.equal(loan.debt.balanceCents,original.debt.balanceCents);assert.equal(loan.debt.annualRatePercent,original.debt.annualRatePercent);assert.equal(loan.amountCents,0);
  assert.match(draft.notes,/Payment status was not supplied/);assert.match(draft.notes,/Interest accrual was not supplied/);
 }
 const scheduled=parse({...incomplete,day:20,debt:{...incomplete.debt,interestAccrual:null}}).recurring[0];
 assert.equal(scheduled.debt.paymentStatus,'scheduled');assert.equal(scheduled.amountCents,8450);assert.equal(scheduled.debt.interestMethod,'statement');
});

test('credit-card classification follows app accounting while ambiguous amounts remain rejected',()=>{
 const card={...student(0),title:'Synthetic card',kind:'expense',day:25,paymentDueDay:27,debt:{loanType:'credit-card',paymentStatus:'balance-only',balanceCents:150000,balanceDate:'2026-09-16',annualRatePercent:19,interestMethod:'daily',interestAccrual:'accruing',otherPaymentCents:0}};
 const result=parse(card),item=result.recurring[0];assert.equal(item.kind,'transfer');assert.equal(item.debt.interestMethod,'statement');assert.equal(item.debt.balanceCents,150000);assert.equal(item.debt.annualRatePercent,19);assert.equal(item.paymentDueDay,undefined);assert.equal(item.amountCents,0);assert.match(result.notes,/deadline: day 27/);assert.match(result.notes,/payments use transfers/);
 for(const patch of [{otherPaymentCents:500},{accruedInterestCents:1200}])assert.throws(()=>parse({...card,debt:{...card.debt,...patch}}));
 assert.throws(()=>parse({...card,kind:'income'}));
});
