import {z} from 'zod/v3';

export const incomeRuleSchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('fixed'),value:z.number().int().min(0).max(100_000_000)}).strict(),
 z.object({mode:z.literal('percent'),value:z.number().finite().min(0).max(100)}).strict(),
]);
export const incomePlanSchema=z.object({
 withholdings:z.array(z.object({name:z.string().trim().min(1).max(60),rule:incomeRuleSchema}).strict()).max(8),
 saving:incomeRuleSchema.optional(),investing:incomeRuleSchema.optional(),
}).strict();
export const incomeDetailsSchema=z.object({grossCents:z.number().int().min(1).max(100_000_000),plan:incomePlanSchema}).strict();
export type IncomeRule=z.infer<typeof incomeRuleSchema>;
export type IncomePlan=z.infer<typeof incomePlanSchema>;
export type IncomeDetails=z.infer<typeof incomeDetailsSchema>;
export function incomeRuleCents(rule:IncomeRule|undefined,basisCents:number){return rule?rule.mode==='fixed'?rule.value:Math.round(basisCents*rule.value/100):0;}
export function calculateIncome(grossCents:number,plan:IncomePlan){
 const withholdings=plan.withholdings.map(item=>({...item,amountCents:incomeRuleCents(item.rule,grossCents)}));
 const withheldCents=withholdings.reduce((n,item)=>n+item.amountCents,0),netCents=grossCents-withheldCents;
 const savingCents=incomeRuleCents(plan.saving,netCents),investingCents=incomeRuleCents(plan.investing,netCents);
 return {grossCents,withholdings,withheldCents,netCents,savingCents,investingCents,remainingCents:netCents-savingCents-investingCents};
}
export function incomePlanError(grossCents:number,plan:IncomePlan){
 const result=calculateIncome(grossCents,plan);
 if(result.netCents<=0)return 'Withholdings must leave a take-home amount greater than zero.';
 if(result.remainingCents<0)return 'Savings and investment targets cannot exceed take-home income.';
 return null;
}
export const incomeAllocationId=(sourceId:string,kind:'saving'|'investing')=>sourceId.replace(/^due:/,'allocation:')+':'+kind;
export const occurrenceIdPattern=/^due:\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?:[0-9a-f-]{36}$/i;
export const allocationIdPattern=/^allocation:\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?:[0-9a-f-]{36}:(saving|investing)$/i;
