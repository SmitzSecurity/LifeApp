import {z} from 'zod/v3';
import {dateSchema} from './domain.ts';
import {scheduleDate,scheduledInMonth,shiftMonth} from './budget-schedule.ts';
import type {Budget,Saved,Transaction} from './modules.ts';
const cents=z.number().finite().int().min(0).max(100_000_000);
export const loanTypeSchema=z.enum(['mortgage','credit-card','student','auto','personal','medical','other']);
export const debtSchema=z.object({loanType:loanTypeSchema.optional(),paymentStatus:z.enum(['scheduled','balance-only']).optional(),originalBalanceCents:cents.refine(n=>n>0).optional(),balanceCents:cents,accruedInterestCents:cents.optional(),balanceDate:dateSchema,annualRatePercent:z.number().finite().min(0).max(100).optional(),interestMethod:z.enum(['monthly','daily','statement']),interestAccrual:z.enum(['accruing','paused','unknown']).optional(),otherPaymentCents:cents}).strict();
export type Debt=z.infer<typeof debtSchema>;
type Item=Budget['recurring'][number];
const days=(a:string,b:string)=>(Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000;
// Incomplete terms must not manufacture a current balance or payoff. Confirmed
// payments remain visible separately until the user supplies a new statement.
export function debtEstimate(item:Item,transactions:Saved<Transaction>[],asOf:string){
 const debt=item.debt!;
 const payments=transactions.filter(t=>t.data.recurringId===item.id&&t.data.kind===item.kind&&!t.data.planned&&!t.data.voided&&!t.data.deleted&&t.data.date>debt.balanceDate&&t.data.date<=asOf).sort((a,b)=>a.data.date.localeCompare(b.data.date)||a.id.localeCompare(b.id));
 const totalPaid=payments.reduce((sum,t)=>sum+t.data.amountCents,0),accrual=debt.interestAccrual||'accruing';
 const missingInterest=debt.loanType&&debt.loanType!=='credit-card'&&debt.accruedInterestCents===undefined?'Accrued interest before the statement date was not supplied and is not included.':'';
 const statementReason=debt.balanceDate>asOf?'The balance date is in the future.':debt.interestMethod==='statement'?'Statement balance only. Update it from your next statement; new charges and lender interest are not estimated.':accrual==='unknown'?'Confirm whether interest is accruing before estimating the balance or payoff.':accrual==='accruing'&&debt.annualRatePercent===undefined?'Add the interest rate before estimating the balance or payoff.':debt.paymentStatus==='balance-only'&&debt.interestMethod==='monthly'&&accrual!=='paused'?'Statement balance only until a confirmed monthly payment and due date define the estimate.':'';
 if(statementReason){const balance=debt.balanceCents+(debt.accruedInterestCents||0);return {estimateMode:'statement' as const,balanceCents:balance,principalCents:debt.balanceCents,accruedInterestCents:debt.accruedInterestCents||0,progress:null,confirmedPaymentCents:totalPaid,confirmedPayments:payments.length,payoffDate:null,projectedPayments:0,projectedInterestCents:0,remainingAtEndCents:balance,reason:statementReason,...(missingInterest?{assumption:missingInterest}:{})};}
 let principal=debt.balanceCents,interest=debt.accruedInterestCents||0,last=debt.balanceDate;
 const rate=accrual==='paused'?0:debt.annualRatePercent!;
 const accrueDaily=(date:string)=>{if(debt.interestMethod==='daily'&&date>last)interest+=principal*rate/100*days(last,date)/365;last=date;};
 // Pay existing accrued interest before principal; never silently capitalize it.
 const pay=(amount:number)=>{const net=Math.max(0,amount-debt.otherPaymentCents),paidInterest=Math.min(net,Math.round(interest));interest=Math.max(0,interest-paidInterest);principal=Math.max(0,principal-(net-paidInterest));};
 const events:{date:string;payment?:number}[]=payments.map(t=>({date:t.data.date,payment:t.data.amountCents}));
 if(debt.interestMethod==='monthly')for(let m=debt.balanceDate.slice(0,7),n=0;m<=asOf.slice(0,7)&&n<2401;m=shiftMonth(m,1),n++){const date=scheduleDate(m,item);if(date>debt.balanceDate&&date<=asOf)events.push({date});}
 events.sort((a,b)=>a.date.localeCompare(b.date)||(a.payment===undefined?-1:1));
 for(const event of events){accrueDaily(event.date);if(event.payment===undefined)interest+=Math.round(principal*rate/1200);else pay(event.payment);}
 if(asOf>last)accrueDaily(asOf);
 const principalCents=Math.round(principal),accruedInterestCents=Math.round(interest),balanceCents=Math.round(principal+interest),progress=debt.originalBalanceCents===undefined?null:Math.max(0,Math.min(100,100*(1-balanceCents/debt.originalBalanceCents)));
 let payoffDate:string|null=balanceCents===0&&debt.paymentStatus!=='balance-only'?asOf:null,projectedInterest=0,projectedPayments=0,reason='';
 if(debt.paymentStatus==='balance-only')reason='Balance tracking only. Add a confirmed monthly payment and due date to estimate payoff.';
 else if(!item.active||item.deleted)reason='Payments are paused.';
 else for(let m=asOf.slice(0,7),n=0;balanceCents>0&&n<601;m=shiftMonth(m,1),n++){
  const date=scheduleDate(m,item);if(date<=asOf)continue;
  if(!scheduledInMonth(m,item)){if(item.startDate&&date<item.startDate){if(debt.interestMethod==='monthly'){const added=Math.round(principal*rate/1200);interest+=added;projectedInterest+=added;}continue;}reason='The payment schedule ends with a balance remaining.';break;}
  const added=debt.interestMethod==='monthly'?Math.round(principal*rate/1200):principal*rate/100*days(last,date)/365;
  last=date;interest+=added;projectedInterest+=added;const before=principal+interest;pay(item.amountCents);projectedPayments++;
  if(principal+interest<0.5){payoffDate=date;break;}
  if(item.amountCents<=debt.otherPaymentCents||principal+interest>=before-added&&projectedPayments>=2){reason='The payment does not cover the estimated interest.';break;}
  if(n===600)reason='Payoff is beyond the 50-year estimate window.';
 }
 if(!payoffDate&&!reason)reason='Payoff is beyond the 50-year estimate window.';
 const assumption=[accrual==='paused'?'Interest is paused. Any payoff estimate assumes it stays paused.':'',missingInterest].filter(Boolean).join(' ');
 return {estimateMode:'estimate' as const,balanceCents,principalCents,accruedInterestCents,progress,confirmedPaymentCents:totalPaid,confirmedPayments:payments.length,payoffDate,projectedPayments,projectedInterestCents:Math.round(projectedInterest),remainingAtEndCents:Math.round(principal+interest),reason,...(assumption?{assumption}:{})};
}
