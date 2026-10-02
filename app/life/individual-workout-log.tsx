"use client";
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {todayIn,type Profile} from '@/lib/life/domain';
import type {Exercise,Saved,WorkoutNote} from '@/lib/life/modules';
import {freshIndividualSet,freshIndividualWorkout,individualWorkoutRecord,type IndividualSetDraft,type IndividualWorkoutDraft} from '@/lib/life/individual-workout';
import {definiteClientRejection} from '@/lib/life/write-retry';
import {saveRecord,useUnsaved,useWorkoutCancel} from './shared';
import {DateInput} from './date-input';
import NumericInput from './numeric-input';
import ExercisePresetPicker from './exercise-preset-picker';
import './individual-workout-log.css';

export default function IndividualWorkoutLog({profile,onDirty,onSaved,onCancel}:{profile:Profile;onDirty:(dirty:boolean)=>void;onSaved?:()=>void;onCancel:()=>void}){
 const today=todayIn(profile.timezone),[draft,setDraft]=useState(()=>freshIndividualWorkout(today)),[busy,setBusy]=useState(false),[pending,setPending]=useState<Saved<WorkoutNote>|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const frozen=useRef<Saved<WorkoutNote>|null>(null),inFlight=useRef(false),locked=busy||!!pending;
 useUnsaved(locked||!!draft.exercises.length||!!draft.notes||draft.minutes!==null||draft.date!==today||draft.name!=='Individual workout',onDirty);
 const cancel=useWorkoutCancel(()=>{setDraft(freshIndividualWorkout(today));setError('');setNotice('');onCancel();},locked);
 function edit(patch:Partial<IndividualWorkoutDraft>){setDraft(value=>({...value,...patch}));setError('');setNotice('');}
 function add(exercise:Exercise){if(locked||draft.exercises.length>=30)return;edit({exercises:[...draft.exercises,exercise],sets:[...draft.sets,freshIndividualSet(exercise.id,1)],lastSerials:{...draft.lastSerials,[exercise.id]:1}});}
 function addSet(exerciseId:string,warmup:boolean){const serial=(draft.lastSerials[exerciseId]||0)+1;if(locked||serial>40||draft.sets.filter(set=>set.exerciseId===exerciseId&&set.warmup===warmup).length>=20)return;edit({sets:[...draft.sets,freshIndividualSet(exerciseId,serial,warmup)],lastSerials:{...draft.lastSerials,[exerciseId]:serial}});}
 function changeSet(row:IndividualSetDraft,patch:Partial<IndividualSetDraft>){edit({sets:draft.sets.map(set=>set===row?{...set,...patch}:set)});}
 async function save(){
  if(inFlight.current)return;
  const retrying=!!frozen.current;let record=frozen.current;
  if(!record){try{record=individualWorkoutRecord(draft,today);}catch(caught){setError((caught as Error).message);return;}}
  frozen.current=structuredClone(record);setPending(frozen.current);inFlight.current=true;setBusy(true);setError('');
  let acknowledged:Saved<WorkoutNote>|null=null;
  try{acknowledged=await saveRecord('workout-note',frozen.current);}catch(caught){setError((caught as Error).message);if(definiteClientRejection((caught as {status?:number}).status,retrying)){frozen.current=null;setPending(null);}}
  finally{inFlight.current=false;setBusy(false);}
  if(acknowledged){frozen.current=null;setPending(null);setDraft(freshIndividualWorkout(today));setNotice('Workout saved. Its confirmed sets count toward your activity and muscle coverage.');onSaved?.();}
 }
 return <><div className="routine-scroll individual-workout-log"><p className="muted">Log completed exercises without starting a program. Choose a preset, then enter the sets you did.</p><fieldset disabled={locked}><div className="form-grid"><div className="compact-field"><DateInput label="Workout date" required max={today} value={draft.date} onValueChange={date=>edit({date})}/></div><label className="compact-field">Workout name<input value={draft.name} maxLength={100} onChange={event=>edit({name:event.target.value})}/></label></div><ExercisePresetPicker disabled={locked||draft.exercises.length>=30} onSelect={add}/>{draft.exercises.map(exercise=>{
  const sets=draft.sets.filter(set=>set.exerciseId===exercise.id),working=sets.filter(set=>!set.warmup).length,warmups=sets.length-working,canAdd=(draft.lastSerials[exercise.id]||0)<40;
  return <section className="individual-exercise" key={exercise.id} aria-label={exercise.name}><div className="individual-exercise-heading"><h3>{exercise.name}</h3><label className="compact-field">Unit<select aria-label={`${exercise.name} load unit`} value={exercise.unit} onChange={event=>edit({exercises:draft.exercises.map(item=>item.id===exercise.id?{...item,unit:event.target.value as 'lb'|'kg'}:item)})}><option>lb</option><option>kg</option></select></label></div><div className="individual-set-head" aria-hidden="true"><span>Set</span><span>Reps</span><span>Load ({exercise.unit})</span><span>Warm-up</span><span/></div>{sets.map((set,index)=><div className="individual-set-row" key={set.setNumber}><span>{index+1}</span><NumericInput optional aria-label={`${exercise.name} set ${index+1} reps`} min={0} max={100} value={set.reps} onValueChange={reps=>changeSet(set,{reps})}/><NumericInput optional aria-label={`${exercise.name} set ${index+1} load`} min={0} max={2000} step="any" value={set.load} onValueChange={load=>changeSet(set,{load})}/><label className="individual-warmup"><input type="checkbox" aria-label={`${exercise.name} set ${index+1} warm-up`} checked={set.warmup} disabled={set.warmup?working>=20:warmups>=20} onChange={event=>changeSet(set,{warmup:event.target.checked})}/></label><Button variant="ghost" aria-label={`Remove ${exercise.name} set ${index+1}`} onClick={()=>edit({sets:draft.sets.filter(item=>item!==set)})}>×</Button></div>)}<div className="action-row"><Button variant="secondary" disabled={!canAdd||working>=20} onClick={()=>addSet(exercise.id,false)}>Add working set</Button><Button variant="ghost" disabled={!canAdd||warmups>=20} onClick={()=>addSet(exercise.id,true)}>Add warm-up</Button><Button variant="ghost" onClick={()=>edit({exercises:draft.exercises.filter(item=>item.id!==exercise.id),sets:draft.sets.filter(set=>set.exerciseId!==exercise.id)})}>Remove exercise</Button></div>{!canAdd&&<p className="muted">This exercise has used all 40 set identities. Edit an existing row or add a separate exercise block.</p>}</section>;
 })}<div className="form-grid"><label className="compact-field">Minutes (optional)<NumericInput optional min={1} max={1440} value={draft.minutes} onValueChange={minutes=>edit({minutes})}/></label></div><label className="compact-field">Workout notes (optional)<textarea rows={3} maxLength={4800} value={draft.notes} onChange={event=>edit({notes:event.target.value})}/></label></fieldset>{notice&&<p role="status" className="analysis-note">{notice}</p>}</div><footer className="workout-panel-footer">{error&&<p className="error" role="alert">{error}</p>}{pending&&<p className="muted">Save unconfirmed. Retry the same workout.</p>}<div className="action-row"><Button variant="ghost" disabled={locked} onClick={cancel}>Cancel</Button><Button disabled={busy||(!pending&&!draft.exercises.length)} onClick={()=>void save()}>{busy?'Saving…':pending?'Retry workout save':'Save workout'}</Button></div></footer></>;
}
