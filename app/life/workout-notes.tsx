"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {todayIn,type Profile} from '@/lib/life/domain';
import type {WorkoutNote,Saved} from '@/lib/life/modules';
import {request,saveRecord,useUnsaved} from './shared';
import {useItemSave} from './budget-fields';
import Dictation from './dictation';
const fresh=(date:string):Saved<WorkoutNote>=>({id:crypto.randomUUID(),version:0,data:{date,text:'',minutes:null,voided:false}});
export default function WorkoutNotes({profile,onDirty}:{profile:Profile;onDirty:(v:boolean)=>void}){
 const today=todayIn(profile.timezone),[records,setRecords]=useState<Saved<WorkoutNote>[]>([]),[form,setForm]=useState(()=>fresh(today)),[listening,setListening]=useState(false),[notice,setNotice]=useState(''),[loadError,setLoadError]=useState('');
 const operation=useItemSave((record:Saved<WorkoutNote>)=>saveRecord('workout-note',record)),locked=listening||operation.busy||!!operation.pending;
 useUnsaved(!!form.data.text||form.data.minutes!==null||form.data.date!==today||form.version>0||locked,onDirty);
 async function load(){try{const result=await request('?kind=workout-note');setRecords(result.records);setLoadError('');}catch{setLoadError('Workout notes could not be loaded.');}}
 useEffect(()=>{void load();},[]);
 function edit(patch:Partial<WorkoutNote>){setForm({...form,data:{...form.data,...patch}});setNotice('');operation.setError('');}
 async function save(){const saved=await operation.submit(operation.pending||form);if(saved){setRecords(previous=>[saved,...previous.filter(n=>n.id!==saved.id)]);setForm(fresh(today));setNotice('Workout note saved. It will inform your analyses.');}}
 return <section className="module-card workout-notes" aria-label="Workout notes"><h3>Write your workout</h3><p className="muted">Log it in your own words. Sets, weights, a walk, or simply how training felt.</p>
 <fieldset disabled={locked}><div className="form-grid"><label className="compact-field">Workout date<input type="date" max={today} value={form.data.date} onChange={e=>edit({date:e.target.value})}/></label><label className="compact-field">Minutes (optional)<input type="number" min={1} max={1440} value={form.data.minutes??''} onChange={e=>edit({minutes:e.target.value===''?null:Number(e.target.value)})}/></label></div><label className="compact-field">Workout notes<textarea rows={4} maxLength={5000} value={form.data.text} onChange={e=>edit({text:e.target.value})} placeholder="Push day: bench 3 × 8 at 135 lb, incline dumbbells, lateral raises. Felt strong; finished with a 20-minute walk."/></label>{form.version>0&&<label className="inline-check"><input type="checkbox" checked={form.data.voided} onChange={e=>edit({voided:e.target.checked})}/>Exclude this note from analysis and trends</label>}</fieldset>
 <Dictation value={form.data.text} onChange={text=>edit({text})} onListening={setListening} disabled={operation.busy||!!operation.pending}/>
 {operation.error&&<p className="error" role="alert">{operation.error}</p>}{notice&&<p role="status" className="analysis-note">{notice}</p>}
 <div className="action-row"><Button disabled={listening||operation.busy||!form.data.text.trim()} onClick={()=>void save()}>{operation.busy?'Saving…':operation.pending?'Retry save':'Save workout note'}</Button><Button variant="ghost" disabled={locked} onClick={()=>{setForm(fresh(today));operation.setError('');}}>Cancel</Button></div>
 {loadError&&<p role="alert">{loadError}<Button variant="ghost" onClick={()=>void load()}>Retry notes</Button></p>}
 <details className="workout-note-history"><summary>Recent workout notes ({records.length})</summary>{records.map(n=><article key={n.id} className={n.data.voided?'note-excluded':''}><div className="section-heading"><strong>{n.data.date}{n.data.minutes!==null?` · ${n.data.minutes} min`:''}{n.data.voided?' · Excluded':''}</strong><Button variant="ghost" disabled={locked||!!form.data.text||form.version>0} onClick={()=>{setForm(structuredClone(n));setNotice('');}}>Edit note</Button></div><p>{n.data.text}</p></article>)}</details></section>;
}
