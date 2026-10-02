"use client";
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {workingSetEntries,workoutExercises,workoutTotals,workoutSchema,type Exercise,type Saved,type Workout} from '@/lib/life/modules';
import {appendWorkoutExercise,removeWorkoutSet,restoreSkippedSet,reviseWorkoutSet} from '@/lib/life/workout-session';
import {useWorkoutCancel} from './shared';
import ExercisePresetPicker from './exercise-preset-picker';
import './workout-review.css';

type Entry={exerciseId:string;setNumber?:number;workingSetNumber?:number;reps:string;load:string;warmup:boolean};
/** One review surface is shared by the completed plan and saved history. */
export default function WorkoutReview({workout,busy,onSave,onAddExercise,canSaveToRoutine=false,onFinish,onContinue,onDirty}:{workout:Saved<Workout>;busy:boolean;onSave:(record:Saved<Workout>)=>Promise<boolean>;onAddExercise?:(record:Saved<Workout>,exercise:Exercise,saveToRoutine:boolean)=>Promise<boolean>;canSaveToRoutine?:boolean;onFinish?:(notes:string)=>void;onContinue?:()=>void;onDirty?:(dirty:boolean)=>void}){
 const [entry,setEntry]=useState<Entry|null>(null),[addedExercise,setAddedExercise]=useState<Exercise|null>(null),[saveToRoutine,setSaveToRoutine]=useState(false),[notes,setNotes]=useState(workout.data.notes||''),[error,setError]=useState(''),[submitted,setSubmitted]=useState<Workout|null>(null),[savedNotes,setSavedNotes]=useState(workout.data.notes||'');
 const saving=useRef(false);
 if(submitted&&JSON.stringify(workoutSchema.parse(workout.data))===JSON.stringify(workoutSchema.parse(submitted))){setEntry(null);setAddedExercise(null);setSaveToRoutine(false);setSubmitted(null);setError('');}
 if(savedNotes!==(workout.data.notes||'')){if(notes===savedNotes)setNotes(workout.data.notes||'');setSavedNotes(workout.data.notes||'');}
 const noteDirty=notes!==(workout.data.notes||''),dirty=!!entry||noteDirty;
 useEffect(()=>{onDirty?.(dirty);return()=>onDirty?.(false);},[dirty,onDirty]);
 function clearEntry(){setEntry(null);setAddedExercise(null);setSaveToRoutine(false);setError('');}
 useWorkoutCancel(()=>{if(busy)return;clearEntry();setNotes(workout.data.notes||'');},busy);
 const totals=workoutTotals(workout.data),exercises=workoutExercises(workout.data),selected=addedExercise||exercises.find(e=>e.id===entry?.exerciseId);
 async function save(data:Workout,exercise?:Exercise){if(busy||saving.current)return;saving.current=true;setError('');const next={...data,notes};setSubmitted(next);try{const record={...workout,data:next};if(await (exercise&&onAddExercise?onAddExercise(record,exercise,saveToRoutine):onSave(record))){clearEntry();setSubmitted(null);}}finally{saving.current=false;}}
 function saveEntry(){
  if(!entry)return;
  if(!/^\d+$/.test(entry.reps)||!/^\d+(\.\d{1,2})?$/.test(entry.load)){setError('Enter whole reps and a load with up to two decimal places.');return;}
  try{const input={...entry,reps:Number(entry.reps),load:Number(entry.load)},exercise=addedExercise?{...addedExercise,load:input.warmup?addedExercise.load:input.load}:undefined;void save(exercise?appendWorkoutExercise(workout.data,exercise,input):reviseWorkoutSet(workout.data,input),exercise);}catch(e){setError(e instanceof Error&&e.message.includes('40 set identities')?e.message:'Use 0–100 reps, 0–2000 load, and at most 20 working sets and 20 warm-ups per exercise.');}
 }
 return <div className="workout-review">
  <div className="session-review-totals"><strong>{totals.sets} sets</strong><span>{totals.reps} reps</span><span>{workout.data.skippedSets?.length||0} skipped</span></div>
  {error&&<p role="alert" className="error">{error}</p>}
  <fieldset disabled={busy}>
   <div className="session-review-exercises">{exercises.map(exercise=>{
    const ordinals=new Map(workingSetEntries(workout.data,exercise.id).map(({set,workingSetNumber})=>[set.setNumber,workingSetNumber]));
    return <section className="session-review-exercise" key={exercise.id}><h4>{exercise.name}</h4>
     {workout.data.sets.filter(s=>s.exerciseId===exercise.id).sort((a,b)=>a.setNumber-b.setNumber).map(set=><div className="session-review-row" key={set.setNumber}><span>{set.warmup?'Warm-up':`Set ${ordinals.get(set.setNumber)}`} · {set.reps} × {set.load} {exercise.unit}</span><Button variant="ghost" disabled={!!entry} onClick={()=>setEntry({exerciseId:exercise.id,setNumber:set.setNumber,reps:String(set.reps),load:String(set.load),warmup:!!set.warmup})}>Edit</Button><Button variant="ghost" disabled={!!entry} onClick={()=>void save(removeWorkoutSet(workout.data,exercise.id,set.setNumber))}>Remove</Button></div>)}
     {workout.data.skippedSets?.filter(s=>s.exerciseId===exercise.id).map(skip=><div className="session-review-row" key={'skip-'+skip.workingSetNumber}><span>Set {skip.workingSetNumber} · Skipped</span><Button variant="ghost" disabled={!!entry} onClick={()=>setEntry({exerciseId:exercise.id,workingSetNumber:skip.workingSetNumber,reps:String(exercise.reps),load:String(exercise.load),warmup:false})}>Log skipped set</Button>{!workout.data.finishedAt&&<Button variant="ghost" disabled={!!entry} onClick={()=>void save(restoreSkippedSet(workout.data,exercise.id,skip.workingSetNumber))}>Undo skip</Button>}</div>)}
     <Button variant="secondary" disabled={!!entry} onClick={()=>setEntry({exerciseId:exercise.id,reps:String(exercise.reps),load:String(exercise.load),warmup:false})}>Add set</Button>
    </section>;
   })}</div>
   {!entry&&<div className="session-review-add-exercise"><ExercisePresetPicker label="Log another exercise" disabled={exercises.length>=30} onSelect={exercise=>{if(busy||saving.current)return;setAddedExercise(exercise);setSaveToRoutine(false);setEntry({exerciseId:exercise.id,reps:String(exercise.reps),load:String(exercise.load),warmup:false});setError('');}}/></div>}
   {entry&&selected&&<div className="session-review-entry"><h4>{entry.setNumber?'Edit':'Add'} {selected.name} set</h4><div className="session-review-inputs"><label>Reps completed<input autoFocus inputMode="numeric" type="number" min="0" max="100" value={entry.reps} onChange={event=>setEntry({...entry,reps:event.target.value})}/></label><label>Load ({selected.unit})<input inputMode="decimal" value={entry.load} onChange={event=>setEntry({...entry,load:event.target.value})}/></label>{addedExercise&&<label>Weight unit<select value={addedExercise.unit} onChange={event=>setAddedExercise({...addedExercise,unit:event.target.value as Exercise['unit']})}><option value="lb">lb</option><option value="kg">kg</option></select></label>}</div><label className="session-review-warmup"><input type="checkbox" checked={entry.warmup} disabled={entry.workingSetNumber!==undefined} onChange={event=>setEntry({...entry,warmup:event.target.checked})}/>Warm-up</label>{addedExercise&&onAddExercise&&<label className="session-review-program-choice"><input type="checkbox" checked={saveToRoutine} disabled={!canSaveToRoutine} onChange={event=>setSaveToRoutine(event.target.checked)}/><span>Also save this exercise to the routine{!canSaveToRoutine&&<small>The saved routine must be available and have room for another exercise.</small>}</span></label>}<div className="session-review-actions"><Button variant="secondary" onClick={clearEntry}>Cancel set edit</Button><Button onClick={saveEntry}>{addedExercise?'Save added exercise':'Save set'}</Button></div></div>}
   <label className="session-review-notes">Workout notes<textarea maxLength={5000} rows={3} placeholder="How did this session feel? Anything to change next time?" value={notes} onChange={event=>setNotes(event.target.value)}/></label>
   <div className="session-review-actions">{dirty&&<Button variant="ghost" onClick={()=>{clearEntry();setNotes(workout.data.notes||'');setSubmitted(null);}}>Discard review changes</Button>}{onContinue&&<Button variant="secondary" disabled={!!entry||noteDirty} onClick={onContinue}>Continue workout</Button>}{noteDirty&&<Button variant="secondary" disabled={!!entry} onClick={()=>void save(workout.data)}>Save notes</Button>}{onFinish&&<Button disabled={!!entry} onClick={()=>onFinish(notes)}>Finish workout</Button>}</div>
  </fieldset>
 </div>;
}
