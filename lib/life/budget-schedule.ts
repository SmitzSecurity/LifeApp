import {z} from 'zod/v3';

export const recurringFrequencySchema=z.enum(['monthly-day','monthly-weekday','annual','weekly','biweekly','custom']);
export const scheduleWeekSchema=z.enum(['first','second','third','fourth','last']);
const weekdays=z.array(z.number().int().min(0).max(6)).min(1).max(7);
const days=z.array(z.number().int().min(1).max(31)).min(1).max(31);
const weekdayRules=z.array(z.object({week:scheduleWeekSchema,weekday:z.number().int().min(0).max(6)}).strict()).min(1).max(35);
export const customScheduleSchema=z.object({unit:z.enum(['weeks','months','years']),interval:z.number().int().min(1).max(60),weekdays:weekdays.optional(),days:days.optional(),weekdayRules:weekdayRules.optional()}).strict().superRefine((s,c)=>{
 for(const key of ['weekdays','days','weekdayRules'] as const){const values=s[key];if(values&&new Set(values.map(v=>typeof v==='object'?v.week+':'+v.weekday:v)).size!==values.length)c.addIssue({code:'custom',path:[key],message:'Choose each schedule option only once.'});}
 if(s.unit==='weeks'&&(!s.weekdays||s.days||s.weekdayRules))c.addIssue({code:'custom',message:'A weekly interval needs weekdays only.'});
 if(s.unit==='months'&&(s.weekdays||!!s.days===!!s.weekdayRules))c.addIssue({code:'custom',message:'Choose month days or weekday rules for a monthly interval.'});
 if(s.unit==='years'&&(s.weekdays||s.days||s.weekdayRules))c.addIssue({code:'custom',message:'A yearly interval uses its month and day.'});
});
export type CustomSchedule=z.infer<typeof customScheduleSchema>;
export type MonthlySchedule={day:number;frequency?:string;month?:number;week?:string;weekday?:number;startDate?:string;endDate?:string;installments?:number;custom?:CustomSchedule;debt?:{paymentStatus?:'scheduled'|'balance-only'}};
const monthNumber=(month:string)=>Number(month.slice(0,4))*12+Number(month.slice(5,7))-1;
const dateNumber=(date:string)=>Date.parse(date+'T12:00:00Z')/86400000;
export function shiftMonth(month:string,offset:number){const n=monthNumber(month)+offset;return String(Math.floor(n/12)).padStart(4,'0')+'-'+String(n%12+1).padStart(2,'0');}
const monthLength=(month:string)=>{const d=new Date(month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1,0);return d.getUTCDate();};
const fixedDate=(month:string,day:number)=>month+'-'+String(Math.min(day,monthLength(month))).padStart(2,'0');
function weekdayDate(month:string,week:string,weekday:number){
 const last=monthLength(month),first=new Date(month+'-01T12:00:00Z').getUTCDay();
 const day=week==='last'?last-(new Date(fixedDate(month,last)+'T12:00:00Z').getUTCDay()-weekday+7)%7:1+(weekday-first+7)%7+7*['first','second','third','fourth'].indexOf(week);
 return fixedDate(month,day);
}
export function isAdvancedSchedule(r:Pick<MonthlySchedule,'frequency'>){return r.frequency==='weekly'||r.frequency==='biweekly'||r.frequency==='custom';}
export function occurrencePeriod(month:string,r:Pick<MonthlySchedule,'frequency'>,date:string){return isAdvancedSchedule(r)?date:month;}
// Keep the original single-date helper for monthly debt calculations and legacy
// callers. Advanced consumers must use scheduledDatesInMonth instead.
export function scheduleDate(month:string,r:MonthlySchedule){return r.frequency==='monthly-weekday'?weekdayDate(month,r.week||'first',r.weekday??1):fixedDate(month,r.day);}
function weeklyOptions(r:MonthlySchedule){
 const anchor=r.startDate!;
 return {interval:r.frequency==='biweekly'?2:r.frequency==='custom'?r.custom!.interval:1,weekdays:r.frequency==='custom'?r.custom!.weekdays!:[new Date(anchor+'T12:00:00Z').getUTCDay()]};
}
function rawDatesInMonth(month:string,r:MonthlySchedule):string[]{
 if(!isAdvancedSchedule(r))return r.frequency==='annual'&&Number(month.slice(5,7))!==r.month?[]:[scheduleDate(month,r)];
 if(!r.startDate||r.frequency==='custom'&&!r.custom)return [];
 if(r.frequency==='weekly'||r.frequency==='biweekly'||r.custom?.unit==='weeks'){
  const options=weeklyOptions(r),anchor=dateNumber(r.startDate),dates:string[]=[];
  for(let day=1;day<=monthLength(month);day++){
   const date=fixedDate(month,day),difference=dateNumber(date)-anchor;
   if(difference>=0&&Math.floor(difference/7)%options.interval===0&&options.weekdays.includes(new Date(date+'T12:00:00Z').getUTCDay()))dates.push(date);
  }
  return dates;
 }
 const s=r.custom!,difference=monthNumber(month)-monthNumber(r.startDate.slice(0,7));
 if(s.unit==='years')return Number(month.slice(5,7))===r.month&&Number(month.slice(0,4))>=Number(r.startDate.slice(0,4))&&(Number(month.slice(0,4))-Number(r.startDate.slice(0,4)))%s.interval===0?[fixedDate(month,r.day)]:[];
 if(difference<0||difference%s.interval!==0)return [];
 return [...new Set(s.days?s.days.map(day=>fixedDate(month,day)):s.weekdayRules!.map(rule=>weekdayDate(month,rule.week,rule.weekday)))].sort();
}
function withinBounds(date:string,r:MonthlySchedule){return (!r.startDate||date>=r.startDate)&&(!r.endDate||date<=r.endDate);}
function monthlyCycle(r:MonthlySchedule){
 const yearly=r.frequency==='annual'||r.custom?.unit==='years';
 return {first:yearly?r.startDate!.slice(0,4)+'-'+String(r.month).padStart(2,'0'):r.startDate!.slice(0,7),step:yearly?12*(r.custom?.interval||1):r.custom?.unit==='months'?r.custom.interval:1};
}
function earlierOccurrences(month:string,r:MonthlySchedule){
 const cutoff=month+'-01',limit=r.installments!;
 if(r.frequency==='weekly'||r.frequency==='biweekly'||r.custom?.unit==='weeks'){
  const span=Math.max(0,dateNumber(cutoff)-dateNumber(r.startDate!)),fullWeeks=Math.floor(span/7),rest=span%7;
  const options=weeklyOptions(r),anchorWeekday=new Date(r.startDate!+'T12:00:00Z').getUTCDay();
  const eligibleWeeks=fullWeeks===0?0:Math.floor((fullWeeks-1)/options.interval)+1;
  return eligibleWeeks*options.weekdays.length+(fullWeeks%options.interval===0?options.weekdays.filter(w=>(w-anchorWeekday+7)%7<rest).length:0);
 }
 const cycle=monthlyCycle(r);let count=0;
 // Every eligible cycle after the first contributes at least one occurrence.
 // Stop at the bounded installment count, never scan arbitrary date ranges.
 for(let current=cycle.first,n=0;current<month&&count<limit&&n<=limit;n++,current=shiftMonth(current,cycle.step))count+=rawDatesInMonth(current,r).filter(date=>withinBounds(date,r)).length;
 return count;
}
export function scheduledDatesInMonth(month:string,r:MonthlySchedule){
 if(r.debt?.paymentStatus==='balance-only')return [];
 if(r.startDate&&month<r.startDate.slice(0,7)||r.endDate&&month>r.endDate.slice(0,7))return [];
 const dates=rawDatesInMonth(month,r).filter(date=>withinBounds(date,r));
 if(!r.installments)return dates;
 if(!r.startDate)return [];
 return dates.slice(0,Math.max(0,r.installments-earlierOccurrences(month,r)));
}
export function firstScheduledMonth(r:MonthlySchedule){
 if(!r.startDate)return null;
 if(r.frequency==='weekly'||r.frequency==='biweekly'||r.custom?.unit==='weeks'){
  const month=r.startDate.slice(0,7);return scheduledDatesInMonth(month,r).length?month:scheduledDatesInMonth(shiftMonth(month,1),r).length?shiftMonth(month,1):null;
 }
 if((r.frequency==='annual'||r.custom?.unit==='years')&&(r.month===undefined||!Number.isInteger(r.month)||r.month<1||r.month>12))return null;
 const cycle=monthlyCycle(r);for(let n=0;n<2;n++){const month=shiftMonth(cycle.first,n*cycle.step);if(scheduledDatesInMonth(month,r).length)return month;}
 return null;
}
export function scheduledInMonth(month:string,r:MonthlySchedule){return scheduledDatesInMonth(month,r).length>0;}
