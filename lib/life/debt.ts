import {z} from 'zod/v3';
import {dateSchema} from './domain.ts';
import {scheduleDate,scheduledInMonth,shiftMonth} from './budget-schedule.ts';
import type {Budget,Saved,Transaction} from './modules.ts';
const cents=z.number().int().min(0).max(100_000_000);
export const debtSchema=z.object({originalBalanceCents:cents.refine(n=>n>0),balanceCents:cents,balanceDate:dateSchema,annualRatePercent:z.number().min(0).max(100),interestMethod:z.enum(['monthly','daily']),otherPaymentCents:cents}).strict();
export type Debt=z.infer<typeof debtSchema>;
type Item=Budget['recurring'][number];
const days=(a:string,b:string)=>(Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000;
// Estimates keep accrued interest separate from principal. Fees, capitalization,
// promotional-rate changes and lender-specific rounding need statement updates.
export function debtEstimate(item:Item,transactions:Saved<Transaction>[],asOf:string){
 const debt=item.debt!;let principal=debt.balanceCents,interest=0,last=debt.balanceDate,totalPaid=0;
 const payments=transactions.filter(t=>t.data.recurringId===item.id&&t.data.kind==='expense'&&!t.data.planned&&!t.data.voided&&!t.data.deleted&&t.data.date>debt.balanceDate&&t.data.date<=asOf).sort((a,b)=>a.data.date.localeCompare(b.data.date)||a.id.localeCompare(b.id));
 const accrueDaily=(date:string)=>{if(debt.interestMethod==='daily'&&date>last)interest+=principal*debt.annualRatePercent/100*days(last,date)/365;last=date;};
 const pay=(amount:number)=>{const net=Math.max(0,amount-debt.otherPaymentCents),paidInterest=Math.min(net,Math.round(interest));interest=Math.max(0,interest-paidInterest);principal=Math.max(0,principal-(net-paidInterest));};
 const events:{date:string;payment?:number}[]=payments.map(t=>({date:t.data.date,payment:t.data.amountCents}));
 if(debt.interestMethod==='monthly')for(let m=debt.balanceDate.slice(0,7),n=0;m<=asOf.slice(0,7)&&n<2401;m=shiftMonth(m,1),n++){const date=scheduleDate(m,item);if(date>debt.balanceDate&&date<=asOf)events.push({date});}
 events.sort((a,b)=>a.date.localeCompare(b.date)||(a.payment===undefined?-1:1));
 for(const event of events){accrueDaily(event.date);if(event.payment===undefined)interest+=Math.round(principal*debt.annualRatePercent/1200);else {totalPaid+=event.payment;pay(event.payment);}}
 if(asOf>last)accrueDaily(asOf);
 const balanceCents=Math.round(principal+interest),progress=Math.max(0,Math.min(100,100*(1-balanceCents/debt.originalBalanceCents)));
 let payoffDate:string|null=balanceCents===0?asOf:null,projectedInterest=0,projectedPayments=0,reason='';
 if(debt.balanceDate>asOf)reason='The balance date is in the future.';
 else if(!item.active||item.deleted)reason='Payments are paused.';
 else for(let m=asOf.slice(0,7),n=0;balanceCents>0&&n<601;m=shiftMonth(m,1),n++){
  const date=scheduleDate(m,item);if(date<=asOf)continue;
  if(!scheduledInMonth(m,item)){if(item.startDate&&date<item.startDate){if(debt.interestMethod==='monthly'){const added=Math.round(principal*debt.annualRatePercent/1200);interest+=added;projectedInterest+=added;}continue;}reason='The payment schedule ends with a balance remaining.';break;}
  const added=debt.interestMethod==='monthly'?Math.round(principal*debt.annualRatePercent/1200):principal*debt.annualRatePercent/100*days(last,date)/365;
  last=date;interest+=added;projectedInterest+=added;const before=principal+interest;pay(item.amountCents);projectedPayments++;
  if(principal+interest<0.5){payoffDate=date;break;}
  if(item.amountCents<=debt.otherPaymentCents||principal+interest>=before-added&&projectedPayments>=2){reason='The payment does not cover the estimated interest.';break;}
  if(n===600)reason='Payoff is beyond the 50-year estimate window.';
 }
 if(!payoffDate&&!reason)reason='Payoff is beyond the 50-year estimate window.';
 return {balanceCents,progress,confirmedPaymentCents:totalPaid,confirmedPayments:payments.length,payoffDate,projectedPayments,projectedInterestCents:Math.round(projectedInterest),remainingAtEndCents:Math.round(principal+interest),reason};
}
