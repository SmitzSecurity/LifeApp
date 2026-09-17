"use client";
import {DateInput} from './date-input';
import {formatDate} from '@/lib/life/date-display';
import {definiteClientRejection} from '@/lib/life/write-retry';
import NumericInput from './numeric-input';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {todayIn,type Profile} from '@/lib/life/domain';
import type {Cardio,Saved} from '@/lib/life/modules';
import {Choice,request,saveRecord,useUnsaved,useWorkoutCancel} from './shared';
const activities=['walk','run','cycle','swim','row','elliptical','other'] as const;
export default function CardioLog({profile,onDirty,active=false,onSaved,onCancel}:{onCancel?:()=>void;onSaved?:()=>void;active?:boolean;profile:Profile;onDirty:(dirty:boolean)=>void}){
 const [records,setRecords]=useState<Saved<Cardio>[]>([]),[form,setForm]=useState<Saved<Cardio>|null>(null),[pending,setPending]=useState<Saved<Cardio>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useUnsaved(!!form||!!pending,onDirty);
 const cancel=useWorkoutCancel(()=>{setForm(null);setError('');setNotice('');onCancel?.();},busy||!!pending);
 async function load(){try{const data=await request('?kind=cardio');setRecords(data.records);setError('');}catch{setError('Cardio history could not be loaded.');}}
 useEffect(()=>{void load();},[]);
 function start(){setError('');setNotice('');setForm({id:crypto.randomUUID(),version:0,data:{date:todayIn(profile.timezone),activity:'walk',minutes:20,distance:null,unit:'mi',intensity:'moderate',note:'',voided:false}});}
 useEffect(()=>{if(active&&!form)start();},[active]);
 function edit(patch:Partial<Cardio>){if(form)setForm({...form,data:{...form.data,...patch}});}
 async function save(record=form){if(!record)return;const retrying=!!pending;setBusy(true);setError('');setPending(record);try{const saved=await saveRecord('cardio',record);setRecords(prev=>[saved,...prev.filter(r=>r.id!==saved.id)]);if(form?.id===saved.id)setForm(null);setPending(null);setNotice(saved.data.deleted?'Cardio moved to Trash.':'Cardio saved.');onSaved?.();}catch(e){setError((e as Error).message);if(definiteClientRejection((e as {status?:number}).status,retrying))setPending(null);}finally{setBusy(false);}}
 return <section className="module-card cardio-card" aria-label="Cardio">{!form&&<div className="section-heading"><h3>Cardio history</h3><Button disabled={busy} onClick={start}>Log cardio</Button></div>}
  {error&&<p className="error" role="alert">{error}{pending&&<Button disabled={busy} onClick={()=>save(pending)}>Retry cardio save</Button>}</p>}{notice&&<p className="analysis-note" role="status">{notice}</p>}
  {form&&<fieldset disabled={busy||!!pending}><div className="form-grid"><label className="compact-field">Activity<Choice label="Cardio activity" value={form.data.activity} options={activities.map(a=>({value:a,label:a[0].toUpperCase()+a.slice(1)}))} onChange={activity=>edit({activity:activity as Cardio['activity']})}/></label><div className="compact-field"><DateInput label="Date" required max={todayIn(profile.timezone)} value={form.data.date} onValueChange={date=>edit({date})}/></div><label className="compact-field">Duration (minutes)<NumericInput key={form.id+':minutes'} min={1} max={1440} step="any" value={form.data.minutes} onValueChange={minutes=>edit({minutes})}/></label><label className="compact-field">Distance (optional)<NumericInput key={form.id+':distance'} optional min={0} max={2000} step="0.01" value={form.data.distance} onValueChange={distance=>edit({distance})}/></label><label className="compact-field">Distance unit<Choice label="Cardio distance unit" value={form.data.unit} options={[{value:'mi',label:'Miles'},{value:'km',label:'Kilometers'},{value:'m',label:'Meters'}]} onChange={unit=>edit({unit:unit as Cardio['unit']})}/></label><label className="compact-field">Effort<Choice label="Cardio effort" value={form.data.intensity} options={['easy','moderate','hard'].map(v=>({value:v,label:v[0].toUpperCase()+v.slice(1)}))} onChange={intensity=>edit({intensity:intensity as Cardio['intensity']})}/></label></div><label className="compact-field">Notes (optional)<textarea rows={2} maxLength={500} value={form.data.note} onChange={e=>edit({note:e.target.value})}/></label>{form.version>0&&<label className="inline-check"><input type="checkbox" checked={form.data.voided} onChange={e=>edit({voided:e.target.checked})}/>Exclude this activity from totals</label>}<div className="action-row"><Button variant="ghost" onClick={cancel}>Cancel</Button><Button onClick={()=>save()}>Save</Button></div></fieldset>}
  {!records.length&&!form&&<p className="muted">Walks, runs, rides, swims and more.</p>}
  {!form&&<>{records.filter(r=>!r.data.deleted).map(r=><div className="ledger-row" key={r.id}><span><strong>{r.data.deleted?'Trash · ':r.data.voided?'Excluded · ':''}{r.data.activity[0].toUpperCase()+r.data.activity.slice(1)} · {r.data.minutes} min</strong><small>{formatDate(r.data.date)}{r.data.distance!==null?` · ${r.data.distance} ${r.data.unit}`:''}</small></span><Button variant="ghost" disabled={!!form||busy||!!r.data.deleted} onClick={()=>{setForm(structuredClone(r));setNotice('');}}>Edit cardio</Button><Button variant="ghost" disabled={busy||!!pending} onClick={()=>void save({...r,data:{...r.data,deleted:!r.data.deleted}})}>{r.data.deleted?'Restore':'Delete'}</Button></div>)}</>}
 </section>;
}
