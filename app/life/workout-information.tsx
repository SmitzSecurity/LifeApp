"use client";
import {useEffect,useState,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Accordion,AccordionItem,AccordionTrigger,AccordionContent} from '@/components/ui/accordion';
import {formatDate} from '@/lib/life/date-display';
import {repTarget} from '@/lib/life/exercise-presets';
import {workingSetEntries,workoutExercises,workoutSchema,type Exercise,type Routine,type Saved,type Workout} from '@/lib/life/modules';
import {removeWorkoutSet,restoreSkippedSet,reviseWorkoutSet} from '@/lib/life/workout-session';
import ExerciseSetupNotes from './exercise-setup-notes';
import {WorkoutNotificationControl} from './workout-timer';
import {useWorkoutCancel} from './shared';
import './workout-information.css';

type Correction={exerciseId:string;setNumber:number;reps:string;load:string;warmup:boolean};
export default function WorkoutInformation({workout,routine,busy,setDirty,reviewDirty,onSave,onReview,onProgramSaved,onDirty}:{workout:Saved<Workout>;routine?:Saved<Routine>;busy:boolean;setDirty:boolean;reviewDirty:boolean;onSave:(record:Saved<Workout>)=>Promise<boolean>;onReview:()=>void;onProgramSaved:(record:Saved<Routine>)=>void;onDirty:(dirty:boolean)=>void}){
 const [entry,setEntry]=useState<Correction|null>(null),[notes,setNotes]=useState(workout.data.notes||''),[savedNotes,setSavedNotes]=useState(workout.data.notes||''),[setupDirty,setSetupDirty]=useState(false),[error,setError]=useState(''),[submitted,setSubmitted]=useState<Workout|null>(null);
 if(savedNotes!==(workout.data.notes||'')){if(notes===savedNotes)setNotes(workout.data.notes||'');setSavedNotes(workout.data.notes||'');}
 if(submitted&&JSON.stringify(workoutSchema.parse(submitted))===JSON.stringify(workoutSchema.parse(workout.data))){setSubmitted(null);setEntry(null);setError('');}
 const notesDirty=notes!==(workout.data.notes||''),dirty=!!entry||notesDirty||setupDirty,locked=busy||setDirty||reviewDirty||setupDirty;
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
 useWorkoutCancel(()=>{setEntry(null);setNotes(workout.data.notes||'');setSubmitted(null);setError('');},busy);
 async function save(data:Workout){if(locked)return;const next=workoutSchema.parse({...data,notes});setSubmitted(next);if(await onSave({...workout,data:next})){setSubmitted(null);setEntry(null);setError('');}}
 function correct(){if(!entry||locked)return;if(!/^\d+$/.test(entry.reps)||!/^\d+(\.\d{1,2})?$/.test(entry.load)){setError('Enter whole reps and a load with up to two decimal places.');return;}try{void save(reviseWorkoutSet(workout.data,{...entry,reps:Number(entry.reps),load:Number(entry.load)}));}catch(e){setError(e instanceof Error?e.message:'Check the reps and load.');}}
 function rows(items:{exercise:Exercise;notes:ReactNode}[]){return <Accordion type="multiple" className="session-information-exercises">{items.map(({exercise,notes:setup})=>{
  const logged=workout.data.sets.filter(set=>set.exerciseId===exercise.id).sort((a,b)=>a.setNumber-b.setNumber),ordinals=new Map(workingSetEntries(workout.data,exercise.id).map(({set,workingSetNumber})=>[set.setNumber,workingSetNumber])),skips=workout.data.skippedSets?.filter(set=>set.exerciseId===exercise.id)||[];
  return <AccordionItem value={exercise.id} key={exercise.id}><AccordionTrigger><span className="session-information-exercise-heading"><strong>{exercise.name}</strong><small>{logged.filter(set=>!set.warmup).length} working sets logged · {exercise.sets} × {repTarget(exercise)} target</small></span></AccordionTrigger><AccordionContent>
   <fieldset disabled={locked}><div className="session-information-sets">{logged.length===0&&skips.length===0&&<p className="muted">No sets logged yet.</p>}{logged.map(set=>entry?.exerciseId===exercise.id&&entry.setNumber===set.setNumber?<div className="session-information-correction" key={set.setNumber}>
    <strong>{set.warmup?'Warm-up':`Set ${ordinals.get(set.setNumber)}`}</strong><div className="session-information-inputs"><label>Reps<input autoFocus inputMode="numeric" type="number" min={0} max={100} value={entry.reps} onChange={event=>setEntry({...entry,reps:event.target.value})}/></label><label>Load ({exercise.unit})<input inputMode="decimal" value={entry.load} onChange={event=>setEntry({...entry,load:event.target.value})}/></label></div><label className="inline-check"><input type="checkbox" checked={entry.warmup} onChange={event=>setEntry({...entry,warmup:event.target.checked})}/>Warm-up</label><div className="session-information-actions"><Button variant="ghost" onClick={()=>{setEntry(null);setError('');}}>Cancel</Button><Button onClick={correct}>Save correction</Button></div>
   </div>:<div className="session-information-set" key={set.setNumber}><span><strong>{set.warmup?'Warm-up':`Set ${ordinals.get(set.setNumber)}`}</strong><small>{set.reps} × {set.load} {exercise.unit}</small></span><Button variant="ghost" disabled={!!entry} onClick={()=>{setEntry({exerciseId:exercise.id,setNumber:set.setNumber,reps:String(set.reps),load:String(set.load),warmup:!!set.warmup});setError('');}}>Correct</Button><Button variant="ghost" disabled={!!entry} onClick={()=>void save(removeWorkoutSet(workout.data,exercise.id,set.setNumber))}>Delete set</Button></div>)}{skips.map(skip=><div className="session-information-set" key={'skip-'+skip.workingSetNumber}><span>Set {skip.workingSetNumber}<small>Skipped</small></span><Button variant="ghost" disabled={!!entry} onClick={()=>void save(restoreSkippedSet(workout.data,exercise.id,skip.workingSetNumber))}>Undo skip</Button></div>)}</div></fieldset>
   <div className="session-information-setup">{setup}</div>
  </AccordionContent></AccordionItem>;
 })}</Accordion>;}
 return <div className="workout-information"><div className="session-information-summary"><h3>{workout.data.name}</h3><p>{formatDate(workout.data.date)} · {workout.data.sets.filter(set=>!set.warmup).length} working sets logged · {workout.data.skippedSets?.length||0} skipped · {workout.data.sets.filter(set=>set.warmup).length} warm-ups</p><progress value={workout.data.exercises.reduce((sum,exercise)=>sum+workingSetEntries(workout.data,exercise.id).filter(set=>set.workingSetNumber<=exercise.sets).length+(workout.data.skippedSets?.filter(set=>set.exerciseId===exercise.id).length||0),0)} max={workout.data.exercises.reduce((sum,exercise)=>sum+exercise.sets,0)} aria-label="Planned working sets logged or skipped"/></div>
  {error&&<p role="alert" className="error">{error}</p>}<Button variant="secondary" disabled={busy||setDirty||reviewDirty||dirty} onClick={onReview}>Review sets and workout notes</Button>
  {routine?<ExerciseSetupNotes routine={routine} workout={workout.data} disabled={busy||!!entry||notesDirty} onSaved={onProgramSaved} onDirty={setSetupDirty} renderExercises={rows}/>:rows(workoutExercises(workout.data).map(exercise=>({exercise,notes:<p className="muted">{exercise.setupNote||'No setup note saved for this exercise.'}</p>})))}
  <details className="session-information-workout-notes"><summary>Workout notes</summary><fieldset disabled={locked||!!entry}><label>Notes for this workout<textarea rows={3} maxLength={5000} value={notes} onChange={event=>setNotes(event.target.value)}/></label>{notesDirty&&<div className="session-information-actions"><Button variant="ghost" onClick={()=>setNotes(workout.data.notes||'')}>Cancel notes</Button><Button onClick={()=>void save(workout.data)}>Save workout notes</Button></div>}</fieldset></details>
  <WorkoutNotificationControl/><p className="muted">Sound and vibration alert you when rest ends. Keep LifeApp open and your screen unlocked. Availability depends on your browser and device.</p>
 </div>;
}
