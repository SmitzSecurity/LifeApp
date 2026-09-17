"use client";
import {useEffect,useRef} from 'react';
import {Button} from '@/components/ui/button';
import {repTarget} from '@/lib/life/exercise-presets';
import type {Routine,Saved} from '@/lib/life/modules';

export default function RoutineConflict({saved,busy,onReload,onUseSaved,onSaveCopy,session=false}:{saved:Saved<Routine>|null;busy:boolean;onReload:()=>void;onUseSaved:()=>void;onSaveCopy?:()=>void;session?:boolean}){
 const region=useRef<HTMLElement>(null);useEffect(()=>{region.current?.scrollIntoView({block:'nearest'});},[]);
 return <section ref={region} className="routine-conflict" aria-label="Program conflict">
  <p role="alert">This program changed elsewhere. Your edits are preserved.</p>
  {saved?<details><summary>Review saved program · version {saved.version}</summary><h3>{saved.data.name}{saved.data.archived?' · Archived':''}</h3><p>{saved.data.weeklySessions===undefined?'Weekly frequency not set':`${saved.data.weeklySessions} sessions / week`}</p><ol>{saved.data.exercises.map(exercise=><li key={exercise.id}><strong>{exercise.name}</strong><span>{exercise.sets} sets × {repTarget(exercise)} reps · {exercise.load} {exercise.unit} · {exercise.restSeconds}s rest</span></li>)}</ol></details>:<p className="muted">The saved version could not be loaded. Check again, or save your edits as a new program.</p>}
  <div className="action-row">{onSaveCopy&&<Button disabled={busy} onClick={onSaveCopy}>Save edits as new program</Button>}{saved?<Button variant="secondary" disabled={busy} onClick={onUseSaved}>{session?'Discard session edits & use saved program':'Discard edits & load saved program'}</Button>:<Button variant="secondary" disabled={busy} onClick={onReload}>Check saved program</Button>}</div>
 </section>;
}
