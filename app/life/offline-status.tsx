"use client";
import {useEffect,useState,useSyncExternalStore} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {startOfflineSync,getOfflineStatus,getServerOfflineStatus,subscribeOffline,syncOfflineWrites,downloadOfflineChanges,discardRejectedOfflineChanges,type OfflineStatusSnapshot} from '@/lib/life/offline-client';

export function useOfflineSync(accountId:string){
 const state=useSyncExternalStore(subscribeOffline,getOfflineStatus,getServerOfflineStatus);
 useEffect(()=>startOfflineSync(accountId),[accountId]);
 return state;
}
export default function OfflineStatus({state}:{state:OfflineStatusSnapshot}){
 const [review,setReview]=useState(false),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!state.offline&&!state.pending&&!state.message&&state.available)return null;
 const rejected=state.blocked?.status&&![401,402,403].includes(state.blocked.status);
 async function acceptCloud(){setBusy(true);setError('');try{await discardRejectedOfflineChanges();window.location.reload();}catch(reason){setError((reason as Error).message);setBusy(false);}}
 return <><div className="offline-status" role="status" style={{display:'flex',alignItems:'center',gap:8,padding:'4px 12px',flexWrap:'wrap',fontSize:'.875rem',borderBottom:'1px solid var(--border)'}}>
  <span>{state.syncing?'Syncing local saves…':state.blocked?'Local saves need your attention.':state.pending?`${state.pending} ${state.pending===1?'save':'saves'} on this device · waiting for cloud sync.`:state.offline?'Offline · showing data saved on this device.':state.message}</span>
  {state.pending>0&&<Button variant="ghost" onClick={()=>setReview(true)}>Review local saves</Button>}
 </div><Dialog open={review} onOpenChange={open=>{if(!busy){setReview(open);setConfirm(false);}}}><DialogContent><DialogHeader><DialogTitle>Local saves</DialogTitle></DialogHeader>
  <p>{state.pending} {state.pending===1?'save is':'saves are'} stored on this device. Keep this browser’s data until cloud sync finishes. Changes sync in order when you reconnect and open LifeApp.</p>
  {state.message&&<p>{state.message}</p>}{state.blocked&&<p role="alert">{state.blocked.blocked}</p>}
  <p>A conflicting cloud record is never overwritten automatically. Download your local changes before choosing to use cloud data.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:8}}><Button variant="outline" disabled={busy} onClick={()=>void downloadOfflineChanges()}>Download local changes</Button><Button disabled={busy||state.syncing||!!rejected} onClick={()=>void syncOfflineWrites(true)}>Retry sync</Button></div>
  {rejected&&!confirm&&<Button variant="outline" disabled={busy} onClick={()=>setConfirm(true)}>Use cloud data…</Button>}
  {confirm&&<><p role="alert">This removes all {state.pending} pending local saves and reloads LifeApp. Any other unsaved editor changes will also be lost. Keep your download to reapply changes manually.</p><div style={{display:'flex',gap:8}}><Button variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Keep local saves</Button><Button variant="destructive" disabled={busy} onClick={()=>void acceptCloud()}>Remove local saves and reload</Button></div></>}
  {error&&<p role="alert">{error}</p>}
 </DialogContent></Dialog></>;
}
