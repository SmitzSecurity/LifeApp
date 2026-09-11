"use client";
import {useEffect,useId,useState,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';

export default function BudgetSection({id,title,className='',actions,dirty=false,children}:{id:string;title:string;className?:string;actions?:ReactNode;dirty?:boolean;children:ReactNode}){
 const [open,setOpen]=useState(true),bodyId=useId(),storageKey='lifeapp:budget:section:'+id;
 useEffect(()=>{try{setOpen(localStorage.getItem(storageKey)!=='closed');}catch{}},[storageKey]);
 function toggle(){const next=!open;setOpen(next);try{localStorage.setItem(storageKey,next?'open':'closed');}catch{}}
 return <section className={`budget-section ${className}`} aria-label={title} data-expanded={open}>
  <div className="budget-section-heading"><h3><button className="budget-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}><ChevronDown aria-hidden="true"/><span>{title}</span>{!open&&dirty&&<small>Unsaved changes</small>}</button></h3>{actions}</div>
  <div id={bodyId} className="budget-section-body" hidden={!open}>{children}</div>
 </section>;
}
