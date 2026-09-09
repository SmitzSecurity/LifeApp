"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {request} from './shared';
type State={available:boolean;consent:{enabled:boolean;version:number;policyVersion:string;startDate:string|null}};
export default function PeriodicSettings({setupDirty}:{setupDirty:boolean}){
 const [data,setData]=useState<State|null>(null),[agreed,setAgreed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){try{setData(await request('?periodic=1'));}catch{setError('Could not load your automatic analysis choice.');}}
 useEffect(()=>{void load();},[]);
 async function save(enabled:boolean){if(!data||enabled&&!agreed)return;setBusy(true);setError('');try{setData(await request('',{action:'period-consent',consent:{enabled,version:data.consent.version,policyVersion:data.consent.policyVersion}}));setAgreed(false);}catch(e){setError((e as Error).message);await load();}finally{setBusy(false);}}
 return <section className="review-settings"><h3>Automatic weekly, monthly & annual analysis</h3><p className="muted">Send completed journals, saved guidance and activity to Google Gemini after each calendar period ends, using your selected schedule. Earlier analyses help connect the bigger picture.</p>
 {error&&<p role="alert" className="error">{error}</p>}{!data?<Button onClick={load}>Refresh choice</Button>:<><p role="status">{data.consent.enabled?'Automatic period analysis is on.':'Automatic period analysis is off.'}</p>{setupDirty&&<small>Save Settings before enabling this.</small>}{data.consent.enabled?<Button variant="outline" disabled={busy} onClick={()=>save(false)}>Turn off period analysis</Button>:<><label className="inline-check"><input type="checkbox" checked={agreed} disabled={busy||setupDirty||!data.available} onChange={e=>setAgreed(e.target.checked)}/>I agree to automatic weekly, monthly and annual analysis of my saved context.</label><Button disabled={busy||setupDirty||!data.available||!agreed} onClick={()=>save(true)}>Turn on period analysis</Button></>}<small>This choice saves separately. Earlier closed periods are not generated automatically. Email delivery has its own opt-in.</small></>}
 </section>;
}
