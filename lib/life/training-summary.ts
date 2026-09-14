import {profileSchema,todayIn} from './domain.ts';
import {addDays} from './analysis-periods.ts';
import {readActivity} from './activity.ts';
import {recordedVolume} from './muscle-volume.ts';
import type {Database} from './service.ts';
export async function readTrainingSummary(db:Database,userId:string,now:Date){
 const row=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{payload:string;version:number}>();
 if(!row)return Response.json({error:'Save your preferences first.'},{status:400});
 const profile=profileSchema.parse({...JSON.parse(row.payload),version:row.version}),today=todayIn(profile.timezone,now);
 const from=addDays(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
 const activity=await readActivity(db,userId,addDays(from,-7),today);
 return Response.json({today,current:recordedVolume(activity.workouts,from,today),previous:recordedVolume(activity.workouts,addDays(from,-7),addDays(from,-1))},{headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
}
export type TrainingSummary={today:string;current:ReturnType<typeof recordedVolume>;previous:ReturnType<typeof recordedVolume>};
