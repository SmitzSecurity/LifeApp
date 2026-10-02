"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {exercisePresets,presetExercise} from '@/lib/life/exercise-presets';
import {resolveExerciseName} from '@/lib/life/exercise-names';
import {exerciseSchema,type Exercise} from '@/lib/life/modules';
import {request} from './shared';
import './exercise-preset-picker.css';

export default function ExercisePresetPicker({label='Add exercise',disabled=false,onSelect}:{label?:string;disabled?:boolean;onSelect:(exercise:Exercise)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[personal,setPersonal]=useState<Exercise[]>([]),[loadError,setLoadError]=useState(false),[readAttempt,setReadAttempt]=useState(0);
 const panelId=useId(),search=useRef<HTMLInputElement>(null);
 useEffect(()=>{let cancelled=false;request('?personal-exercises').then(result=>{if(cancelled)return;setPersonal((Array.isArray(result.exercises)?result.exercises:[]).flatMap((candidate:unknown)=>{const parsed=exerciseSchema.safeParse(candidate);return parsed.success?[parsed.data]:[];}));setLoadError(false);}).catch(()=>{if(!cancelled)setLoadError(true);});return()=>{cancelled=true;};},[readAttempt]);
 useEffect(()=>{if(open)search.current?.focus({preventScroll:true});},[open]);
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),matches=(name:string)=>terms.every(term=>name.toLocaleLowerCase().includes(term));
 const personalMatches=personal.filter(exercise=>matches(exercise.name)),standardMatches=exercisePresets.filter(exercise=>!personal.some(saved=>resolveExerciseName(saved.name)===resolveExerciseName(exercise.name))&&matches(exercise.name));
 function choose(exercise:Exercise){if(disabled)return;onSelect({...structuredClone(exercise),id:crypto.randomUUID()});setQuery('');setOpen(false);}
 return <div className="exercise-preset-picker"><button type="button" className="exercise-preset-toggle" disabled={disabled} aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(value=>!value)}>{label}<span aria-hidden="true">{open?'−':'+'}</span></button>{open&&<div className="exercise-preset-panel" id={panelId}><label className="compact-field">Find an exercise<input ref={search} type="search" value={query} disabled={disabled} placeholder="Type to filter presets…" onChange={event=>setQuery(event.target.value)}/></label><div className="exercise-preset-results" aria-label="Exercise presets">{!!personalMatches.length&&<section aria-label="Personal presets"><h4>Personal presets</h4>{personalMatches.map(exercise=><button type="button" key={exercise.id} disabled={disabled} onClick={()=>choose(exercise)}>{exercise.name}</button>)}</section>}{!!standardMatches.length&&<section aria-label="Standard exercises"><h4>Standard exercises</h4>{standardMatches.map(exercise=><button type="button" key={exercise.name} disabled={disabled} onClick={()=>choose(presetExercise(exercise.name))}>{exercise.name}</button>)}</section>}{!personalMatches.length&&!standardMatches.length&&<p role="status">No matching exercises.</p>}</div>{loadError&&<p className="muted">Personal presets could not be loaded. <button type="button" disabled={disabled} onClick={()=>setReadAttempt(value=>value+1)}>Retry personal presets</button></p>}</div>}</div>;
}
