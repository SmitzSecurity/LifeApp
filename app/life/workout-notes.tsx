"use client";
import {DateInput} from './date-input';
import {formatDate} from '@/lib/life/date-display';
import NumericInput from './numeric-input';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {todayIn,type Profile} from '@/lib/life/domain';
import type {WorkoutNote,Saved} from '@/lib/life/modules';
import {request,saveRecord,useUnsaved,useWorkoutCancel} from './shared';
import {useItemSave} from './budget-fields';
import StructuredWorkoutEditor from './structured-workout-editor';
import Dictation from './dictation';
const fresh=(date:string):Saved<WorkoutNote>=>({id:crypto.randomUUID(),version:0,data:{date,text:'',minutes:null,voided:false}});
export default function WorkoutNotes({profile,onDirty,onSaved}:{profile:Profile;onDirty:(v:boolean)=>void;onSaved?:()=>void}){
 const today=todayIn(profile.timezone),[records,setRecords]=useState<Saved<WorkoutNote>[]>([]),[form,setForm]=useState(()=>fresh(today)),[listening,setListening]=useState(false),[notice,setNotice]=useState(''),[loadError,setLoadError]=useState('');
 const operation=useItemSave((record:Saved<WorkoutNote>)=>saveRecord('workout-note',record)),locked=listening||operation.busy||!!operation.pending;
 useUnsaved(!!form.data.text||form.data.minutes!==null||form.data.date!==today||form.version>0||locked,onDirty);
 const cancel=useWorkoutCancel(()=>{setForm(fresh(today));setNotice('');operation.setError('');},operation.busy||!!operation.pending);
 async function load(){try{const result=await request('?kind=workout-note');setRecords(result.records);setLoadError('');}catch{setLoadError('Workout notes could not be loaded.');}}
 useEffect(()=>{void load();},[]);
 function edit(patch:Partial<WorkoutNote>){setForm({...form,data:{...form.data,...patch}});setNotice('');operation.setError('');}
 async function save(record=form){const saved=await operation.submit(operation.pending||record);if(saved){setRecords(previous=>[saved,...previous.filter(n=>n.id!==saved.id)]);setForm(fresh(today));onSaved?.();setNotice(saved.data.deleted?'Workout moved to Trash.':saved.data.structured?'Workout saved. Confirmed sets now count toward muscle coverage; its exercises are available as personal presets.':'Workout note saved. It will inform your analyses.');}}
 return <section className="module-card workout-notes" aria-label="Workout notes"><h3>Write your workout</h3><p className="muted">Log it in your own words. Sets, weights, a walk, or simply how training felt.</p>
 <fieldset disabled={locked}><div className="form-grid"><div className="compact-field"><DateInput label="Workout date" required max={today} value={form.data.date} onValueChange={date=>edit({date})}/></div><label className="compact-field">Minutes (optional)<NumericInput key={form.id+':minutes'} optional min={1} max={1440} value={form.data.minutes} onValueChange={minutes=>edit({minutes})}/></label></div><label className="compact-field">Workout notes<textarea rows={4} maxLength={5000} value={form.data.text} onChange={e=>edit({text:e.target.value})} placeholder="Push day: bench 3 × 8 at 135 lb, incline dumbbells, lateral raises. Felt strong; finished with a 20-minute walk."/></label>{form.version>0&&<label className="inline-check"><input type="checkbox" checked={form.data.voided} onChange={e=>edit({voided:e.target.checked})}/>Exclude this note from analysis and trends</label>}</fieldset>
 <Dictation value={form.data.text} onChange={text=>edit({text})} onListening={setListening} disabled={operation.busy||!!operation.pending}/>
 {form.data.structured&&<fieldset disabled={locked}><StructuredWorkoutEditor value={form.data.structured} onChange={structured=>edit({structured})}/><p className="muted">Your saved structured sets remain editable and count toward muscle coverage.</p></fieldset>}
 {operation.error&&<p className="error" role="alert">{operation.error}</p>}{notice&&<p role="status" className="analysis-note">{notice}</p>}
 <div className="action-row written-save"><Button disabled={listening||operation.busy||!form.data.text.trim()} onClick={()=>void save()}>{operation.busy?'Saving…':operation.pending?'Retry save':form.data.structured?'Save workout':'Save workout note'}</Button><Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={cancel}>Cancel</Button></div>
 {loadError&&<p role="alert">{loadError}<Button variant="ghost" onClick={()=>void load()}>Retry notes</Button></p>}
 <details className="workout-note-history"><summary>Recent workout notes ({records.filter(r=>!r.data.deleted).length})</summary>{records.filter(n=>!n.data.deleted).map(n=><article key={n.id} className={n.data.voided?'note-excluded':''}><div className="section-heading"><strong>{formatDate(n.data.date)}{n.data.minutes!==null?` · ${n.data.minutes} min`:''}{n.data.deleted?' · Trash':n.data.voided?' · Excluded':''}</strong><Button variant="ghost" disabled={locked||n.data.deleted||!!form.data.text||form.version>0} onClick={()=>{setForm(structuredClone(n));setNotice('');}}>Edit note</Button><Button variant="ghost" disabled={locked||!!form.data.text||form.version>0} onClick={()=>void save({...n,data:{...n.data,deleted:!n.data.deleted}})}>{n.data.deleted?'Restore':'Delete'}</Button></div><p>{n.data.text}</p></article>)}</details></section>;
}
