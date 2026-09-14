"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {request} from './shared';
import AnalysisText from './analysis-text';
type Build={id:string;status:string;createdAt:string;deleted?:boolean;result:{text:string}|null};
export default function TrainingAnalysis({onBusy}:{onBusy:(v:boolean)=>void}){
 const [builds,setBuilds]=useState<Build[]>([]),[busy,setBusy]=useState(false),[available,setAvailable]=useState(false),[pending,setPending]=useState<string|null>(null),[error,setError]=useState(''),[history,setHistory]=useState(false);
 useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,pending,onBusy]);
 async function refresh(){try{const data=await request('?training-analyses');setBuilds(data.builds);setAvailable(data.available);if(pending&&data.builds.some((b:Build)=>b.id===pending&&b.status!=='generating'))setPending(null);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void refresh();},[]);
 async function generate(){const id=pending||crypto.randomUUID();setPending(id);setBusy(true);setError('');try{const data=await request('',{action:'training-analysis',build:{requestId:id,consent:true}});setBuilds(old=>[data.build,...old.filter(b=>b.id!==data.build.id)]);if(data.build.status!=='generating')setPending(null);}catch(e){setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500))setPending(null);}finally{setBusy(false);}}
 async function remove(b:Build){setBusy(true);setError('');try{await request('',{action:'record-deletion',change:{kind:'build',id:'training:'+b.id,deleted:!b.deleted}});await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const shown=builds.find(b=>!b.deleted&&b.result),unconfirmed=builds.some(b=>b.status==='generating'||b.status==='uncertain');
 return <section className="analysis-card training-analysis" aria-label="Training analysis"><div className="section-heading"><h3>✦ Training analysis</h3><div className="action-row"><Button variant="ghost" disabled={busy} onClick={()=>void refresh()}>Refresh</Button>{builds.length>0&&<Button variant="ghost" disabled={busy} onClick={()=>setHistory(v=>!v)} aria-expanded={history}>History & Trash</Button>}</div></div>{shown?.result?<><AnalysisText text={shown.result.text}/><Button variant="ghost" disabled={busy} onClick={()=>void remove(shown)}>Delete analysis</Button></>:<p className="muted">A weekly perspective on your logged training, cardio and muscle coverage.</p>}
 <div className="action-row"><Button disabled={busy||!available||(!pending&&unconfirmed)} onClick={()=>void generate()}>{busy?'Analyzing…':pending?'Check this analysis':'Analyze this week'}</Button><small>Uses your training records and Movement goal with Google Gemini.</small></div>{error&&<p className="error" role="alert">{error}</p>}{unconfirmed&&<p className="muted">An AI outcome is unconfirmed. Refresh status before starting another request.</p>}
 {history&&<div>{builds.map(b=><article key={b.id} className="routine-build-result"><div className="section-heading"><strong>{new Date(b.createdAt).toLocaleDateString()} · {b.deleted?'Trash':b.status}</strong><Button variant="ghost" disabled={busy} onClick={()=>void remove(b)}>{b.deleted?'Restore':'Delete'}</Button></div>{!b.deleted&&b.result&&<AnalysisText text={b.result.text}/>}</article>)}</div>}</section>;
}
