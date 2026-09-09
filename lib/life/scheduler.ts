import { profileSchema, todayIn, type Profile } from './domain.ts';
import { previousDay } from './reviews.ts';
import type { Database } from './service.ts';

/** First tick at/after the preferred wall-clock time; a repeated DST hour is one slot.
 * A skipped spring-forward time runs on the first later tick that local day.
 * Only yesterday is discovered: never invent a backlog of absent historical days.
 */
export function dueDailyDate(profile:Profile,now:Date):string|null {
 if(!Number.isFinite(now.valueOf()))throw new Error('Invalid scheduling clock');
 if(!profile.reviewPreferences.daily.enabled)return null;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:profile.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const time=['hour','minute'].map(key=>parts.find(p=>p.type===key)!.value).join(':');
 return time>=profile.reviewPreferences.daily.time?previousDay(todayIn(profile.timezone,now)):null;
}

export async function planDailyReviews(db:Database,now=new Date()) {
 // Explicit beta capacity bound: fail instead of silently starving later accounts.
 const {results}=await db.prepare('SELECT user_id,payload,version FROM life_profiles ORDER BY user_id LIMIT 501').bind().all<{user_id:string;payload:string;version:number}>();
 if(results.length>500)throw new Error('Daily planner capacity requires partitioning');
 // All possible preceding local days fall within this three-date UTC window.
 // Skip existing jobs before the bounded insert loop so early accounts cannot
 // monopolize every tick. Leave query headroom for the automatic consumer.
 const earliest=new Date(now.valueOf()-2*86400000).toISOString().slice(0,10);
 const known=await db.prepare('SELECT user_id,entry_date FROM life_review_jobs WHERE entry_date>=?1 AND entry_date<=?2 LIMIT 1501').bind(earliest,now.toISOString().slice(0,10)).all<{user_id:string;entry_date:string}>();
 if(known.results.length>1500)throw new Error('Daily planner history requires partitioning');
 const existing=new Set(known.results.map(r=>JSON.stringify([r.user_id,r.entry_date])));
 let discovered=0,invalidProfiles=0,considered=0;
 for(const row of results){
  let profile:Profile;
  try{profile=profileSchema.parse({...JSON.parse(row.payload),version:row.version});}
  catch{invalidProfiles++;continue;}
  const date=dueDailyDate(profile,now);if(!date)continue;
  if(existing.has(JSON.stringify([row.user_id,date]))||considered>=20)continue;
  considered++;
  // The profile version guard prevents an in-flight scan from scheduling against
  // preferences that changed after the read. The next tick sees the new version.
  const inserted=await db.prepare(`INSERT INTO life_review_jobs(user_id,entry_date,detected_at,timezone,local_time,profile_version)
   SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM life_profiles WHERE user_id=?1 AND version=?6)
   ON CONFLICT DO NOTHING RETURNING entry_date`).bind(row.user_id,date,now.toISOString(),profile.timezone,profile.reviewPreferences.daily.time,row.version).first();
  if(inserted)discovered++;
 }
 return {scanned:results.length,discovered,invalidProfiles,executionEnabled:false,deliveryEnabled:false};
}

export type DailyJobStatus={date:string;state:'disabled'|'missing'|'incomplete'|'ready'|'already-generated'|'attention';sourceVersion:number|null;detectedAt:string;reminderPending:boolean};
export async function dailyJobStatus(db:Database,userId:string,date:string):Promise<DailyJobStatus|null>{
 const row=await db.prepare(`SELECT entry_date AS date,state,source_version AS sourceVersion,detected_at AS detectedAt,reminder_pending AS reminderPending
  FROM life_daily_job_status WHERE user_id=?1 AND entry_date=?2`).bind(userId,date).first<Omit<DailyJobStatus,'reminderPending'>&{reminderPending:number}>();
 return row?{...row,reminderPending:!!row.reminderPending}:null;
}

/** No HTTP trigger and no implicit activation through existing AI flags. */
export async function scheduledReviewPlanning(env:{DB?:unknown;LIFEAPP_AUTH_MODE?:string;LIFEAPP_REVIEW_PLANNER_ENABLED?:string},scheduledTime:number){
 if(env.LIFEAPP_AUTH_MODE!=='google'||env.LIFEAPP_REVIEW_PLANNER_ENABLED!=='true')return;
 if(!env.DB)throw new Error('Daily planner database unavailable');
 const result=await planDailyReviews(env.DB as Database,new Date(scheduledTime));
 if(result.invalidProfiles)throw new Error('Daily planner encountered invalid profiles');
}
