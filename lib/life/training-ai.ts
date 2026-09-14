import {z} from 'zod/v3';
import {profileSchema,todayIn} from './domain.ts';
import {addDays} from './analysis-periods.ts';
import {readActivity,activityTotals} from './activity.ts';
import {volumeEvidence} from './muscle-volume.ts';
import {buildRoutines} from './routine-builder.ts';
import {resolveExerciseName} from './exercise-names.ts';
import type {Database} from './service.ts';
import type {AISettings} from './ai-service.ts';
import type {Exercise,WorkoutNote} from './modules.ts';
export async function generateTraining(db:Database,userId:string,body:unknown,settings:AISettings,now:Date){
 const parsed=z.object({requestId:z.string().uuid(),consent:z.literal(true)}).strict().safeParse(body);
 if(!parsed.success)return Response.json({error:'Choose Analyze this week to use your training records.'},{status:400});
 const existing=await db.prepare('SELECT input_snapshot FROM life_routine_builds WHERE user_id=?1 AND request_id=?2').bind(userId,'training:'+parsed.data.requestId).first<{input_snapshot:string}>();
 if(existing)return buildRoutines(db,userId,{...parsed.data,text:JSON.parse(existing.input_snapshot).description},settings,now,'training');
 const row=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{payload:string;version:number}>();
 if(!row)return Response.json({error:'Save your settings first.'},{status:400});
 const profile=profileSchema.parse({...JSON.parse(row.payload),version:row.version}),today=todayIn(profile.timezone,now),from=addDays(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
 const activity=await readActivity(db,userId,addDays(from,-7),today);
 const current=activityTotals(activity,from,today);
 if(!current.strengthSessions&&!current.cardioSessions&&!current.workoutNotes&&!activity.workouts.some(w=>w.data.date>=from&&w.data.sets.length))return Response.json({error:'Log some training this week first.'},{status:409});
 const evidence={from,through:today,partialWeek:true,current,previous:activityTotals(activity,addDays(from,-7),addDays(from,-1)),coverage:volumeEvidence(activity.workouts,from,today),workouts:activity.workouts.map(w=>({date:w.data.date,name:w.data.name,finished:!!w.data.finishedAt,exercises:w.data.exercises.map(e=>({name:e.name,unit:e.unit,muscles:e.muscles,targets:{reps:e.reps,repMax:e.repMax,restSeconds:e.restSeconds},logged:w.data.sets.filter(s=>s.exerciseId===e.id).map(s=>({reps:s.reps,load:s.load,warmup:!!s.warmup}))}))})),cardio:activity.cardio.filter(c=>!c.data.voided).map(c=>c.data),notes:(activity.workoutNotes||[]).filter(n=>!n.data.voided).map(n=>({date:n.data.date,text:n.data.text.slice(0,1000),excerpt:n.data.text.length>1000,structuredSetsCounted:!!n.data.structured}))};
 return buildRoutines(db,userId,{...parsed.data,text:`Training week ${from} through ${today}`},settings,now,'training',evidence);
}
// Definitions are retained with their source log, including in Trash; copying a
// preset into a program creates an independent snapshot with a fresh exercise ID.
export async function personalExercises(db:Database,userId:string){
 const rows=await db.prepare("SELECT payload FROM life_resources WHERE user_id=?1 AND kind='workout-note' ORDER BY updated_at DESC LIMIT 5001").bind(userId).all<{payload:string}>();
 if(rows.results.length>5000)return Response.json({error:'Your exercise library needs a larger page. No partial list was returned.'},{status:413});
 const found=new Map<string,Exercise>();
 for(const row of rows.results)for(const e of (JSON.parse(row.payload) as WorkoutNote).structured?.exercises||[]){const key=resolveExerciseName(e.name);if(!found.has(key))found.set(key,e);}
 return Response.json({exercises:[...found.values()]},{headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
}
