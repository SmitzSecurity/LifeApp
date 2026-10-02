import {workoutNoteSchema,type Exercise,type Saved,type WorkoutNote} from './modules.ts';

export type IndividualSetDraft={exerciseId:string;setNumber:number;reps:number|null;load:number|null;warmup:boolean;completedAt:string};
export type IndividualWorkoutDraft={id:string;date:string;name:string;notes:string;minutes:number|null;exercises:Exercise[];sets:IndividualSetDraft[];lastSerials:Record<string,number>};

export function freshIndividualWorkout(date:string):IndividualWorkoutDraft{return {id:crypto.randomUUID(),date,name:'Individual workout',notes:'',minutes:null,exercises:[],sets:[],lastSerials:{}};}
export function freshIndividualSet(exerciseId:string,setNumber:number,warmup=false):IndividualSetDraft{return {exerciseId,setNumber,reps:null,load:null,warmup,completedAt:new Date().toISOString()};}

// Preset targets describe a movement; they never stand in for actual work.
// Build one atomic note only after every included row has explicit actuals.
export function individualWorkoutRecord(draft:IndividualWorkoutDraft,today:string):Saved<WorkoutNote>{
 if(draft.date>today)throw new Error('Choose today or an earlier workout date.');
 if(!draft.exercises.length)throw new Error('Choose at least one exercise.');
 const name=draft.name.trim();if(!name)throw new Error('Enter a workout name.');
 for(const exercise of draft.exercises){
  const sets=draft.sets.filter(set=>set.exerciseId===exercise.id);
  if(!sets.length)throw new Error(`Add a completed set for ${exercise.name}, or remove that exercise.`);
  if(sets.some(set=>set.reps===null||set.load===null))throw new Error(`Enter reps and load for every ${exercise.name} set. Use 0 for an unweighted movement.`);
  if(sets.filter(set=>!set.warmup).length>20||sets.filter(set=>set.warmup).length>20)throw new Error('Keep at most 20 working sets and 20 warm-ups per exercise.');
 }
 const exercises=draft.exercises.map(exercise=>({...structuredClone(exercise),sets:Math.max(1,draft.sets.filter(set=>set.exerciseId===exercise.id&&!set.warmup).length)}));
 const workingOrdinals=new Map<string,number>();
 const sets=draft.sets.map(set=>{const workingSetNumber=(workingOrdinals.get(set.exerciseId)||0)+1;if(!set.warmup)workingOrdinals.set(set.exerciseId,workingSetNumber);return {...set,reps:set.reps!,load:set.load!,...(!set.warmup?{workingSetNumber}:{})};});
 const data=workoutNoteSchema.parse({date:draft.date,text:name+'\n'+(draft.notes.trim()||'Logged individual exercises and completed sets.'),minutes:draft.minutes,voided:false,structured:{name,exercises,sets}});
 return {id:draft.id,version:0,data};
}
