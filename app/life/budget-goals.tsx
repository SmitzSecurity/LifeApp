"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import type {Profile} from '@/lib/life/domain';
import type {Budget} from '@/lib/life/modules';
import {request,useUnsaved} from './shared';

export function BudgetGoalFields({value,onChange}:{value:Budget['goals'];onChange:(goals:Budget['goals'])=>void}){
 return <>{(['spending','saving','investing'] as const).map(key=><label className="compact-field" key={key}>{key[0].toUpperCase()+key.slice(1)} goal<textarea rows={2} maxLength={1000} value={value[key]} onChange={e=>onChange({...value,[key]:e.target.value})}/></label>)}</>;
}

export default function BudgetGoals({profile,fallback,onProfileSaved,onDirty,disabled}:{profile:Profile;fallback:Budget['goals'];onProfileSaved:(p:Profile)=>void;onDirty:(v:boolean)=>void;disabled:boolean}){
 const [open,setOpen]=useState(false),[base,setBase]=useState(profile),[goals,setGoals]=useState(profile.budgetGoals||fallback),[initial,setInitial]=useState(goals),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const dirty=JSON.stringify(goals)!==JSON.stringify(initial);
 useUnsaved(open&&(dirty||busy),onDirty);
 function show(){const value=profile.budgetGoals||fallback;setBase(profile);setGoals(value);setInitial(value);setError('');setSaved(false);setOpen(true);}
 function finish(p:Profile){onProfileSaved(p);setInitial(goals);setOpen(false);setSaved(true);}
 async function save(){
  setBusy(true);setError('');
  try{finish((await request('',{action:'profile',profile:{...base,budgetGoals:goals}})).profile);}
  catch(e){
   // Reconcile a lost response or a concurrent Settings save before retrying.
   // Keep the user's draft while preserving the latest unrelated preferences.
   try{const latest=(await request('')).profile as Profile|null;
    if(latest&&JSON.stringify(latest.budgetGoals)===JSON.stringify(goals)){finish(latest);return;}
    if(latest){setBase(latest);onProfileSaved(latest);}
    setError((e as {status?:number}).status===409?'Settings changed in another session. Your goals are still here; check them and save again.':(e as Error).message);
   }catch{setError('Save could not be confirmed. Your goals are still here. Try saving again when connected.');}
  }finally{setBusy(false);}
 }
 return <><span className="budget-goals-link"><button disabled={disabled} onClick={show}>Budget goals</button>{saved&&<small role="status">Saved in Settings</small>}</span>
 <Dialog open={open} onOpenChange={value=>{if(!busy&&!dirty)setOpen(value);}}><DialogContent className="budget-goals-dialog" showCloseButton={!dirty&&!busy} onInteractOutside={e=>e.preventDefault()}>
  <DialogHeader><DialogTitle>Budget goals</DialogTitle><DialogDescription>Guide your analyses. Changes also appear in Settings.</DialogDescription></DialogHeader>
  <fieldset disabled={busy}><BudgetGoalFields value={goals} onChange={setGoals}/></fieldset>
  {error&&<p role="alert" className="error">{error}</p>}
  <DialogFooter><Button variant="ghost" disabled={busy} onClick={()=>{setOpen(false);setGoals(initial);}}>Cancel</Button><Button disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save goals'}</Button></DialogFooter>
 </DialogContent></Dialog></>;
}
