"use client";
import { useEffect,useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Entry } from '@/lib/life/domain';
import type { DailyJobStatus } from '@/lib/life/scheduler';
import { request } from './shared';
import AIUsageReceipt, { type AIUsageReceiptData } from './ai-usage-receipt';
type Report=AIUsageReceiptData&{id:string;date:string;revision:number;sourceVersion:number;status:string;text:string|null;critique:string;model:string;createdAt:string;errorCode:string|null};
type State={automaticExecutionEnabled:boolean;available:boolean;reports:Report[];schedule:DailyJobStatus|null;usage:{allocatedMicros:number;measuredMicros:number;capMicros:number}};
const scheduleMessage:Record<DailyJobStatus['state'],string>={
 missing:'This scheduled day is waiting for a check-in. No analysis has run.',
 incomplete:'This scheduled day is on hold until you finish and sync the check-in.',
 ready:'This scheduled day is complete and eligible. Automatic analysis requires your separate opt-in in My setup; you can also request its review below.',
 disabled:'Scheduled daily reviews are turned off in your saved preferences.',
 'already-generated':'This day already has an original review. The schedule will not replace it.',
 attention:'A review attempt already exists. Its result or usage needs confirmation; the schedule will not retry it.'
};
const dollars=(micros:number)=>'$'+(micros/1000000).toFixed(4);
export default function AIReview({entry,synced,onBusy}:{entry:Entry;synced:boolean;onBusy:(v:boolean)=>void}){
 const [data,setData]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[critique,setCritique]=useState(''),[requestId,setRequestId]=useState('');
 async function refresh(){try{setData(await request('?ai=1&date='+entry.date));}catch(e){setError((e as Error).message);}}
 useEffect(()=>{setData(null);setConsent(false);setCritique('');setError('');setRequestId(crypto.randomUUID());},[entry.date]);
 useEffect(()=>{if(synced)void refresh();},[entry.version,synced]);
 useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,onBusy]);
 const reports=[...(data?.reports||[])].sort((a,b)=>b.revision-a.revision),latest=reports[0];
 async function generate(){if(!consent)return;setBusy(true);setError('');try{await request('',{action:'ai',review:{date:entry.date,requestId,sourceVersion:entry.version,predecessorId:latest?.id||null,critique:latest?critique:'',consent:true}});setRequestId(crypto.randomUUID());setCritique('');}catch(e){setError((e as Error).message);}finally{await refresh();setBusy(false);}}
 const unfinished=latest&&latest.status!=='complete';
 return <section className="module-card ai-review-card"><div className="section-heading"><div><div className="eyebrow">DAILY AI REVIEW</div><h3>{entry.date}</h3></div><Button variant="ghost" disabled={busy} onClick={refresh}>Refresh status</Button></div>
 {error&&<p className="error" role="alert">{error}</p>}{!data?<p className="muted">Checking the AI connection…</p>:<>
 {!data.available&&<p className="notice">The AI connection is awaiting activation by the LifeApp owner. Your journal continues to work.</p>}
 {data.schedule&&<p className="completion-help" role="status">{scheduleMessage[data.schedule.state]}</p>}
 <p className="muted">AI uses this completed check-in, your saved goals and feedback preferences, and relevant enabled budget/workout records. Google Gemini processes that context for each review you authorize.</p>
 {!entry.complete||!synced?<p className="completion-help">Finish and sync this check-in to make it eligible for analysis.</p>:null}
 {latest&&latest.sourceVersion!==entry.version&&<p className="completion-help">This entry changed after the latest review. The saved review is preserved; request a revision to include your changes.</p>}
 {latest?.status==='generating'&&<p className="notice">This review is being generated, or its completion is not yet confirmed. Refresh its status; a second copy will not start automatically.</p>}
 {unfinished&&latest.status!=='generating'&&<p className="completion-help">The last attempt did not produce a confirmed complete report. Its usage reservation is retained where cost is unknown. Automatic retries are disabled.</p>}
 {(!latest||latest.status==='complete')&&<>{latest&&<label className="compact-field">What should the revision change?<textarea rows={2} maxLength={1000} value={critique} onChange={e=>setCritique(e.target.value)} placeholder="What was missed, unhelpful or worth exploring?"/><small>The original review stays in your history.</small></label>}<label className="inline-check"><Checkbox checked={consent} onCheckedChange={v=>setConsent(!!v)}/>Use this saved context for AI analysis</label><Button disabled={busy||!data.available||!entry.complete||!synced||!consent||!!latest&&!critique.trim()} onClick={generate}>{busy?'Generating…':latest?'Generate revised review':'Generate this day’s review'}</Button></>}
 <div className="ai-usage"><small>Provider usage this month: {dollars(data.usage.measuredMicros)} measured · {dollars(Math.max(0,data.usage.allocatedMicros-data.usage.measuredMicros))} reserved · ${data.usage.capMicros/1000000} beta limit</small><small>Up to $0.20 is reserved per attempt. No customer payment is collected. {data.automaticExecutionEnabled?'Automatic daily reviews require your opt-in in My setup.':'Automatic daily reviews are awaiting activation.'} Email and local-event search are not active.</small></div>
 {reports.map(report=><article className="saved-ai-review" key={report.id}><div><strong>Review {report.revision} · {report.status}</strong><small>{new Date(report.createdAt).toLocaleString()} · {report.model}{report.costMicros!==null?' · '+dollars(report.costMicros):''}</small></div><AIUsageReceipt usage={report}/>{report.critique&&<p className="goal-reminder">Revision request: {report.critique}</p>}{report.text&&<div className="ai-report-text">{report.text}</div>}</article>)}
 </>}</section>;
}
