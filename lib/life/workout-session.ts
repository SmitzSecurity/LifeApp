import {workoutSchema,routineSchema,nextSet,type Routine,type Saved,type Workout} from './modules.ts';

// Normalize optional fields and key order before deciding whether a preview
// needs template choices. Invalid numeric drafts are never equal to saved data.
export function sameRoutinePlan(a:Routine,b:Routine|undefined):boolean{
 const left=routineSchema.safeParse(a),right=routineSchema.safeParse(b);
 return left.success&&right.success&&JSON.stringify(left.data)===JSON.stringify(right.data);
}

// The reviewed preview may differ from its saved template. Starting owns a
// validated copy; saving template changes is a separate, explicit operation.
export function createWorkoutSession(routine:Saved<Routine>,date:string,id=crypto.randomUUID()):Saved<Workout>{
 return {id,version:0,data:workoutSchema.parse({date,routineId:routine.id,name:routine.data.name,exercises:structuredClone(routine.data.exercises),sets:[],restUntil:null,finishedAt:null})};
}

// Persist the chosen target as part of the normal versioned workout write.
// Build this once for exact retries; a skip never invents a completed set.
export function skipCurrentSet(workout:Workout):Workout{
 if(workout.finishedAt||workout.deleted)throw new Error('Only an active workout can skip a set.');
 const target=nextSet(workout);
 if(!target)throw new Error('There are no remaining sets to skip.');
 return workoutSchema.parse({...workout,skippedSets:[...(workout.skippedSets||[]),{exerciseId:target.exercise.id,workingSetNumber:target.workingSetNumber}],restUntil:null});
}

// Compute this once when the user extends rest, then retain the resulting
// deadline in the pending save so an uncertain write can be retried exactly.
export function extendWorkoutRest(restUntil:string|null,now=Date.now(),seconds=20):string{
 const deadline=restUntil?Date.parse(restUntil):now;
 if(!Number.isFinite(now)||!Number.isFinite(deadline)||!Number.isFinite(seconds)||seconds<0)throw new Error('Choose a valid rest duration.');
 return new Date(Math.min(Math.max(now,deadline)+seconds*1000,now+900_000)).toISOString();
}
