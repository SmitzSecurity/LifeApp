import {previousDay,type Cadence} from './reviews.ts';
import {todayIn,type Profile} from './domain.ts';
export type PeriodCadence=Exclude<Cadence,'daily'>;
export const periodCadences:PeriodCadence[]=['weekly','monthly','annual'];
export function addDays(date:string,days:number){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function analysisWindow(cadence:Cadence,through:string){
 const d=new Date(through+'T12:00:00Z');
 if(cadence==='daily')return {from:through,through};
 if(cadence==='weekly'){if(d.getUTCDay()!==0)throw Error('Choose a completed calendar week.');return {from:addDays(through,-6),through};}
 if(cadence==='monthly'){if(addDays(through,1).slice(8)!=='01')throw Error('Choose a completed calendar month.');return {from:through.slice(0,7)+'-01',through};}
 if(through.slice(5)!=='12-31')throw Error('Choose a completed calendar year.');
 return {from:through.slice(0,4)+'-01-01',through};
}
export function lastClosedPeriod(cadence:PeriodCadence,today:string){
 const day=new Date(today+'T12:00:00Z');
 const through=cadence==='weekly'?addDays(today,-((day.getUTCDay()+6)%7)-1):cadence==='monthly'?previousDay(today.slice(0,7)+'-01'):String(Number(today.slice(0,4))-1)+'-12-31';
 return analysisWindow(cadence,through);
}
export function duePeriod(profile:Profile,cadence:PeriodCadence,now:Date){
 const prefs=profile.reviewPreferences,today=todayIn(profile.timezone,now),day=new Date(today+'T12:00:00Z');
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:profile.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const time=['hour','minute'].map(k=>parts.find(p=>p.type===k)!.value).join(':');
 if(!prefs[cadence].enabled||time<prefs[cadence].time)return null;
 if(cadence==='weekly'&&(day.getUTCDay()+6)%7<(prefs.weekDay+6)%7)return null;
 const monthDays=(year:number,month:number)=>new Date(Date.UTC(year,month,0)).getUTCDate();
 if(cadence==='monthly'&&day.getUTCDate()<Math.min(prefs.monthDay,monthDays(day.getUTCFullYear(),day.getUTCMonth()+1)))return null;
 const annualDate=`${day.getUTCFullYear()}-${String(prefs.annualMonth).padStart(2,'0')}-${String(Math.min(prefs.annualDay,monthDays(day.getUTCFullYear(),prefs.annualMonth))).padStart(2,'0')}`;
 if(cadence==='annual'&&today<annualDate)return null;
 return lastClosedPeriod(cadence,today);
}
