import {workoutSchema,routineSchema,nextSet,workingSetEntries,type Routine,type Saved,type Workout} from './modules.ts';

// A later authentication/validation rejection cannot prove whether an earlier
// lost acknowledgement committed. Release its frozen retry only after a 409
// has been reconciled against a newer version of that exact saved record.
export function definiteWorkoutRejection(status:number|undefined,wasUnconfirmed:boolean,submittedVersion:number,reconciledVersion?:number):boolean{
 return !!status&&status>=400&&status<500&&(!wasUnconfirmed||status===409&&reconciledVersion!==undefined&&reconciledVersion>submittedVersion);
}

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
 return workoutSchema.parse({...withWorkingOrdinals(workout),skippedSets:[...(workout.skippedSets||[]),{exerciseId:target.exercise.id,workingSetNumber:target.workingSetNumber}],restUntil:null});
}

export function withWorkingOrdinals(workout:Workout):Workout{
 const positions=new Map(workout.exercises.flatMap(e=>workingSetEntries(workout,e.id).map(({set,workingSetNumber})=>[`${e.id}:${set.setNumber}`,workingSetNumber] as const)));
 const lastSetSerials=workout.exercises.flatMap(e=>{const setNumber=Math.max(0,workout.lastSetSerials?.find(s=>s.exerciseId===e.id)?.setNumber??0,...workout.sets.filter(s=>s.exerciseId===e.id).map(s=>s.setNumber));return setNumber?[{exerciseId:e.id,setNumber}]:[];});
 return {...workout,lastSetSerials,sets:workout.sets.map(set=>set.warmup?set:{...set,workingSetNumber:positions.get(`${set.exerciseId}:${set.setNumber}`)!})};
}

export function restoreSkippedSet(workout:Workout,exerciseId:string,workingSetNumber:number):Workout{
 if(!workout.skippedSets?.some(s=>s.exerciseId===exerciseId&&s.workingSetNumber===workingSetNumber))throw new Error('That set is no longer skipped.');
 return workoutSchema.parse({...withWorkingOrdinals(workout),skippedSets:workout.skippedSets.filter(s=>s.exerciseId!==exerciseId||s.workingSetNumber!==workingSetNumber),restUntil:null});
}

export function reviseWorkoutSet(workout:Workout,input:{exerciseId:string;setNumber?:number;workingSetNumber?:number;reps:number;load:number;warmup:boolean},now=new Date().toISOString()):Workout{
 const normalized=withWorkingOrdinals(workout),exercise=normalized.exercises.find(e=>e.id===input.exerciseId);
 if(!exercise)throw new Error('Choose an exercise from this workout.');
 const old=input.setNumber===undefined?undefined:normalized.sets.find(s=>s.exerciseId===input.exerciseId&&s.setNumber===input.setNumber);
 if(input.setNumber!==undefined&&!old)throw new Error('That set is no longer available.');
 const setNumber=old?.setNumber??((normalized.lastSetSerials?.find(s=>s.exerciseId===input.exerciseId)?.setNumber??0)+1);
 if(setNumber>40)throw new Error('This exercise has used all 40 set identities. Edit an existing set instead.');
 const occupied=new Set(normalized.sets.filter(s=>s.exerciseId===input.exerciseId&&!s.warmup&&s!==old).map(s=>s.workingSetNumber));
 const skipped=new Set(normalized.skippedSets?.filter(s=>s.exerciseId===input.exerciseId).map(s=>s.workingSetNumber));
 let ordinal=input.workingSetNumber??old?.workingSetNumber??1;
 if(input.workingSetNumber===undefined&&old?.workingSetNumber===undefined)while(occupied.has(ordinal)||skipped.has(ordinal))ordinal++;
 const set={exerciseId:input.exerciseId,setNumber,reps:input.reps,load:input.load,warmup:input.warmup,completedAt:old?.completedAt??now,...(!input.warmup?{workingSetNumber:ordinal}:{})};
 return workoutSchema.parse({...normalized,lastSetSerials:[...(normalized.lastSetSerials||[]).filter(s=>s.exerciseId!==input.exerciseId),{exerciseId:input.exerciseId,setNumber:Math.max(setNumber,normalized.lastSetSerials?.find(s=>s.exerciseId===input.exerciseId)?.setNumber??0)}],sets:[...normalized.sets.filter(s=>s!==old),set],skippedSets:normalized.skippedSets?.filter(s=>input.warmup||s.exerciseId!==input.exerciseId||s.workingSetNumber!==ordinal)});
}

export function removeWorkoutSet(workout:Workout,exerciseId:string,setNumber:number):Workout{
 const normalized=withWorkingOrdinals(workout);
 return workoutSchema.parse({...normalized,sets:normalized.sets.filter(s=>s.exerciseId!==exerciseId||s.setNumber!==setNumber),restUntil:null});
}

// Compute this once when the user extends rest, then retain the resulting
// deadline in the pending save so an uncertain write can be retried exactly.
export function extendWorkoutRest(restUntil:string|null,now=Date.now(),seconds=20):string{
 const deadline=restUntil?Date.parse(restUntil):now;
 if(!Number.isFinite(now)||!Number.isFinite(deadline)||!Number.isFinite(seconds)||seconds<0)throw new Error('Choose a valid rest duration.');
 return new Date(Math.min(Math.max(now,deadline)+seconds*1000,now+900_000)).toISOString();
}
