import {z} from 'zod/v3';
import {resolveExerciseName} from './exercise-names.ts';
import type {Saved,Workout} from './modules.ts';
import type {Database} from './service.ts';

export type ExercisePerformance={
 workoutId:string;workoutName:string;exerciseName:string;date:string;finishedAt:string;
 workingSetNumber:number;reps:number;load:number;unit:'kg'|'lb';
};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});

// A matching session with no entry for this ordinal intentionally returns null.
// Callers must not substitute another set or fall back to an older workout.
export function performanceInWorkout(record:Saved<Workout>,name:string,workingSetNumber:number):{matched:boolean;performance:ExercisePerformance|null}{
 const workout=record.data;
 if(workout.deleted||!workout.finishedAt)return {matched:false,performance:null};
 const key=resolveExerciseName(name),candidates=workout.exercises.filter(e=>resolveExerciseName(e.name)===key).map(exercise=>{
  const sets=workout.sets.filter(s=>s.exerciseId===exercise.id&&!s.warmup).sort((a,b)=>a.setNumber-b.setNumber);
  const positive=sets.filter(s=>s.reps>0),last=positive.reduce((latest,s)=>Math.max(latest,Date.parse(s.completedAt)),0);
  return {exercise,sets,positive,last};
 }).filter(candidate=>candidate.positive.length).sort((a,b)=>b.last-a.last);
 // Repeated blocks of the same movement stay separate: use the last performed
 // block, never combine sets from independently snapshotted exercise entries.
 const candidate=candidates[0];
 if(!candidate)return {matched:false,performance:null};
 const skipped=new Set((workout.skippedSets||[]).filter(s=>s.exerciseId===candidate.exercise.id).map(s=>s.workingSetNumber));
 const ordinals=Array.from({length:candidate.exercise.sets},(_,index)=>index+1).filter(ordinal=>!skipped.has(ordinal));
 const index=ordinals.indexOf(workingSetNumber),set=index<0?undefined:candidate.sets[index];
 if(!set||set.reps<=0)return {matched:true,performance:null};
 return {matched:true,performance:{workoutId:record.id,workoutName:workout.name,exerciseName:candidate.exercise.name,date:workout.date,finishedAt:workout.finishedAt,workingSetNumber,reps:set.reps,load:set.load,unit:candidate.exercise.unit}};
}

type Row={resource_id:string;payload:string;version:number;finished_sort:number};
const querySchema=z.object({workoutId:z.string().uuid(),exerciseId:z.string().uuid(),workingSetNumber:z.coerce.number().int().min(1).max(20)});
export async function readExercisePerformance(request:Request,db:Database,userId:string){
 const params=new URL(request.url).searchParams;
 const parsed=querySchema.safeParse({workoutId:params.get('workoutId'),exerciseId:params.get('exerciseId'),workingSetNumber:params.get('workingSetNumber')});
 if(!parsed.success)return json({error:'Choose a workout exercise and working set.'},400);
 const {workoutId,exerciseId,workingSetNumber}=parsed.data;
 const current=await db.prepare("SELECT payload FROM life_resources WHERE user_id=?1 AND kind='workout' AND resource_id=?2").bind(userId,workoutId).first<{payload:string}>();
 if(!current)return json({error:'This workout is no longer available.'},404);
 const workout=JSON.parse(current.payload) as Workout,exercise=workout.exercises.find(e=>e.id===exerciseId);
 if(workout.deleted||workout.finishedAt)return json({error:'Open an active workout to compare its sets.'},409);
 if(!exercise||workingSetNumber>exercise.sets)return json({error:'Choose a working set from this workout.'},400);
 let cursor:{finished:number;id:string}|null=null,read=0;
 // The regular workout list has a UI page limit. Read historical snapshots
 // directly, in bounded pages, so old matching exercises are still found.
 // Completion time, not last edit time, defines the most recent workout.
 while(read<=5000){
  const limit=read===5000?1:100;
  const result:{results:Row[]}=await db.prepare(`SELECT resource_id,payload,version,julianday(json_extract(payload,'$.finishedAt')) AS finished_sort FROM life_resources
   WHERE user_id=?1 AND kind='workout' AND resource_id<>?2
   AND COALESCE(json_extract(payload,'$.deleted'),0)=0
   AND julianday(json_extract(payload,'$.finishedAt')) IS NOT NULL
   ${cursor?"AND (julianday(json_extract(payload,'$.finishedAt'))<?3 OR (julianday(json_extract(payload,'$.finishedAt'))=?3 AND resource_id<?4))":''}
   ORDER BY finished_sort DESC,resource_id DESC LIMIT ${limit}`).bind(...(cursor?[userId,workoutId,cursor.finished,cursor.id]:[userId,workoutId])).all<Row>();
  if(read===5000&&result.results.length)return json({error:'Your workout history is too large to compare this set. No partial comparison was returned.'},413);
  for(const row of result.results){
   const found=performanceInWorkout({id:row.resource_id,version:row.version,data:JSON.parse(row.payload)},exercise.name,workingSetNumber);
   if(found.matched)return json({performance:found.performance});
  }
  read+=result.results.length;
  if(result.results.length<limit)return json({performance:null});
  const last:Row=result.results.at(-1)!;cursor={finished:last.finished_sort,id:last.resource_id};
 }
 return json({performance:null});
}
