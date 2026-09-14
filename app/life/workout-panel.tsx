"use client";
import {useEffect,useId,useRef,useCallback,useState,type ReactNode} from 'react';
import {NativeChoices,WorkoutToolVisible,WorkoutCancellation} from './shared';
// Tools stay mounted for saved history, but closing explicitly discards edits. Native selects stay inside the top layer and remain keyboard accessible.
export default function WorkoutPanel({open,title,onClose,children,closeDisabled=false}:{open:boolean;title:string;onClose:()=>void;children:ReactNode;closeDisabled?:boolean}){
 const discard=useRef<(()=>void)|null>(null),[childBlocked,setChildBlocked]=useState(false);
 const register=useCallback((fn:()=>void,blocked:boolean)=>{discard.current=fn;setChildBlocked(blocked);return()=>{discard.current=null;setChildBlocked(false);};},[]);
 const blocked=closeDisabled||childBlocked;
 function cancel(){if(blocked)return;discard.current?.();onClose();}
 const ref=useRef<HTMLDialogElement>(null),id=useId(),returnFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;if(open){returnFocus.current=document.activeElement as HTMLElement;dialog.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=overflow;returnFocus.current?.focus();};}dialog.close();},[open]);
 return <dialog ref={ref} className="workout-panel" aria-labelledby={id} onCancel={e=>{e.preventDefault();cancel();}}><header><h2 id={id}>{title}</h2><button type="button" aria-label={'Close '+title} disabled={blocked} onClick={cancel}>×</button></header><WorkoutCancellation.Provider value={{register,close:cancel}}><NativeChoices.Provider value={true}><WorkoutToolVisible.Provider value={open}>{children}</WorkoutToolVisible.Provider></NativeChoices.Provider></WorkoutCancellation.Provider></dialog>;
}
