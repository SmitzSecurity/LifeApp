"use client";
import {useEffect,useId,useRef,useCallback,useState,type ReactNode} from 'react';
import {NativeChoices,WorkoutToolVisible,WorkoutCancellation} from './shared';
// Tools stay mounted for saved history, but closing explicitly discards edits. Native selects stay inside the top layer and remain keyboard accessible.
export default function WorkoutPanel({open,title,onClose,children,closeDisabled=false,scrollBody=false}:{open:boolean;title:string;onClose:()=>void;children:ReactNode;closeDisabled?:boolean;scrollBody?:boolean}){
 const discard=useRef(new Map<symbol,{fn:()=>void;blocked:boolean}>()),[childBlocked,setChildBlocked]=useState(false);
 const register=useCallback((fn:()=>void,blocked:boolean)=>{const id=Symbol();discard.current.set(id,{fn,blocked});setChildBlocked([...discard.current.values()].some(child=>child.blocked));return()=>{discard.current.delete(id);setChildBlocked([...discard.current.values()].some(child=>child.blocked));};},[]);
 const blocked=closeDisabled||childBlocked;
 function cancel(){if(blocked)return;for(const child of discard.current.values())child.fn();onClose();}
 const ref=useRef<HTMLDialogElement>(null),id=useId(),returnFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;if(open){returnFocus.current=document.activeElement as HTMLElement;dialog.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=overflow;returnFocus.current?.focus();};}dialog.close();},[open]);
 return <dialog ref={ref} className={`workout-panel${scrollBody?' workout-panel-scroll-body':''}`} aria-labelledby={id} onCancel={e=>{e.preventDefault();cancel();}}><header><h2 id={id}>{title}</h2><button type="button" aria-label={'Close '+title} disabled={blocked} onClick={cancel}>×</button></header><WorkoutCancellation.Provider value={{register,close:cancel}}><NativeChoices.Provider value={true}><WorkoutToolVisible.Provider value={open}>{scrollBody?<div className="workout-panel-body">{children}</div>:children}</WorkoutToolVisible.Provider></NativeChoices.Provider></WorkoutCancellation.Provider></dialog>;
}
