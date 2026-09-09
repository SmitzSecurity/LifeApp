"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entry } from '@/lib/life/domain';
import { DraftSync, type SyncStatus } from '@/lib/life/draft-sync';
export function useDraftSync(onSaved:(entry:Entry)=>void,autoSave=true){
 const [draft,setDraft]=useState<Entry|null>(null),[status,setStatus]=useState<SyncStatus>('saved'),[syncError,setSyncError]=useState('');
 const writer=useRef<DraftSync|null>(null),onSavedRef=useRef(onSaved),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 onSavedRef.current=onSaved;
 const flush=useCallback(async()=>{if(timer.current)clearTimeout(timer.current);await writer.current?.flush();},[]);
 const discard=useCallback(()=>{if(writer.current?.status==='saving')throw new Error('Wait for the current save to finish.');if(timer.current)clearTimeout(timer.current);writer.current=null;setStatus('saved');setSyncError('');},[]);
 const open=useCallback((entry:Entry)=>{
  if(writer.current?.dirty)throw new Error('Save or discard your changes before opening another day.');
  writer.current=new DraftSync(entry,async(snapshot,mutationId)=>{
   const response=await fetch('/api/life',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'entry',entry:{date:snapshot.date,complete:snapshot.complete||false,journal:snapshot.journal,context:snapshot.context,statuses:snapshot.habits.map(h=>({id:h.id,status:h.status})),version:snapshot.version,mutationId}}),keepalive:true});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not sync your draft.');onSavedRef.current(result.entry);return result.entry;
  },(entry,next,error)=>{setDraft(entry);setStatus(next);setSyncError(error);});
  setDraft(entry);setStatus('saved');setSyncError('');
 },[]);
 const edit=useCallback((entry:Entry)=>{writer.current?.edit({...entry,complete:false});if(timer.current)clearTimeout(timer.current);if(autoSave&&writer.current?.status!=='error')timer.current=setTimeout(()=>{void flush().catch(()=>{});},900);},[flush,autoSave]);
 const commit=useCallback(async(complete:boolean)=>{await writer.current?.commit(complete);},[]);
 const finish=useCallback(async()=>{if(!writer.current)return;await flush();writer.current.edit({...writer.current.entry,complete:true});await flush();},[flush]);
 useEffect(()=>{
  if(!autoSave)return;
  const save=()=>{if(writer.current?.dirty&&writer.current.status!=='error')void flush().catch(()=>{});};
  const hidden=()=>{if(document.visibilityState==='hidden')save();};
  const timer=setInterval(save,5000);window.addEventListener('online',save);document.addEventListener('visibilitychange',hidden);
  return()=>{clearInterval(timer);window.removeEventListener('online',save);document.removeEventListener('visibilitychange',hidden);};
 },[flush,autoSave]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 return {draft,status,syncError,dirty:status!=='saved',open,edit,flush,finish,commit,discard};
}
