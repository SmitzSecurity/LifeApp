"use client";
import NumericInput from './numeric-input';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {GripVertical} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {muscleIds,muscleNames,type MuscleId} from '@/lib/life/muscle-groups';
import {exerciseTargets} from '@/lib/life/muscle-volume';
import {exercisePresets,presetExercise,repTarget} from '@/lib/life/exercise-presets';
import {request} from './shared';
import {resolveExerciseName} from '@/lib/life/exercise-names';
import type {Exercise,Routine,Saved} from '@/lib/life/modules';
import './routine-editor.css';
import RoutineConflict from './routine-conflict';

type DropPosition={id:string;after:boolean};
type ExerciseDrag={id:string;pointerId:number;handle:HTMLButtonElement;startX:number;startY:number;x:number;y:number;active:boolean;drop:DropPosition|null};
export default function RoutineEditor({routine,onChange,onSave,onCancel,busy,pending,error,initialExerciseId,session=false,conflict,onReloadConflict,onUseSaved,onSaveCopy}:{session?:boolean;initialExerciseId?:string;routine:Saved<Routine>;onChange:(r:Routine)=>void;onSave:()=>void;onCancel:()=>void;busy:boolean;pending:boolean;error:string;conflict?:Saved<Routine>|null;onReloadConflict?:()=>void;onUseSaved?:()=>void;onSaveCopy?:()=>void}){
 const [exerciseId,setExerciseId]=useState(initialExerciseId||routine.data.exercises[0]?.id),[tab,setTab]=useState('targets');
 const [personal,setPersonal]=useState<Exercise[]>([]);useEffect(()=>{request('?personal-exercises').then(r=>setPersonal(r.exercises)).catch(()=>{});},[]);
 const data=routine.data,exercise=data.exercises.find(e=>e.id===exerciseId)||data.exercises[0],targets=exercise?exerciseTargets(exercise):null;
 const list=useRef<HTMLDivElement>(null),drag=useRef<ExerciseDrag|null>(null),hold=useRef<ReturnType<typeof setTimeout>|null>(null),frame=useRef<number|null>(null);
 const latest=useRef({data,onChange,busy,pending});
 useLayoutEffect(()=>{latest.current={data,onChange,busy,pending};},[data,onChange,busy,pending]);
 const [dragView,setDragView]=useState<{id:string;drop:DropPosition|null}|null>(null),[reorderAnnouncement,setReorderAnnouncement]=useState('');
 const locked=busy||pending,[wasLocked,setWasLocked]=useState(locked);
 if(wasLocked!==locked){setWasLocked(locked);if(locked&&dragView){setDragView(null);setReorderAnnouncement('Reordering cancelled. Exercise order is unchanged.');}}
 const releaseDrag=useCallback(()=>{
  const previous=drag.current;drag.current=null;
  if(hold.current!==null){clearTimeout(hold.current);hold.current=null;}
  if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}
  if(previous?.handle.hasPointerCapture(previous.pointerId))previous.handle.releasePointerCapture(previous.pointerId);
 },[]);
 const clearDrag=useCallback(()=>{releaseDrag();setDragView(null);},[releaseDrag]);
 const cancelDrag=useCallback(()=>{const wasActive=drag.current?.active;clearDrag();if(wasActive)setReorderAnnouncement('Reordering cancelled. Exercise order is unchanged.');},[clearDrag]);
 useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&drag.current){event.preventDefault();event.stopPropagation();cancelDrag();}};document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('keydown',escape,true);releaseDrag();};},[cancelDrag,releaseDrag]);
 useEffect(()=>{if(locked)releaseDrag();},[locked,releaseDrag]);
 function dropAtPointer(current:ExerciseDrag){
  const container=list.current;if(!container)return null;
  const bounds=container.getBoundingClientRect();
  if(current.x<bounds.left-32||current.x>bounds.right+32||current.y<bounds.top-48||current.y>bounds.bottom+48)return null;
  const rows=[...container.querySelectorAll<HTMLElement>('[data-sort-id]')].filter(row=>row.dataset.sortId!==current.id);
  for(const row of rows){const rect=row.getBoundingClientRect();if(current.y<rect.top+rect.height/2)return {id:row.dataset.sortId!,after:false};}
  return rows.length?{id:rows[rows.length-1].dataset.sortId!,after:true}:null;
 }
 function showDrop(current:ExerciseDrag){
  const next=dropAtPointer(current),previous=current.drop;
  if(previous?.id===next?.id&&previous?.after===next?.after)return;
  current.drop=next;setDragView({id:current.id,drop:next});
 }
 function scrollDrag(){
  const current=drag.current,container=list.current;if(!current?.active||!container){frame.current=null;return;}
  const bounds=container.getBoundingClientRect(),edge=Math.min(44,bounds.height/3);
  if(current.x>=bounds.left-32&&current.x<=bounds.right+32){
   const speed=current.y<bounds.top+edge?-Math.min(12,(bounds.top+edge-current.y)/3):current.y>bounds.bottom-edge?Math.min(12,(current.y-bounds.bottom+edge)/3):0;
   if(speed)container.scrollTop+=speed;
  }
  showDrop(current);frame.current=requestAnimationFrame(scrollDrag);
 }
 function activateDrag(current:ExerciseDrag){
  if(current.active||latest.current.busy||latest.current.pending)return;
  if(hold.current!==null){clearTimeout(hold.current);hold.current=null;}
  current.active=true;current.drop=dropAtPointer(current);setDragView({id:current.id,drop:current.drop});
  const name=latest.current.data.exercises.find(item=>item.id===current.id)?.name||'Exercise';setReorderAnnouncement(`Moving ${name}. Release to place it, or press Escape to cancel.`);
  frame.current=requestAnimationFrame(scrollDrag);
 }
 function beginDrag(event:ReactPointerEvent<HTMLButtonElement>,id:string){
  if(!event.isPrimary||event.button!==0||latest.current.busy||latest.current.pending||latest.current.data.exercises.length<2)return;
  event.preventDefault();clearDrag();
  const handle=event.currentTarget;handle.setPointerCapture(event.pointerId);
  drag.current={id,pointerId:event.pointerId,handle,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,drop:null};
  hold.current=setTimeout(()=>{
   hold.current=null;const current=drag.current;if(current?.id===id)activateDrag(current);
  },200);
 }
 function moveDrag(event:ReactPointerEvent<HTMLButtonElement>){const current=drag.current;if(!current||current.pointerId!==event.pointerId)return;event.preventDefault();current.x=event.clientX;current.y=event.clientY;if(!current.active&&event.pointerType!=='touch'&&Math.hypot(current.x-current.startX,current.y-current.startY)>=6)activateDrag(current);if(current.active)showDrop(current);}
 function finishDrag(event:ReactPointerEvent<HTMLButtonElement>){
  const current=drag.current;if(!current||current.pointerId!==event.pointerId)return;event.preventDefault();
  current.x=event.clientX;current.y=event.clientY;const position=current.active?dropAtPointer(current):null,latestData=latest.current.data;
  clearDrag();
  if(!current.active||!position||latest.current.busy||latest.current.pending){if(current.active)setReorderAnnouncement('Exercise order is unchanged.');return;}
  const moved=latestData.exercises.find(item=>item.id===current.id),remaining=latestData.exercises.filter(item=>item.id!==current.id),destination=remaining.findIndex(item=>item.id===position.id);
  if(!moved||destination<0)return;
  const index=destination+(position.after?1:0);remaining.splice(index,0,moved);
  if(remaining.some((item,i)=>item.id!==latestData.exercises[i].id))latest.current.onChange({...latestData,exercises:remaining});
  setReorderAnnouncement(`${moved.name} is now exercise ${index+1} of ${remaining.length}.`);
 }

 function edit(patch:Partial<Exercise>){onChange({...data,exercises:data.exercises.map(e=>e.id===exercise.id?{...e,...patch}:e)});}
 function add(name:string){if(data.exercises.length>=30)return;const saved=personal.find(e=>resolveExerciseName(e.name)===resolveExerciseName(name));const e=saved?{...structuredClone(saved),id:crypto.randomUUID()}:presetExercise(name);onChange({...data,exercises:[...data.exercises,e]});setExerciseId(e.id);}
 function mapMuscle(id:MuscleId,role:string){const next={direct:(targets?.direct||[]).filter(m=>m!==id),indirect:(targets?.indirect||[]).filter(m=>m!==id)};if(role==='direct')next.direct.push(id);if(role==='indirect')next.indirect.push(id);edit({muscles:next});}
 return <><div className="routine-scroll">{conflict!==undefined&&onReloadConflict&&onUseSaved&&<RoutineConflict saved={conflict} busy={busy||pending} onReload={onReloadConflict} onUseSaved={onUseSaved} onSaveCopy={onSaveCopy}/>}<fieldset disabled={busy||pending}><div className="routine-basics"><label className="compact-field">{session?'Workout name':'Program name'}<input maxLength={100} value={data.name} onChange={e=>onChange({...data,name:e.target.value})}/></label>{!session&&<label className="compact-field">Sessions / week<select value={data.weeklySessions??''} onChange={e=>onChange({...data,weeklySessions:e.target.value===''?undefined:Number(e.target.value)})}><option value="">Not set</option>{Array.from({length:8},(_,n)=><option key={n} value={n}>{n===0?'0 · outside weekly plan':n}</option>)}</select></label>}</div>
 <div className="routine-editor-grid"><aside><div ref={list} className={`routine-exercise-list routine-sort-list${dragView?' is-reordering':''}`} aria-label={session?'Session exercises':'Program exercises'}>{data.exercises.map((e,i)=><div key={e.id} data-sort-id={e.id} className={`routine-sort-row${exercise?.id===e.id?' is-selected':''}${dragView?.id===e.id?' is-dragging':''}${dragView?.drop?.id===e.id?(dragView.drop.after?' drop-after':' drop-before'):''}`}><button type="button" className="routine-exercise-select" aria-pressed={exercise?.id===e.id} onClick={()=>setExerciseId(e.id)}><span>{i+1}. {e.name||'Untitled exercise'}</span><small>{Number.isFinite(e.sets)?e.sets:'—'} × {Number.isFinite(e.reps)&&Number.isFinite(e.repMax??e.reps)?repTarget(e):'—'}{!exerciseTargets(e)?' · map muscles':''}</small></button><button type="button" className="routine-reorder-grip" disabled={data.exercises.length<2} aria-label={`Reorder ${e.name||'untitled exercise'}`} aria-pressed={dragView?.id===e.id} onPointerDown={event=>beginDrag(event,e.id)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={()=>{if(drag.current?.id===e.id)cancelDrag();}} onClick={event=>event.preventDefault()} onContextMenu={event=>event.preventDefault()}><GripVertical aria-hidden="true"/></button></div>)}</div><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{reorderAnnouncement}</p><label className="compact-field">Add exercise<select value="" disabled={data.exercises.length>=30} onChange={e=>add(e.target.value)}><option value="">Choose from presets…</option><optgroup label="Personal presets">{personal.map(e=><option key={e.name}>{e.name}</option>)}</optgroup><optgroup label="Standard exercises">{exercisePresets.filter(e=>!personal.some(p=>resolveExerciseName(p.name)===resolveExerciseName(e.name))).map(e=><option key={e.name}>{e.name}</option>)}</optgroup></select></label><Button variant="ghost" disabled={data.exercises.length>=30} onClick={()=>add('Custom exercise')}>+ Custom exercise</Button></aside>
 {exercise?<div className="exercise-focus"><label className="compact-field">Exercise name<input maxLength={100} value={exercise.name} onChange={e=>edit({name:e.target.value,muscles:undefined})}/></label><div className="coverage-tabs" role="group" aria-label="Exercise settings"><button aria-pressed={tab==='targets'} onClick={()=>setTab('targets')}>Sets & targets</button><button aria-pressed={tab==='muscles'} onClick={()=>setTab('muscles')}>Muscle groups</button></div>
 {tab==='targets'?<div className="form-grid three">{[['Sets','sets',1,20],['Reps from','reps',1,100],['Reps to','repMax',1,100],['Starting load','load',0,2000],['Rest (seconds)','restSeconds',0,900]].map(([label,key,min,max])=><label className="compact-field" key={exercise.id+key}>{label}<NumericInput min={Number(min)} max={Number(max)} step={key==='load'?.25:1} value={exercise[key as 'sets']??exercise.reps} onValueChange={value=>edit({[key]:value})}/></label>)}<label className="compact-field">Load unit<select value={exercise.unit} onChange={e=>edit({unit:e.target.value as 'lb'|'kg'})}><option>lb</option><option>kg</option></select></label></div>:<><p className="coverage-caption">Primary work counts as direct. Assisting work counts as indirect. Adjust for how you perform the exercise.</p><div className="muscle-assignment">{muscleIds.map(id=><label key={id}>{muscleNames[id]}<select aria-label={muscleNames[id]+' role'} value={targets?.direct.includes(id)?'direct':targets?.indirect.includes(id)?'indirect':'none'} onChange={e=>mapMuscle(id,e.target.value)}><option value="none">Not counted</option><option value="direct">Direct · 1 set</option><option value="indirect">Indirect · ½ set</option></select></label>)}</div></>}
 <div className="action-row"><Button variant="ghost" onClick={()=>onChange({...data,exercises:data.exercises.filter(e=>e.id!==exercise.id)})}>Remove exercise</Button></div></div>:<p>Add an exercise to this program.</p>}</div>
 {!session&&routine.version>0&&<label className="inline-check"><input type="checkbox" checked={data.archived} onChange={e=>onChange({...data,archived:e.target.checked})}/>Archive program, keep its workouts</label>}
 </fieldset></div><footer className="workout-panel-footer">{error&&<p className="error" role="alert">{error}</p>}{pending&&<p className="muted">Save unconfirmed. Retry the same changes.</p>}<div className="action-row"><Button variant="ghost" disabled={busy||pending} onClick={onCancel}>Cancel changes</Button><Button disabled={busy||!data.exercises.length||conflict!==undefined} onClick={onSave}>{busy?'Saving…':pending?'Retry program save':session?'Apply to session':'Save program'}</Button></div></footer></>;
}
