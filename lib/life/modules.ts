import { z } from 'zod/v3';
import { dateSchema } from './domain.ts';
export const monthSchema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const uuid=z.string().uuid(), title=z.string().trim().min(1).max(100);
const cents=z.number().int().min(0).max(100_000_000);
export const categorySchema=z.object({id:uuid,name:title,limitCents:cents,archived:z.boolean().default(false)}).strict();
export const recurringSchema=z.object({id:uuid,title,kind:z.enum(['expense','income']),amountCents:cents.refine(n=>n>0),categoryId:z.string(),day:z.number().int().min(1).max(31),frequency:z.enum(['monthly-day','monthly-weekday']).default('monthly-day'),week:z.enum(['first','second','third','fourth','last']).default('first'),weekday:z.number().int().min(0).max(6).default(1),variable:z.boolean().default(false),active:z.boolean().default(true),deleted:z.boolean().default(false)}).strict();
export const budgetSchema=z.object({currency:z.literal('USD'),categories:z.array(categorySchema).max(30),recurring:z.array(recurringSchema).max(60),goals:z.object({spending:z.string().max(1000),saving:z.string().max(1000),investing:z.string().max(1000)}).strict()}).strict().superRefine((p,c)=>{
 for(const list of [p.categories,p.recurring])if(new Set(list.map(x=>x.id)).size!==list.length)c.addIssue({code:'custom',message:'Each item needs its own ID.'});
 if(p.recurring.some(r=>r.kind==='expense'&&!p.categories.some(x=>x.id===r.categoryId)))c.addIssue({code:'custom',message:'Choose a category for every scheduled payment.'});
});
export const transactionSchema=z.object({date:dateSchema,kind:z.enum(['expense','income','saving','investing']),amountCents:cents.refine(n=>n>0),categoryId:z.string().max(36),categoryName:z.string().max(100).default(''),note:z.string().trim().max(300),recurringId:uuid.nullable(),voided:z.boolean(),deleted:z.boolean().default(false)}).strict();
export const exerciseSchema=z.object({id:uuid,name:title,sets:z.number().int().min(1).max(20),reps:z.number().int().min(1).max(100),load:z.number().min(0).max(2000),unit:z.enum(['kg','lb']),restSeconds:z.number().int().min(0).max(900)}).strict();
export const routineSchema=z.object({name:title,preferences:z.string().max(2000),exercises:z.array(exerciseSchema).min(1).max(30),archived:z.boolean()}).strict().refine(r=>new Set(r.exercises.map(e=>e.id)).size===r.exercises.length,'Exercise IDs must be unique.');
export const setSchema=z.object({exerciseId:uuid,setNumber:z.number().int().min(1).max(20),reps:z.number().int().min(0).max(100),load:z.number().min(0).max(2000),completedAt:z.string().datetime()}).strict();
export const workoutSchema=z.object({date:dateSchema,routineId:uuid,name:title,exercises:z.array(exerciseSchema).min(1).max(30),sets:z.array(setSchema).max(600),restUntil:z.string().datetime().nullable(),finishedAt:z.string().datetime().nullable()}).strict().superRefine((w,c)=>{
 if(new Set(w.exercises.map(e=>e.id)).size!==w.exercises.length)c.addIssue({code:'custom',message:'Exercise IDs must be unique.'});
 if(new Set(w.sets.map(s=>s.exerciseId+':'+s.setNumber)).size!==w.sets.length)c.addIssue({code:'custom',message:'A set can only be logged once.'});
 for(const s of w.sets){const e=w.exercises.find(e=>e.id===s.exerciseId);if(!e||s.setNumber>e.sets)c.addIssue({code:'custom',message:'This set is not in your workout.'});}
});
export type Budget=z.infer<typeof budgetSchema>;
export type Transaction=z.infer<typeof transactionSchema>;
export type Routine=z.infer<typeof routineSchema>;
export type Workout=z.infer<typeof workoutSchema>;
export type Exercise=z.infer<typeof exerciseSchema>;
export const cardioSchema=z.object({date:dateSchema,activity:z.enum(['walk','run','cycle','swim','row','elliptical','other']),minutes:z.number().min(1).max(1440),distance:z.number().min(0).max(2000).nullable(),unit:z.enum(['km','mi','m']),intensity:z.enum(['easy','moderate','hard']),note:z.string().trim().max(500),voided:z.boolean()}).strict();
export type Cardio=z.infer<typeof cardioSchema>;
export type Saved<T>={id:string;data:T;version:number;updatedAt?:string};
export const resourceKind=z.enum(['budget','transaction','routine','workout','cardio']);
export type ResourceKind=z.infer<typeof resourceKind>;
export const resourceSchemas={budget:budgetSchema,transaction:transactionSchema,routine:routineSchema,workout:workoutSchema,cardio:cardioSchema};
export function parseMoney(value:string):number{
 if(!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim()))throw new Error('Enter an amount with at most two decimal places.');
 const [whole,fraction='']=value.trim().split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(n>100_000_000)throw new Error('Amount must be $1,000,000 or less.');return n;
}
export const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export function dueDate(month:string,day:number){monthSchema.parse(month);const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();return month+'-'+String(Math.min(day,last)).padStart(2,'0');}
export const occurrenceId=(month:string,id:string)=>`due:${month}:${id}`;
export function recurringDate(month:string,r:Budget['recurring'][number]){
 if(r.frequency!=='monthly-weekday')return dueDate(month,r.day);
 const first=new Date(month+'-01T12:00:00Z'),last=Number(dueDate(month,31).slice(-2));
 const weekday=r.weekday??1,week=r.week||'first';
 const day=week==='last'?last-(new Date(dueDate(month,31)+'T12:00:00Z').getUTCDay()-weekday+7)%7:1+(weekday-first.getUTCDay()+7)%7+7*['first','second','third','fourth'].indexOf(week);
 return dueDate(month,day);
}
export function budgetSummary(plan:Budget,transactions:Saved<Transaction>[],month:string){
 const live=transactions.filter(t=>!t.data.voided&&!t.data.deleted&&t.data.date.startsWith(month+'-'));
 const total=(kind:Transaction['kind'])=>live.filter(t=>t.data.kind===kind).reduce((n,t)=>n+t.data.amountCents,0);
 const due=plan.recurring.filter(r=>r.active&&!r.deleted).map(r=>({...r,date:recurringDate(month,r),id:occurrenceId(month,r.id),recorded:live.some(t=>t.data.recurringId===r.id),actualCents:live.filter(t=>t.data.recurringId===r.id).reduce((n,t)=>n+t.data.amountCents,0)}));
 return {income:total('income'),expenses:total('expense'),saving:total('saving'),investing:total('investing'),cashFlow:total('income')-total('expense')-total('saving')-total('investing'),due,categories:plan.categories.map(c=>{const spent=live.filter(t=>t.data.kind==='expense'&&t.data.categoryId===c.id).reduce((n,t)=>n+t.data.amountCents,0);const scheduled=due.filter(r=>r.kind==='expense'&&r.categoryId===c.id&&!r.recorded).reduce((n,r)=>n+r.amountCents,0);return {...c,spent,remaining:c.limitCents-spent,scheduled,afterScheduled:c.limitCents-spent-scheduled};})};
}
export function nextSet(w:Workout){for(const exercise of w.exercises)for(let setNumber=1;setNumber<=exercise.sets;setNumber++)if(!w.sets.some(s=>s.exerciseId===exercise.id&&s.setNumber===setNumber))return {exercise,setNumber};return null;}
export function restRemaining(deadline:string|null,now=Date.now()){return deadline?Math.max(0,Math.ceil((Date.parse(deadline)-now)/1000)):0;}
export function workoutTotals(w:Workout){return {sets:w.sets.length,reps:w.sets.reduce((n,s)=>n+s.reps,0),volume:w.exercises.map(e=>({id:e.id,name:e.name,unit:e.unit,volume:w.sets.filter(s=>s.exerciseId===e.id).reduce((n,s)=>n+s.reps*s.load,0)}))};}
