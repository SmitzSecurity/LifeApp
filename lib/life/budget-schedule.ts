// Date-only monthly schedules. Installments count scheduled occurrences, not
// confirmed payments; skipping a payment never silently extends a contract.
export type MonthlySchedule={day:number;frequency?:string;week?:string;weekday?:number;startDate?:string;endDate?:string;installments?:number};
export function shiftMonth(month:string,offset:number){const d=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+offset,1));return d.toISOString().slice(0,7);}
export function scheduleDate(month:string,r:MonthlySchedule){
 const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
 let day=Math.min(r.day,last);
 if(r.frequency==='monthly-weekday'){
  const weekday=r.weekday??1,week=r.week||'first',first=new Date(month+'-01T12:00:00Z').getUTCDay();
  day=week==='last'?last-(new Date(month+'-'+String(last).padStart(2,'0')+'T12:00:00Z').getUTCDay()-weekday+7)%7:1+(weekday-first+7)%7+7*['first','second','third','fourth'].indexOf(week);
 }
 return month+'-'+String(day).padStart(2,'0');
}
export function firstScheduledMonth(r:MonthlySchedule){if(!r.startDate)return null;const month=r.startDate.slice(0,7);return scheduleDate(month,r)<r.startDate?shiftMonth(month,1):month;}
export function scheduledInMonth(month:string,r:MonthlySchedule){
 const date=scheduleDate(month,r);
 if(r.startDate&&date<r.startDate||r.endDate&&date>r.endDate)return false;
 if(r.installments){const first=firstScheduledMonth(r);if(!first)return false;const count=(Number(month.slice(0,4))-Number(first.slice(0,4)))*12+Number(month.slice(5,7))-Number(first.slice(5,7));if(count<0||count>=r.installments)return false;}
 return true;
}
