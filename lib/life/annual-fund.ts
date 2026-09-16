import {z} from 'zod/v3';
import {profileSchema} from './domain.ts';
import {monthSchema,type Budget} from './modules.ts';
import {scheduledInMonth,shiftMonth} from './budget-schedule.ts';
import type {Database} from './service.ts';

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export const isAnnualExpense=(r:Budget['recurring'][number])=>r.kind==='expense'&&(r.frequency==='annual'||r.frequency==='custom'&&r.custom?.unit==='years'&&r.custom.interval===1);
export function annualFundTarget(plan:Budget,month:string){
 const items=plan.recurring.filter(r=>{
  if(!isAnnualExpense(r)||!r.active||r.deleted||r.excludeFromAnnualFund||r.endDate&&r.endDate<month+'-01')return false;
  const earliest=r.startDate&&r.startDate.slice(0,7)>month?r.startDate.slice(0,7):month;
  let next=earliest.slice(0,4)+'-'+String(r.month).padStart(2,'0');if(next<earliest)next=shiftMonth(next,12);
  if(!scheduledInMonth(next,r)&&!scheduledInMonth(shiftMonth(next,12),r))return false;
  return true;
 });
 const annualCents=items.reduce((sum,r)=>sum+r.amountCents,0);
 return {items,annualCents,monthlyCents:Math.ceil(annualCents/12),estimated:items.some(r=>r.variable)};
}
export type AnnualFundBalance={contributionsCents:number;paymentsCents:number;monthContributionsCents:number;balanceCents:number};
export async function readAnnualFund(request:Request,db:Database,userId:string){
 const parsed=monthSchema.safeParse(new URL(request.url).searchParams.get('month'));
 if(!parsed.success)return json({error:'Choose a month for the annual fund.'},400);
 const month=parsed.data;
 const result=await db.prepare(`SELECT
 COALESCE(SUM(CASE WHEN json_extract(payload,'$.annualFund')='contribution' AND json_extract(payload,'$.kind')='saving' THEN json_extract(payload,'$.amountCents') ELSE 0 END),0) contributionsCents,
 COALESCE(SUM(CASE WHEN json_extract(payload,'$.annualFund')='payment' AND json_extract(payload,'$.kind')='expense' THEN json_extract(payload,'$.amountCents') ELSE 0 END),0) paymentsCents,
 COALESCE(SUM(CASE WHEN period=?2 AND json_extract(payload,'$.annualFund')='contribution' AND json_extract(payload,'$.kind')='saving' THEN json_extract(payload,'$.amountCents') ELSE 0 END),0) monthContributionsCents
 FROM life_resources WHERE user_id=?1 AND kind='transaction' AND period<=?2 AND COALESCE(json_extract(payload,'$.deleted'),0)=0 AND COALESCE(json_extract(payload,'$.voided'),0)=0 AND COALESCE(json_extract(payload,'$.planned'),0)=0`).bind(userId,month).first<Omit<AnnualFundBalance,'balanceCents'>>();
 const value=result||{contributionsCents:0,paymentsCents:0,monthContributionsCents:0};
 return json({balance:{...value,balanceCents:value.contributionsCents-value.paymentsCents}});
}
const setting= z.object({enabled:z.boolean()}).strict();
const changeSchema=z.object({previous:setting.nullable(),item:setting}).strict();
export async function saveAnnualFundSettings(body:unknown,db:Database,userId:string,now:Date){
 const parsed=changeSchema.safeParse(body);if(!parsed.success)return json({error:'Choose whether to use an annual-bills fund.'},400);
 const {previous,item}=parsed.data;
 for(let attempt=0;attempt<3;attempt++){
  const row=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{payload:string;version:number}>();
  if(!row)return json({error:'Complete your setup first.'},400);
  const profile=profileSchema.parse({...JSON.parse(row.payload),version:row.version}),current=profile.annualFund||null;
  if(current?.enabled===item.enabled)return json({profile});
  if(JSON.stringify(current)!==JSON.stringify(previous))return json({error:'The annual fund setting changed in another session. Reopen it before changing it again.',profile},409);
  const {version,...data}={...profile,annualFund:item};
  const saved=await db.prepare('UPDATE life_profiles SET payload=?1,version=version+1,updated_at=?2 WHERE user_id=?3 AND version=?4 RETURNING version').bind(JSON.stringify(data),now.toISOString(),userId,version).first<{version:number}>();
  if(saved)return json({profile:{...data,version:saved.version}});
 }
 return json({error:'Another Settings save is finishing. Try again.'},409);
}
