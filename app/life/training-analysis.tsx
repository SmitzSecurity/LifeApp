"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {request} from './shared';
import AnalysisText from './analysis-text';
import WorkoutPanel from './workout-panel';
type Build={id:string;status:string;createdAt:string;deleted?:boolean;result:{text:string}|null};
export default function TrainingAnalysis({onBusy}:{onBusy:(v:boolean)=>void}){
 const [builds,setBuilds]=useState<Build[]>([]),[busy,setBusy]=useState(false),[available,setAvailable]=useState(false),[pending,setPending]=useState<string|null>(null),[error,setError]=useState(''),[history,setHistory]=useState(false),[reading,setReading]=useState<string|null>(null);
 useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,pending,onBusy]);
 async function refresh(){try{const data=await request('?training-analyses');setBuilds(data.builds);setAvailable(data.available);if(pending&&data.builds.some((b:Build)=>b.id===pending&&b.status!=='generating'))setPending(null);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void refresh();},[]);
 async function generate(){const id=pending||crypto.randomUUID();setPending(id);setBusy(true);setError('');try{const data=await request('',{action:'training-analysis',build:{requestId:id,consent:true}});setBuilds(old=>[data.build,...old.filter(b=>b.id!==data.build.id)]);if(data.build.status!=='generating')setPending(null);}catch(e){setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500))setPending(null);}finally{setBusy(false);}}
 async function remove(b:Build){setBusy(true);setError('');try{await request('',{action:'record-deletion',change:{kind:'build',id:'training:'+b.id,deleted:!b.deleted}});await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const shown=builds.find(b=>!b.deleted&&b.result),unconfirmed=builds.some(b=>b.status==='generating'||b.status==='uncertain');
 const selected=builds.find(b=>b.id===reading&&!b.deleted),preview=shown?.result?.text.split(/\n\s*\n/).find(part=>!part.trim().startsWith('#'))||shown?.result?.text||'';
 return <>
 <section className="analysis-card training-analysis" aria-label="Training analysis">
  <div className="section-heading"><h3>✦ Training analysis</h3><div className="action-row">
   {builds.length>0&&<Button variant="ghost" disabled={busy} onClick={()=>setHistory(true)}>Past weeks</Button>}
   <Button variant="secondary" disabled={busy||!available||(!pending&&unconfirmed)} onClick={()=>void generate()}>{busy?'Analyzing…':pending?'Check this analysis':'Analyze this week'}</Button>
  </div></div>
  {shown?.result?<div className="training-analysis-summary"><div className="training-analysis-preview"><AnalysisText text={preview}/></div><Button variant="ghost" onClick={()=>setReading(shown.id)}>Read analysis →</Button></div>:<p className="muted">A weekly perspective on your training, cardio and muscle coverage.</p>}
  {!shown&&<small className="muted">Analyze with Google Gemini using your training records and Movement goal.</small>}
  {error&&<p className="error" role="alert">{error}</p>}{unconfirmed&&<p className="muted">An AI outcome is unconfirmed. <Button variant="ghost" disabled={busy} onClick={()=>void refresh()}>Refresh status</Button></p>}
 </section>
 <WorkoutPanel open={!!selected} title="Training analysis" onClose={()=>setReading(null)}>{selected?.result&&<div className="training-analysis-reading"><AnalysisText text={selected.result.text}/><Button variant="ghost" disabled={busy} onClick={()=>void remove(selected)}>Delete analysis</Button>{error&&<p role="alert" className="error">{error}</p>}</div>}</WorkoutPanel>
 <WorkoutPanel open={history} title="Training analysis history" onClose={()=>setHistory(false)}><div className="training-analysis-reading">{builds.filter(b=>!b.deleted).map(b=><article key={b.id} className="routine-build-result"><div className="section-heading"><strong>{new Date(b.createdAt).toLocaleDateString()} · {b.deleted?'Trash':b.status}</strong><div className="action-row">{!b.deleted&&b.result&&<Button variant="ghost" onClick={()=>{setHistory(false);setReading(b.id);}}>Read analysis</Button>}<Button variant="ghost" disabled={busy} onClick={()=>void remove(b)}>{b.deleted?'Restore':'Delete'}</Button></div></div></article>)}{error&&<p role="alert" className="error">{error}</p>}</div></WorkoutPanel>
 </>;
}
