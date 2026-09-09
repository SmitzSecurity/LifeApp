import {profileSchema,todayIn} from './domain.ts';
import {previousDay} from './reviews.ts';
import {periodCadences,lastClosedPeriod,analysisWindow,addDays,type PeriodCadence} from './analysis-periods.ts';
import {readActivity,activityTrends} from './activity.ts';
import type {Database} from './service.ts';
export async function readDashboard(db:Database,userId:string,now:Date){
 const row=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{payload:string;version:number}>();
 if(!row)return Response.json({error:'Save your preferences first.'},{status:400});
 const profile=profileSchema.parse({...JSON.parse(row.payload),version:row.version}),today=todayIn(profile.timezone,now);
 const reports=await db.prepare("SELECT cadence,MAX(entry_date) AS date FROM life_ai_reviews WHERE user_id=?1 AND cadence<>'daily' AND status='complete' GROUP BY cadence").bind(userId).all<{cadence:PeriodCadence;date:string}>();
 const activity=await readActivity(db,userId,addDays(today,-27),today);
 const periods=periodCadences.map(cadence=>{const saved=reports.results.find(r=>r.cadence===cadence);return {cadence,...(saved?analysisWindow(cadence,saved.date):lastClosedPeriod(cadence,today)),available:!!saved};});
 return Response.json({today,yesterday:previousDay(today),periods,trends:activityTrends(activity,today)},{headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
}
