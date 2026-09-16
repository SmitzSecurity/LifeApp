import {debtSchema} from './debt.ts';
import {incomePlanSchema,incomeDetailsSchema,incomePlanError,calculateIncome,incomeAllocationId,occurrenceIdPattern} from './income-planning.ts';
import {scheduleDate,scheduledDatesInMonth,isAdvancedSchedule,occurrencePeriod,recurringFrequencySchema,customScheduleSchema,type CustomSchedule} from './budget-schedule.ts';
import {workoutRecoverySchema} from './workout-recovery.ts';
import { z } from 'zod/v3';
import {muscleTargetsSchema} from './muscle-groups.ts';
import { dateSchema } from './domain.ts';
export const monthSchema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const uuid=z.string().uuid(), title=z.string().trim().min(1).max(100);
const cents=z.number().int().min(0).max(100_000_000);
export const categorySchema=z.object({id:uuid,name:title,limitCents:cents,archived:z.boolean().default(false)}).strict();
export function refineRecurringSchedule(r:{frequency:string;month?:number|null;debt?:unknown;custom?:CustomSchedule|null;startDate?:string|null;paymentDueDay?:number|null;kind?:string},c:z.RefinementCtx){
 if((r.frequency==='annual'||r.frequency==='custom'&&r.custom?.unit==='years')&&r.month==null)c.addIssue({code:'custom',path:['month'],message:'Choose a month for the yearly payment.'});
 if(!['monthly-day','monthly-weekday'].includes(r.frequency)&&r.debt)c.addIssue({code:'custom',path:['debt'],message:'Loan payoff tracking requires monthly payments. Use a monthly schedule or remove loan tracking first.'});
 if(isAdvancedSchedule(r)&&!r.startDate)c.addIssue({code:'custom',path:['startDate'],message:'Choose a start date to anchor this schedule.'});
 if(r.frequency==='custom'&&!r.custom)c.addIssue({code:'custom',path:['custom'],message:'Choose the custom repeat interval and dates.'});
 if(r.frequency!=='custom'&&r.custom)c.addIssue({code:'custom',path:['custom'],message:'Custom repeat rules need a custom frequency.'});
 if(r.paymentDueDay!=null&&(r.kind!=='transfer'||!['monthly-day','monthly-weekday'].includes(r.frequency)))c.addIssue({code:'custom',path:['paymentDueDay'],message:'A card payment deadline needs a monthly credit card reminder.'});
}
export const recurringSchema=z.object({id:uuid,title,kind:z.enum(['expense','income','transfer']),amountCents:cents,categoryId:z.string(),day:z.number().int().min(1).max(31),frequency:recurringFrequencySchema.default('monthly-day'),custom:customScheduleSchema.optional(),month:z.number().int().min(1).max(12).optional(),week:z.enum(['first','second','third','fourth','last']).default('first'),weekday:z.number().int().min(0).max(6).default(1),startDate:dateSchema.optional(),endDate:dateSchema.optional(),installments:z.number().int().min(1).max(600).optional(),paymentDueDay:z.number().int().min(1).max(31).optional(),excludeFromAnnualFund:z.boolean().optional(),debt:debtSchema.optional(),incomePlan:incomePlanSchema.optional(),purged:z.boolean().optional(),variable:z.boolean().default(false),active:z.boolean().default(true),deleted:z.boolean().default(false)}).strict().superRefine((r,c)=>{
 refineRecurringSchedule(r,c);
 if(r.kind!=='transfer'&&r.amountCents<=0)c.addIssue({code:'custom',path:['amountCents'],message:'Enter an amount greater than zero.'});
 if(r.kind==='transfer'&&(r.categoryId!==''||r.incomePlan||r.debt))c.addIssue({code:'custom',message:'Credit card transfers have no expense category, income rules or loan tracking.'});
 if(r.incomePlan){const issue=r.kind!=='income'?'Income rules can only belong to recurring income.':incomePlanError(r.amountCents,r.incomePlan);if(issue)c.addIssue({code:'custom',path:['incomePlan'],message:issue});}
 if(r.endDate&&r.startDate&&r.endDate<r.startDate)c.addIssue({code:'custom',message:'The end date must follow the start date.'});
 if(r.installments&&!r.startDate)c.addIssue({code:'custom',message:'Choose a start date for the installment count.'});
 if(r.debt&&(r.kind!=='expense'||r.debt.otherPaymentCents>=r.amountCents))c.addIssue({code:'custom',message:'A loan needs an expense payment larger than its taxes, insurance and fees.'});
});
export const budgetSchema=z.object({currency:z.literal('USD'),categories:z.array(categorySchema).max(30),recurring:z.array(recurringSchema).max(60),goals:z.object({spending:z.string().max(1000),saving:z.string().max(1000),investing:z.string().max(1000)}).strict()}).strict().superRefine((p,c)=>{
 for(const list of [p.categories,p.recurring])if(new Set(list.map(x=>x.id)).size!==list.length)c.addIssue({code:'custom',message:'Each item needs its own ID.'});
 if(p.recurring.some(r=>r.kind==='expense'&&!p.categories.some(x=>x.id===r.categoryId)))c.addIssue({code:'custom',message:'Choose a category for every scheduled payment.'});
});
export const transactionSchema=z.object({date:dateSchema,kind:z.enum(['expense','income','saving','investing','transfer']),amountCents:cents.refine(n=>n>0),categoryId:z.string().max(36),categoryName:z.string().max(100).default(''),note:z.string().trim().max(300),recurringId:uuid.nullable(),occurrenceDate:dateSchema.optional(),voided:z.boolean(),deleted:z.boolean().default(false),planned:z.boolean().optional(),expectedDate:dateSchema.optional(),incomeDetails:incomeDetailsSchema.optional(),incomeSourceId:z.string().regex(occurrenceIdPattern).optional(),annualFund:z.enum(['contribution','payment']).optional()}).strict().superRefine((t,c)=>{
 if(t.annualFund==='contribution'&&(t.kind!=='saving'||t.recurringId)||t.annualFund==='payment'&&(t.kind!=='expense'||!t.recurringId))c.addIssue({code:'custom',path:['annualFund'],message:'Annual-fund contributions are savings transfers; payments must be linked annual expenses.'});
 if(t.occurrenceDate&&(!t.recurringId||t.occurrenceDate.slice(0,7)!==t.date.slice(0,7)))c.addIssue({code:'custom',path:['occurrenceDate'],message:'Keep the recurring occurrence and actual payment in the same month.'});
 if(t.kind==='transfer'&&(t.categoryId!==''||t.incomeDetails||t.incomeSourceId))c.addIssue({code:'custom',message:'Credit card transfers have no expense category or income rules.'});
 if(t.incomeDetails){const issue=t.kind!=='income'||!t.recurringId||t.planned?'Income details need confirmed recurring income.':incomePlanError(t.incomeDetails.grossCents,t.incomeDetails.plan);if(issue)c.addIssue({code:'custom',message:issue});else if(calculateIncome(t.incomeDetails.grossCents,t.incomeDetails.plan).netCents!==t.amountCents)c.addIssue({code:'custom',message:'Recorded income must equal the take-home amount.'});}
 if(t.incomeSourceId&&(!['saving','investing'].includes(t.kind)||t.recurringId||t.incomeDetails))c.addIssue({code:'custom',message:'Income allocations must be savings or investment transfers.'});
 if(t.recurringId&&(t.planned||t.expectedDate))c.addIssue({code:'custom',message:'Use the recurring schedule for expected payments; planned transactions are one-off items.'});
 if(t.expectedDate&&t.expectedDate.slice(0,7)!==t.date.slice(0,7))c.addIssue({code:'custom',message:'Keep the expected and actual payment dates in the same month.'});
 if(t.planned&&t.expectedDate&&t.expectedDate!==t.date)c.addIssue({code:'custom',message:'A planned item’s date must match its expected payment date.'});
});
export const exerciseSchema=z.object({id:uuid,name:title,muscles:muscleTargetsSchema.optional(),sets:z.number().int().min(1).max(20),reps:z.number().int().min(1).max(100),repMax:z.number().int().min(1).max(100).optional(),load:z.number().min(0).max(2000),unit:z.enum(['kg','lb']),restSeconds:z.number().int().min(0).max(900)}).strict().refine(e=>e.repMax===undefined||e.repMax>=e.reps,'The upper rep target must be at least the lower target.');
export const routineSchema=z.object({name:title,weeklySessions:z.number().int().min(0).max(7).optional(),preferences:z.string().max(2000),exercises:z.array(exerciseSchema).min(1).max(30),archived:z.boolean()}).strict().refine(r=>new Set(r.exercises.map(e=>e.id)).size===r.exercises.length,'Exercise IDs must be unique.');
export const setSchema=z.object({exerciseId:uuid,warmup:z.boolean().optional(),setNumber:z.number().int().min(1).max(40),reps:z.number().int().min(0).max(100),load:z.number().min(0).max(2000),completedAt:z.string().datetime()}).strict();
export const workoutSchema=z.object({date:dateSchema,routineId:uuid,name:title,exercises:z.array(exerciseSchema).min(1).max(30),sets:z.array(setSchema).max(1200),restUntil:z.string().datetime().nullable(),finishedAt:z.string().datetime().nullable(),deleted:z.boolean().optional()}).strict().superRefine((w,c)=>{
 if(new Set(w.exercises.map(e=>e.id)).size!==w.exercises.length)c.addIssue({code:'custom',message:'Exercise IDs must be unique.'});
 if(new Set(w.sets.map(s=>s.exerciseId+':'+s.setNumber)).size!==w.sets.length)c.addIssue({code:'custom',message:'A set can only be logged once.'});
 for(const e of w.exercises){const logged=w.sets.filter(s=>s.exerciseId===e.id);if(logged.filter(s=>!s.warmup).length>e.sets||logged.filter(s=>s.warmup).length>20)c.addIssue({code:'custom',message:'Keep the planned working sets and at most 20 warm-ups per exercise.'});}
 for(const s of w.sets){const e=w.exercises.find(e=>e.id===s.exerciseId);if(!e)c.addIssue({code:'custom',message:'This set is not in your workout.'});}
});
export type Budget=z.infer<typeof budgetSchema>;
export type Transaction=z.infer<typeof transactionSchema>;
export type Routine=z.infer<typeof routineSchema>;
export type Workout=z.infer<typeof workoutSchema>;
export type Exercise=z.infer<typeof exerciseSchema>;
export const cardioSchema=z.object({date:dateSchema,activity:z.enum(['walk','run','cycle','swim','row','elliptical','other']),minutes:z.number().min(1).max(1440),distance:z.number().min(0).max(2000).nullable(),unit:z.enum(['km','mi','m']),intensity:z.enum(['easy','moderate','hard']),note:z.string().trim().max(500),voided:z.boolean(),deleted:z.boolean().optional()}).strict();
export type Cardio=z.infer<typeof cardioSchema>;
export type Saved<T>={id:string;data:T;version:number;updatedAt?:string};
export const structuredWorkoutSchema=workoutSchema.innerType().pick({name:true,exercises:true,sets:true}).superRefine((w,c)=>{const valid=workoutSchema.safeParse({...w,date:'2000-01-01',routineId:'11111111-1111-4111-8111-111111111111',restUntil:null,finishedAt:null});if(!valid.success)for(const issue of valid.error.issues)c.addIssue(issue);});
export type StructuredWorkout=z.infer<typeof structuredWorkoutSchema>;
export const workoutNoteSchema=z.object({date:dateSchema,text:z.string().trim().min(1).max(5000),minutes:z.number().int().min(1).max(1440).nullable(),voided:z.boolean(),deleted:z.boolean().optional(),structured:structuredWorkoutSchema.optional()}).strict();
export type WorkoutNote=z.infer<typeof workoutNoteSchema>;
export const resourceKind=z.enum(['budget','transaction','routine','workout','cardio','workout-note','visibility','ai-recovery']);
export type ResourceKind=z.infer<typeof resourceKind>;
export const resourceSchemas={'ai-recovery':workoutRecoverySchema,budget:budgetSchema,transaction:transactionSchema,routine:routineSchema,workout:workoutSchema,cardio:cardioSchema,'workout-note':workoutNoteSchema,visibility:z.object({target:z.enum(['analysis','build']),id:z.string().min(1).max(80),deleted:z.boolean()}).strict()};
export function parseMoney(value:string):number{
 if(!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim()))throw new Error('Enter an amount with at most two decimal places.');
 const [whole,fraction='']=value.trim().split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(n>100_000_000)throw new Error('Amount must be $1,000,000 or less.');return n;
}
export const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export function dueDate(month:string,day:number){monthSchema.parse(month);const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();return month+'-'+String(Math.min(day,last)).padStart(2,'0');}
export const occurrenceId=(month:string,id:string)=>`due:${month}:${id}`;
// A saved income snapshot is the durable source of these prompts. Nothing is
// counted as transferred until its deterministic allocation record is confirmed.
export function incomeAllocations(transactions:Saved<Transaction>[],month:string,suppressedIds:readonly string[]=[]):Saved<Transaction>[] {
 return transactions.filter(t=>t.data.kind==='income'&&t.data.incomeDetails&&t.data.recurringId&&!t.data.planned&&!t.data.voided&&!t.data.deleted&&t.data.date.startsWith(month+'-')).flatMap(source=>{
  const amounts=calculateIncome(source.data.incomeDetails!.grossCents,source.data.incomeDetails!.plan);
  return (['saving','investing'] as const).flatMap(kind=>{
   const id=incomeAllocationId(source.id,kind),saved=transactions.find(t=>t.id===id),amountCents=kind==='saving'?amounts.savingCents:amounts.investingCents;
   if(saved||suppressedIds.includes(id)||amountCents<=0)return [];
   return [{id,version:0,data:transactionSchema.parse({date:source.data.date,kind,amountCents,categoryId:'',categoryName:'',note:((kind==='saving'?'Savings':'Investments')+' from '+source.data.note).slice(0,300),recurringId:null,voided:false,planned:true,expectedDate:source.data.date,incomeSourceId:source.id})}];
  });
 });
}
export function recurringDate(month:string,r:Budget['recurring'][number]){return scheduleDate(month,r);}
export function budgetSummary(plan:Budget,transactions:Saved<Transaction>[],month:string,suppressedOccurrences:readonly string[]=[]){
 const visible=transactions.filter(t=>!t.data.voided&&!t.data.deleted&&t.data.date.startsWith(month+'-'));
 const live=visible.filter(t=>!t.data.planned),planned=visible.filter(t=>t.data.planned);
 const total=(kind:Transaction['kind'])=>live.filter(t=>t.data.kind===kind).reduce((n,t)=>n+t.data.amountCents,0);
 const due=plan.recurring.filter(r=>r.active&&!r.deleted&&(!r.debt||r.debt.balanceCents>0)).flatMap(r=>scheduledDatesInMonth(month,r).map(date=>{
  const id=occurrenceId(occurrencePeriod(month,r,date),r.id),actual=live.find(t=>t.id===id);
  return {...r,...(actual?{kind:actual.data.kind as typeof r.kind,categoryId:actual.data.categoryId,title:actual.data.note||r.title}:{}),date,id,recurringId:r.id,...(isAdvancedSchedule(r)?{occurrenceDate:date}:{}),...(r.paymentDueDay?{paymentDueDate:dueDate(month,r.paymentDueDay)}:{}),recorded:!!actual,actualCents:actual?.data.amountCents||0};
 })).filter(r=>!suppressedOccurrences.includes(r.id));
 return {income:total('income'),expenses:total('expense'),saving:total('saving'),investing:total('investing'),cashFlow:total('income')-total('expense')-total('saving')-total('investing'),due,planned,categories:plan.categories.map(c=>{const spent=live.filter(t=>t.data.kind==='expense'&&t.data.categoryId===c.id).reduce((n,t)=>n+t.data.amountCents,0);const scheduled=due.filter(r=>r.kind==='expense'&&r.categoryId===c.id&&!r.recorded).reduce((n,r)=>n+r.amountCents,0)+planned.filter(t=>t.data.kind==='expense'&&t.data.categoryId===c.id).reduce((n,t)=>n+t.data.amountCents,0);return {...c,spent,remaining:c.limitCents-spent,scheduled,afterScheduled:c.limitCents-spent-scheduled};})};
}
export function nextSet(w:Workout){
 for(const exercise of w.exercises){
  const logged=w.sets.filter(s=>s.exerciseId===exercise.id),working=logged.filter(s=>!s.warmup).length;
  if(working>=exercise.sets)continue;
  let setNumber=1;while(logged.some(s=>s.setNumber===setNumber))setNumber++;
  return {exercise,setNumber,workingSetNumber:working+1};
 }
 return null;
}
export function restRemaining(deadline:string|null,now=Date.now()){return deadline?Math.max(0,Math.ceil((Date.parse(deadline)-now)/1000)):0;}
export function workoutTotals(w:Workout){return {sets:w.sets.length,reps:w.sets.reduce((n,s)=>n+s.reps,0),volume:w.exercises.map(e=>({id:e.id,name:e.name,unit:e.unit,volume:w.sets.filter(s=>s.exerciseId===e.id).reduce((n,s)=>n+s.reps*s.load,0)}))};}
