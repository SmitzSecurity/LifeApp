'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';

export default function AccountSettings({disabled,onBusy,onDeleted,open:controlledOpen,onOpenChange}:{disabled:boolean;onBusy:(busy:boolean)=>void;onDeleted:()=>void;open?:boolean;onOpenChange?:(open:boolean)=>void}){
 const [localOpen,setLocalOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const open=controlledOpen??localOpen;
 const setOpen=onOpenChange??setLocalOpen;
 useEffect(()=>{if(open){setConfirmation('');setError('');}},[open]);
 async function remove(){
  if(confirmation!=='DELETE'||busy)return;
  setBusy(true);onBusy(true);setError('');
  try{
   const response=await fetch('/api/auth/delete-account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation}),cache:'no-store'});
   const result=await response.json();
   if(!response.ok||result.deleted!==true)throw new Error(result.error||'Deletion could not be confirmed. Try again.');
   onDeleted();
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);onBusy(false);}
 }
 return <>{controlledOpen===undefined&&<Button variant="ghost" disabled={disabled} onClick={()=>setOpen(true)}>Account</Button>}
  <AlertDialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><AlertDialogContent>
   <AlertDialogHeader><AlertDialogTitle>Delete your LifeApp account?</AlertDialogTitle><AlertDialogDescription>This permanently removes your saved check-ins, goals, habits, budget and workout records, AI reports and Google sign-in connection from LifeApp. It signs you out on every device. Your Google account stays yours.</AlertDialogDescription></AlertDialogHeader>
   <p><a href="/api/life?export=1" download>Download my private data backup first</a></p>
   <p className="muted">Unsaved changes in this tab will also be discarded. We retain minimal AI usage records and a retired account ID for spending controls. An AI request already sent may still finish, but its report will not be saved. Provider backups expire on their normal retention schedule.</p>
   <label className="compact-field" htmlFor="delete-confirmation">Type DELETE to confirm<input id="delete-confirmation" autoComplete="off" spellCheck={false} value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>
   {error&&<p className="error" role="alert">{error}</p>}
   <p className="muted">You must have signed in within the last 10 minutes. <a href="/sign-out">Sign out to sign in again</a>, then reopen Account.</p>
   <AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep my account</AlertDialogCancel><Button variant="destructive" disabled={busy||confirmation!=='DELETE'} onClick={remove}>{busy?'Deleting…':'Delete my account'}</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </>;
}
