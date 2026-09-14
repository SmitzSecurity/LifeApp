"use client";
import {useEffect,useId,useRef,type ReactNode} from 'react';
import {NativeChoices,WorkoutToolVisible} from './shared';
// Closed native dialogs keep their children mounted, so hiding a tool retains its
// draft. Native selects stay inside the top layer and remain keyboard accessible.
export default function WorkoutPanel({open,title,onClose,children}:{open:boolean;title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),id=useId(),returnFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;if(open){returnFocus.current=document.activeElement as HTMLElement;dialog.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=overflow;returnFocus.current?.focus();};}dialog.close();},[open]);
 return <dialog ref={ref} className="workout-panel" aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}}><header><h2 id={id}>{title}</h2><button type="button" aria-label={'Close '+title} onClick={onClose}>×</button></header><NativeChoices.Provider value={true}><WorkoutToolVisible.Provider value={open}>{children}</WorkoutToolVisible.Provider></NativeChoices.Provider></dialog>;
}
