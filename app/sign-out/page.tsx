'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
export default function SignOut(){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function signOut(){setBusy(true);try{const r=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('Could not sign out. Try again.');window.location.replace('/sign-in');}catch(e){setError((e as Error).message);setBusy(false);}}
 // Auth boundaries use full navigation so the server rechecks the session.
 return <main className="onboarding"><h1>Sign out of LifeApp?</h1><p>Your synced journal will be here when you return.</p><Button disabled={busy} onClick={signOut}>Sign out</Button> <Button variant="ghost" disabled={busy} onClick={()=>window.location.replace('/')}>Stay signed in</Button>{error&&<p role="alert" className="error">{error}</p>}</main>;
}
