"use client";

import {Pencil,Play,RotateCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {repTarget} from '@/lib/life/exercise-presets';
import type {Routine,Saved} from '@/lib/life/modules';
import './routine-preview.css';

type RoutinePreviewProps={
 routine:Saved<Routine>;
 onEdit:(exerciseId?:string)=>void;
 onStart:()=>void;
 onReset:()=>void;
 changed:boolean;
 busy?:boolean;
 disabled?:boolean;
};

export default function RoutinePreview({routine,onEdit,onStart,onReset,changed,busy=false,disabled=false}:RoutinePreviewProps){
 const {data}=routine,locked=busy||disabled;

 return <section className="training-card routine-preview" aria-label="Selected program preview">
  <header className="routine-preview-heading">
   <p className="routine-preview-eyebrow">Session preview</p>
   <h3>{data.name}</h3>
   <Button type="button" variant="ghost" className="routine-preview-edit" disabled={locked} onClick={()=>onEdit()}><Pencil aria-hidden="true"/>Edit session</Button>
   <p className="routine-preview-summary">{data.exercises.length} exercises · {data.exercises.reduce((total,exercise)=>total+exercise.sets,0)} working sets{data.weeklySessions!==undefined&&` · ${data.weeklySessions}× / week`}</p>
  </header>
  <div className="routine-preview-order-heading"><p>Use Edit session to adjust this workout. Your saved program stays unchanged.</p>{changed&&<Button type="button" variant="ghost" disabled={locked} onClick={onReset}><RotateCcw aria-hidden="true"/>Reset session</Button>}</div>
  <ol className="routine-preview-exercises" aria-label="Exercise order">
   {data.exercises.map((exercise,index)=><li key={exercise.id} className="routine-preview-exercise">
    <span className="routine-preview-number" aria-hidden="true">{index+1}</span>
    <div className="routine-preview-exercise-copy"><h4>{exercise.name}</h4><p>{exercise.sets} sets × {repTarget(exercise)} reps</p><small>Starting load {exercise.load} {exercise.unit} · {exercise.restSeconds}s rest</small></div>
   </li>)}
  </ol>
  {!data.exercises.length&&<p className="empty-inline">Add exercises with Edit session before starting.</p>}
  <footer className="routine-preview-footer"><p>{changed?'This workout will use your session changes.':'Review your targets, then begin.'}</p><Button type="button" disabled={locked||!data.exercises.length} onClick={onStart}><Play aria-hidden="true"/>{busy?'Starting…':'Start workout'}</Button></footer>
 </section>;
}
