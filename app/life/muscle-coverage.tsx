"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {muscleIds,muscleNames,VOLUME_REFERENCE,type MuscleId} from '@/lib/life/muscle-groups';
import {exerciseTargets,plannedVolume,routineVolume,type tallyVolume} from '@/lib/life/muscle-volume';
import {exercisePresets} from '@/lib/life/exercise-presets';
import type {Routine,Saved} from '@/lib/life/modules';
import type {TrainingSummary} from '@/lib/life/training-summary';
import MuscleMap from './muscle-map';
export default function MuscleCoverage({routines,selectedId,onSelect,summary,incomplete,onEdit,onGuide}:{routines:Saved<Routine>[];selectedId:string;onSelect:(id:string)=>void;summary:TrainingSummary|null;incomplete:boolean;onEdit:(id:string,exercise?:string)=>void;onGuide:()=>void}){
 const [mode,setMode]=useState('program'),[muscle,setMuscle]=useState<MuscleId>('chest');
 const selected=routines.find(r=>r.id===selectedId),planned=plannedVolume(routines);
 const volume:ReturnType<typeof tallyVolume>|null=mode==='week'?summary?.current||null:mode==='plan'?incomplete?null:planned:selected?routineVolume(selected):null;
 const m=volume?.muscles[muscle],weekly=mode!=='program',suggestions=exercisePresets.filter(e=>exerciseTargets({name:e.name})?.direct.includes(muscle)).slice(0,4);
 return <section className="training-card coverage-card" aria-label="Muscle coverage"><div className="section-heading"><h3>Muscle coverage</h3><Button variant="ghost" onClick={onGuide} aria-label="How muscle volume is estimated">ⓘ</Button></div><div className="coverage-tabs" role="group" aria-label="Volume view">{[['program','Program'],['plan','Weekly plan'],['week','This week']].map(([id,label])=><button key={id} aria-pressed={mode===id} onClick={()=>setMode(id)}>{label}</button>)}</div>
 {mode==='program'&&<label className="coverage-choice"><span className="sr-only">Program to inspect</span><select value={selectedId} onChange={e=>onSelect(e.target.value)} aria-label="Program to inspect">{!routines.length&&<option value="">No saved programs</option>}{routines.map(r=><option key={r.id} value={r.id}>{r.data.name}</option>)}</select><small>Planned sets per session</small></label>}
 {mode==='plan'&&<p className="coverage-caption">{incomplete?'Too many programs to show complete weekly totals.':`${planned.sessions} planned sessions / week${planned.unscheduled?` · ${planned.unscheduled} program${planned.unscheduled===1?'':'s'} need a frequency`:''}`}</p>}
 {mode==='week'&&<p className="coverage-caption">{summary?`${summary.current.from} – ${summary.today} · logged working sets`:'Weekly totals unavailable.'}</p>}
 {volume&&m?<><div className="coverage-visual"><MuscleMap volumes={volume.muscles} selected={muscle} onSelect={setMuscle}/><div className="muscle-detail"><label className="compact-field">Muscle group<select value={muscle} onChange={e=>setMuscle(e.target.value as MuscleId)}>{muscleIds.map(id=><option key={id} value={id}>{muscleNames[id]}</option>)}</select></label><strong className="volume-number">{m.estimated}<small>estimated sets{weekly?' / week':''}</small></strong><p className="volume-equation">{m.direct} direct + {m.indirect} indirect × ½</p>{weekly&&<><progress aria-label={`${muscleNames[muscle]} against the 10-set weekly reference`} value={Math.min(m.estimated,VOLUME_REFERENCE)} max={VOLUME_REFERENCE}/><small className="muted">~10 / week reference, not a personal target.</small></>}<ul className="muscle-contributors">{volume.contributors.filter(e=>e.direct.includes(muscle)||e.indirect.includes(muscle)).map((e,i)=><li key={i}><span>{e.name}<small>{e.direct.includes(muscle)?'Direct':'Indirect'}</small></span><b>{e.sets}</b></li>)}</ul>{!m.estimated&&<p className="muted">No mapped sets for this muscle in this view.</p>}</div></div>
 <div className="map-legend" aria-label="Map color scale"><span>0</span><i/><span>5</span><i/><span>10+</span><small>estimated sets</small></div>
 {volume.unmapped.length>0&&<p className="coverage-caption">{volume.unmapped.reduce((n,e)=>n+e.sets,0)} sets need muscle assignments: {[...new Set(volume.unmapped.map(e=>e.name))].join(', ')}.</p>}
 {mode!=='week'&&selected&&<div className="coverage-adjust"><Button variant="secondary" onClick={()=>onEdit(selected.id)}>Adjust {selected.data.name}</Button>{!m.estimated&&suggestions.length>0&&<label className="compact-field">Add a {muscleNames[muscle].toLowerCase()} exercise<select aria-label="Suggested exercise" value="" onChange={e=>onEdit(selected.id,e.target.value)}><option value="">Choose an exercise…</option>{suggestions.map(e=><option key={e.name}>{e.name}</option>)}</select></label>}</div>}
 </>:<p className="empty-inline">{mode==='program'?'Save a program to explore the muscles it targets.':'Complete totals could not be shown. Try refreshing Workouts.'}</p>}
 </section>;
}
