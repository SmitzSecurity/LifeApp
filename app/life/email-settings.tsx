"use client";
import {useEffect,useState} from 'react';
import {Mail} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import type {EmailConsent} from '@/lib/life/email-service';
import {request} from './shared';
type Delivery={reportId:string;date:string;revision:number;state:string;attempts:number;finishedAt:string|null};
type State={consent:EmailConsent;available:boolean;sender:string|null;deliveries:Delivery[]};
const labels:Record<string,string>={pending:'Waiting to send',sending:'Sending',sent:'Accepted by email service',retry:'Will retry delivery',failed:'Delivery needs attention',uncertain:'Delivery not confirmed',cancelled:'Cancelled'};
export default function EmailSettings(){
 const [data,setData]=useState<State|null>(null),[agreed,setAgreed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function refresh(){try{setData(await request('/email'));setError('');}catch{setError('Email settings could not be loaded. Try again to check your saved choice.');}}
 useEffect(()=>{void refresh();},[]);
 async function save(enabled:boolean){
  if(!data||enabled&&!agreed)return;setBusy(true);setError('');
  try{setData(await request('/email',{enabled,version:data.consent.version,policyVersion:data.consent.policyVersion}));setAgreed(false);}
  catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 }
 return <section className="review-settings email-settings"><div className="section-heading"><div><div className="eyebrow">YOUR REPORT, IN YOUR INBOX</div><h3><Mail size={18}/> Email reports</h3></div><Button variant="ghost" disabled={busy} onClick={refresh}>Refresh email status</Button></div>
  <p className="muted">Get the full text of new completed reviews at your verified Google account email. Email copies can include personal details from your check-in and enabled sections.</p>
  {error&&<p role="alert" className="error">{error}</p>}
  {data&&<><p className="email-destination">To <strong>{data.consent.recipient||'your verified Google email'}</strong>{data.sender&&<small>From {data.sender}</small>}</p><p role="status" className="completion-help">{data.consent.enabled?'Full-report emails are on.':'Full-report emails are off.'}{!data.available?' Sending is awaiting activation.':''}</p>
   {data.consent.enabled?<Button variant="outline" disabled={busy} onClick={()=>save(false)}>{busy?'Saving…':'Turn off report emails'}</Button>:<><label className="inline-check"><Checkbox checked={agreed} disabled={busy||!data.available||!data.consent.recipient} onCheckedChange={v=>setAgreed(v===true)}/>I agree to email copies of my full reports, including personal details they contain.</label><Button disabled={busy||!agreed||!data.available||!data.consent.recipient} onClick={()=>save(true)}>{busy?'Saving…':'Turn on report emails'}</Button></>}
   <small className="email-help">This saves separately from setup and automatic analysis. It applies to newly completed reports; older reports are not sent. Every email includes an unsubscribe link. Turning this off stops new deliveries; an email already being sent may still arrive. Copies already in your inbox are outside LifeApp.</small>
   {data.deliveries.length>0&&<details className="quiet-details"><summary>Recent email activity <span>Delivery status is separate from AI usage</span></summary>{data.deliveries.map(d=><div className="email-delivery" key={d.reportId}><span>{d.date} · Review {d.revision}</span><strong>{labels[d.state]||'Check status'}</strong></div>)}<p className="completion-help">“Accepted” means the email service accepted the message, not that it reached your inbox. Unconfirmed deliveries are not repeated automatically, to avoid duplicate emails.</p></details>}
  </>}
 </section>;
}
