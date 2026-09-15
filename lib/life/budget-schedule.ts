// Date-only monthly and annual schedules. Installments count scheduled occurrences, not
// confirmed payments; skipping a payment never silently extends a contract.
export type MonthlySchedule={day:number;frequency?:string;month?:number;week?:string;weekday?:number;startDate?:string;endDate?:string;installments?:number};
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
export function firstScheduledMonth(r:MonthlySchedule){
 if(!r.startDate)return null;
 if(r.frequency==='annual'){
  if(r.month===undefined||!Number.isInteger(r.month)||r.month<1||r.month>12)return null;
  const month=r.startDate.slice(0,4)+'-'+String(r.month).padStart(2,'0');
  return scheduleDate(month,r)<r.startDate?shiftMonth(month,12):month;
 }
 const month=r.startDate.slice(0,7);return scheduleDate(month,r)<r.startDate?shiftMonth(month,1):month;
}
export function scheduledInMonth(month:string,r:MonthlySchedule){
 if(r.frequency==='annual'&&Number(month.slice(5,7))!==r.month)return false;
 const date=scheduleDate(month,r);
 if(r.startDate&&date<r.startDate||r.endDate&&date>r.endDate)return false;
 if(r.installments){const first=firstScheduledMonth(r);if(!first)return false;const months=(Number(month.slice(0,4))-Number(first.slice(0,4)))*12+Number(month.slice(5,7))-Number(first.slice(5,7)),count=months/(r.frequency==='annual'?12:1);if(count<0||count>=r.installments)return false;}
 return true;
}
