"use client";
import {formatTimestampDate} from '@/lib/life/date-display';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {ArrowUpRight,History} from 'lucide-react';
import {request} from './shared';
import AnalysisText from './analysis-text';
import WorkoutPanel from './workout-panel';
import {useAIStatus} from './use-ai-status';
type Build={id:string;status:string;createdAt:string;deleted?:boolean;result:{text:string}|null};
type State={builds:Build[];available:boolean};
export default function TrainingAnalysis({onBusy}:{onBusy:(v:boolean)=>void}){
 const [builds,setBuilds]=useState<Build[]>([]),[busy,setBusy]=useState(false),[generating,setGenerating]=useState(false),[dismissed,setDismissed]=useState(false),[available,setAvailable]=useState(false),[pending,setPending]=useState<string|null>(null),[error,setError]=useState(''),[history,setHistory]=useState(false),[reading,setReading]=useState<string|null>(null);
 const [deletePending,setDeletePending]=useState<Build|null>(null),mounted=useRef(false),generation=useRef({epoch:0,id:null as string|null});
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const status=useAIStatus<State>({load:()=>request('?training-analyses&summary=1'),active:!!pending,shouldPoll:data=>data.builds.some(b=>b.status==='generating'),onData:data=>{setBuilds(data.builds);setAvailable(data.available);if(generation.current.id&&data.builds.some(b=>b.id===generation.current.id&&b.status!=='generating')){if(data.builds.some(b=>b.id===generation.current.id&&b.status==='complete'))setError('');generation.current={epoch:generation.current.epoch+1,id:null};setGenerating(false);}setPending(current=>current&&data.builds.some(b=>b.id===current&&b.status!=='generating')?null:current);setDeletePending(current=>current&&data.builds.some(b=>b.id===current.id&&!!b.deleted===!current.deleted)?null:current);}});
 useEffect(()=>{onBusy(busy||!!deletePending||(generating&&!dismissed));return()=>onBusy(false);},[busy,deletePending,generating,dismissed,onBusy]);
 async function generate(){const id=pending||crypto.randomUUID(),ticket=generation.current.epoch+1;generation.current={epoch:ticket,id};const current=()=>mounted.current&&generation.current.epoch===ticket;setPending(id);setGenerating(true);setDismissed(false);setError('');try{const data=await request('',{action:'training-analysis',build:{requestId:id,consent:true}});if(!current())return;setBuilds(old=>[data.build,...old.filter(b=>b.id!==data.build.id)]);if(data.build.status!=='generating')setPending(null);await status.check();}catch(e){if(!current())return;setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500)){setPending(null);generation.current.id=null;}await status.check();}finally{if(current())setGenerating(false);}}
 function cancelWait(){setDismissed(true);}
 async function remove(b:Build){const target=deletePending||b;setDeletePending(target);setBusy(true);setError('');try{await request('',{action:'record-deletion',change:{kind:'build',id:'training:'+target.id,deleted:!target.deleted}});if(!mounted.current)return;setDeletePending(null);await status.check();}catch(e){if(!mounted.current)return;setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500))setDeletePending(null);await status.check();}finally{if(mounted.current)setBusy(false);}}
 const shown=builds.find(b=>!b.deleted&&b.result),unconfirmed=builds.some(b=>b.status==='generating'||b.status==='uncertain');
 const selected=builds.find(b=>b.id===reading&&!b.deleted),preview=shown?.result?.text.split(/\n\s*\n/).find(part=>!part.trim().startsWith('#'))||shown?.result?.text||'';
 const canRetry=status.delayed&&!!pending&&!generating&&!builds.some(b=>b.id===pending);
 return <>
 <section className="analysis-card training-analysis" aria-label="Training analysis">
  <div className={"section-heading"+(!dismissed&&(generating||!!pending||builds.some(b=>b.status==='generating'))?' is-generating':'')}><h3>Training analysis</h3><div className="training-analysis-actions">
   <Button variant="ghost" aria-label={canRetry?'Retry this analysis':'Analyze this week'} disabled={busy||!!deletePending||generating||(!canRetry&&(!!pending||!available||unconfirmed))} onClick={()=>void generate()}>{canRetry?'Retry analysis':!dismissed&&(generating||!!pending)?'Analyzing…':'Analyze'}</Button>
   {!dismissed&&(generating||!!pending||builds.some(b=>b.status==='generating'))&&<Button variant="ghost" disabled={busy} onClick={cancelWait}>Cancel</Button>}
   {builds.length>0&&<Button variant="ghost" size="icon" aria-label="Past training analyses" title="Past weeks" disabled={busy} onClick={()=>setHistory(true)}><History aria-hidden="true"/></Button>}
  </div></div>
  {shown?.result&&<div className="training-analysis-summary"><div className="training-analysis-preview"><AnalysisText text={preview}/></div><Button variant="ghost" size="icon" aria-label="Read latest training analysis" title="Read analysis" onClick={()=>setReading(shown.id)}><ArrowUpRight aria-hidden="true"/></Button></div>}
  <small className="training-analysis-disclosure">Uses your training records and Movement goal with Google Gemini.</small>
  {(error||status.error)&&<p className="error" role="alert">{error||status.error}</p>}
  {dismissed&&(generating||pending||builds.some(b=>b.status==='generating'))?<p className="muted" role="status">You can continue using LifeApp. The analysis may still finish in the background.</p>:status.delayed&&(pending||builds.some(b=>b.status==='generating'))?<p className="muted" role="status">This is taking longer than usual. You can leave this page; a completed analysis will appear when you return.</p>:!dismissed&&builds.some(b=>b.status==='generating')&&<p className="muted" role="status">Preparing your analysis…</p>}
  {builds.some(b=>b.status==='uncertain')&&<p className="muted">The analysis could not be confirmed. It will not be generated again automatically.</p>}
 </section>
 <WorkoutPanel open={!!selected} title="Training analysis" onClose={()=>setReading(null)} closeDisabled={busy||!!deletePending}>{selected?.result&&<div className="training-analysis-reading"><AnalysisText text={selected.result.text}/><Button variant="ghost" disabled={busy||!!deletePending&&deletePending.id!==selected.id} onClick={()=>void remove(selected)}>{deletePending?'Retry delete':'Delete analysis'}</Button>{error&&<p role="alert" className="error">{error}</p>}</div>}</WorkoutPanel>
 <WorkoutPanel open={history} title="Training analysis history" onClose={()=>setHistory(false)} closeDisabled={busy||!!deletePending}><div className="training-analysis-reading">{builds.filter(b=>!b.deleted).map(b=><article key={b.id} className="routine-build-result"><div className="section-heading"><strong>{formatTimestampDate(b.createdAt)} · {b.deleted?'Trash':b.status}</strong><div className="action-row">{!b.deleted&&b.result&&<Button variant="ghost" disabled={busy||!!deletePending} onClick={()=>{setHistory(false);setReading(b.id);}}>Read analysis</Button>}<Button variant="ghost" disabled={busy||!!deletePending&&deletePending.id!==b.id} onClick={()=>void remove(b)}>{deletePending?.id===b.id?'Retry delete':b.deleted?'Restore':'Delete'}</Button></div></div></article>)}{error&&<p role="alert" className="error">{error}</p>}</div></WorkoutPanel>
 </>;
}
