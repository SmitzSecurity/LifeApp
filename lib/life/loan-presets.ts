import {loanTypeSchema,type Debt} from './debt.ts';
export {loanTypeSchema};
export const LOAN_TYPES=loanTypeSchema.options;
export type LoanType=typeof LOAN_TYPES[number];
export const LOAN_PRESETS:readonly {type:LoanType;label:string;interestMethod:Debt['interestMethod'];interestAccrual:NonNullable<Debt['interestAccrual']>;description:string}[]=[
 {type:'mortgage',label:'Mortgage',interestMethod:'monthly',interestAccrual:'accruing',description:'Use the principal balance and interest rate from your statement. Separate escrow, taxes, insurance and fees from the total payment.'},
 {type:'credit-card',label:'Credit card',interestMethod:'statement',interestAccrual:'unknown',description:'Track your statement balance and payment reminder. Payments are transfers; purchases already logged as expenses are not counted again.'},
 {type:'student',label:'Student loan',interestMethod:'daily',interestAccrual:'unknown',description:'Use one record per loan or group with matching terms. Keep accrued interest separate from principal, and confirm whether interest currently accrues.'},
 {type:'auto',label:'Car loan',interestMethod:'daily',interestAccrual:'accruing',description:'Many auto loans use daily simple interest. Check your agreement; choose statement-only tracking for precomputed interest or other unsupported terms.'},
 {type:'personal',label:'Personal loan',interestMethod:'monthly',interestAccrual:'accruing',description:'Enter the interest rate and payment from your agreement. Change the estimate method if your lender uses daily simple interest.'},
 {type:'medical',label:'Medical / installment plan',interestMethod:'monthly',interestAccrual:'unknown',description:'Use the stated rate, including 0% only when confirmed. Promotional or deferred interest needs statement-only tracking and regular updates.'},
 {type:'other',label:'Other loan',interestMethod:'statement',interestAccrual:'unknown',description:'Start with a statement balance. Add confirmed terms later to estimate payoff when the supported methods match your loan.'}
];
export function loanPreset(type:LoanType,balanceDate:string):Debt{
 const preset=LOAN_PRESETS.find(p=>p.type===type)!;
 return {loanType:type,paymentStatus:'balance-only',balanceCents:0,balanceDate,interestMethod:preset.interestMethod,interestAccrual:preset.interestAccrual,otherPaymentCents:0};
}
