"use client";
import {useCallback,useId,useSyncExternalStore,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';

const sectionPreferenceEvent='lifeapp:budget:section-change';
const sectionFallback=new Map<string,boolean>();
const serverExpanded=()=>true;
export default function BudgetSection({id,title,className='',actions,dirty=false,children}:{id:string;title:string;className?:string;actions?:ReactNode;dirty?:boolean;children:ReactNode}){
 const bodyId=useId(),storageKey='lifeapp:budget:section:'+id;
 const subscribe=useCallback((notify:()=>void)=>{
  const onStorage=(event:StorageEvent)=>{if(event.key===storageKey||event.key===null){sectionFallback.delete(storageKey);notify();}};
  window.addEventListener('storage',onStorage);window.addEventListener(sectionPreferenceEvent,notify);
  return()=>{window.removeEventListener('storage',onStorage);window.removeEventListener(sectionPreferenceEvent,notify);};
 },[storageKey]);
 const snapshot=useCallback(()=>{const fallback=sectionFallback.get(storageKey);if(fallback!==undefined)return fallback;try{return localStorage.getItem(storageKey)!=='closed';}catch{return true;}},[storageKey]);
 const open=useSyncExternalStore(subscribe,snapshot,serverExpanded);
 function toggle(){const next=!open;try{localStorage.setItem(storageKey,next?'open':'closed');sectionFallback.delete(storageKey);}catch{sectionFallback.set(storageKey,next);}window.dispatchEvent(new Event(sectionPreferenceEvent));}
 return <section className={`budget-section ${className}`} aria-label={title} data-expanded={open}>
  <div className="budget-section-heading"><h3><button className="budget-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}><ChevronDown aria-hidden="true"/><span>{title}</span>{!open&&dirty&&<small>Unsaved changes</small>}</button></h3>{actions}</div>
  <div id={bodyId} className="budget-section-body" hidden={!open}>{children}</div>
 </section>;
}
