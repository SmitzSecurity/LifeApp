"use client";
import {useEffect,useState} from 'react';
import {MessageSquare,RotateCw,LoaderCircle,ArrowUpRight,History} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter} from '@/components/ui/alert-dialog';
import type {Entry,Profile} from '@/lib/life/domain';
import type {Cadence} from '@/lib/life/reviews';
import {request} from './shared';
export type AnalysisReport={id:string;date:string;cadence:Cadence;from:string;revision:number;sourceVersion:number;status:string;text:string|null};
type State={available:boolean;reports:AnalysisReport[];regenerationsRemaining:number};
type Props={entry?:Entry|null;date?:string;cadence?:Cadence;profile:Profile;synced:boolean;heading?:string;onBusy:(busy:boolean)=>void;onProfileSaved:(profile:Profile)=>void;onSettings:()=>void;onGenerated?:()=>void};
export default function AIReview({entry,date,cadence='daily',profile,synced,heading='Analysis',onBusy,onProfileSaved,onSettings,onGenerated}:Props){
 const targetDate=date||entry!.date;
 const [data,setData]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[feedbackOpen,setFeedbackOpen]=useState(false),[feedback,setFeedback]=useState(''),[feedbackId,setFeedbackId]=useState(''),[requestId,setRequestId]=useState(''),[notice,setNotice]=useState(''),[historyOpen,setHistoryOpen]=useState(false);
 async function refresh(){try{setData(await request('?ai=1&date='+targetDate+'&cadence='+cadence));}catch{setError('Analysis could not be loaded. Try refreshing.');}}
 useEffect(()=>{setData(null);setError('');setNotice('');setFeedback('');setFeedbackOpen(false);setRequestId(crypto.randomUUID());setHistoryOpen(false);void refresh();},[targetDate,cadence]);
 useEffect(()=>{if(synced)void refresh();},[entry?.version,synced]);
 useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,onBusy]);
 const reports=[...(data?.reports||[])].sort((a,b)=>b.revision-a.revision),latest=reports[0],shown=reports.find(r=>r.status==='complete'),unconfirmed=!!latest&&latest.status!=='complete';
 const ready=cadence!=='daily'||!!entry?.complete;
 const canGenerate=!!data?.available&&synced&&ready&&!unconfirmed&&!busy&&(!latest||data.regenerationsRemaining>0);
 async function runGeneration(nextProfile:Profile,critique=''){
  await request('',{action:'ai',review:{cadence,date:targetDate,requestId,sourceVersion:cadence==='daily'?entry!.version:nextProfile.version,predecessorId:latest?.id||null,critique,consent:true}});
  setRequestId(crypto.randomUUID());onGenerated?.();await refresh();
 }
 async function generate(){setBusy(true);setError('');setNotice('');try{await runGeneration(profile);}catch(e){setError((e as Error).message);await refresh();}finally{setBusy(false);}}
 function openFeedback(){setFeedbackId(crypto.randomUUID());setFeedback('');setFeedbackOpen(true);setError('');}
 async function saveFeedback(regenerate:boolean){
  if(!shown||!feedback.trim())return;setBusy(true);setError('');
  try{
   const result=await request('',{action:'analysis-feedback',feedback:{id:feedbackId,text:feedback,reportId:shown.id,date:targetDate,cadence,profileVersion:profile.version}});
   onProfileSaved(result.profile);setNotice('Feedback saved for future analyses.');
   if(regenerate)await runGeneration(result.profile,feedback);
   setFeedback('');setFeedbackOpen(false);
  }catch(e){setError((e as Error).message);if(regenerate)await refresh();}finally{setBusy(false);}
 }
 return <section className="analysis-card" aria-label={heading}>
  <div className="analysis-heading"><h2>{heading}</h2><Button variant="ghost" size="icon" aria-label="Refresh analysis" disabled={busy} onClick={()=>{setError('');void refresh();}}><RotateCw/></Button></div>
  {!data&&!error&&<p className="muted">Opening analysis…</p>}
  {shown?.text?<div className="analysis-copy">{shown.text}</div>:data&&<p className="analysis-empty">{unconfirmed?'The analysis is not ready yet.':cadence==='daily'?ready?'Your analysis is ready to generate.':`Your next analysis appears here after a complete journal entry is saved. Daily analysis runs around ${profile.reviewPreferences.daily.time}.`:'No analysis has been generated for this period yet.'}</p>}
  {busy&&<p className="analysis-progress" role="status"><LoaderCircle className="spin"/>Preparing your analysis…</p>}
  {unconfirmed&&!busy&&<p className="analysis-note">{latest.status==='generating'?'Analysis is in progress. Check its status in a moment.':'This analysis could not be confirmed. Your journal and earlier analyses are safe.'}</p>}
  {error&&!feedbackOpen&&<p className="error" role="alert">{error}</p>}
  {notice&&!feedbackOpen&&<p className="analysis-note" role="status">{notice}</p>}
  {data&&<div className="analysis-tools">
   {shown&&<Button variant="ghost" disabled={busy||!synced} onClick={openFeedback}><MessageSquare/>Feedback</Button>}
   {!unconfirmed&&<Button variant={shown?'ghost':'default'} disabled={!canGenerate} onClick={generate}>{shown?<RotateCw/>:null}{shown?'Regenerate':'Generate analysis'}</Button>}
   {reports.filter(r=>r.status==='complete').length>1&&<Button variant="ghost" disabled={busy} onClick={()=>setHistoryOpen(v=>!v)}><History/>Earlier versions</Button>}
  </div>}
  {data&&!latest&&ready&&<p className="analysis-note">Uses your saved journal and preferences with Google Gemini.</p>}
  {shown&&!ready&&<p className="analysis-note">Save a complete entry to regenerate its analysis.</p>}
  {!!latest&&data?.regenerationsRemaining===0&&<p className="analysis-note">Regeneration limit reached for today. You can still save feedback.</p>}
  {historyOpen&&<div className="analysis-versions">{reports.filter(r=>r.status==='complete'&&r.id!==shown?.id).map(r=><article key={r.id}><h3>Earlier version {r.revision}</h3><div className="analysis-copy">{r.text}</div></article>)}</div>}
  <AlertDialog open={feedbackOpen} onOpenChange={open=>{if(!busy&&(open||!feedback.trim()))setFeedbackOpen(open);}}><AlertDialogContent className="feedback-dialog"><AlertDialogHeader><AlertDialogTitle>Guide your analysis</AlertDialogTitle><AlertDialogDescription>What should LifeApp understand or do differently? Your feedback is saved for future analyses.</AlertDialogDescription></AlertDialogHeader>
   <label className="compact-field" htmlFor="analysis-feedback">Your feedback<textarea id="analysis-feedback" rows={4} maxLength={500} value={feedback} disabled={busy} onChange={e=>{setFeedback(e.target.value);setFeedbackId(crypto.randomUUID());}} placeholder="For example: focus on consistency, and keep suggestions practical."/></label>
   <button className="guidance-link" disabled={busy} onClick={()=>{setFeedback('');setFeedbackOpen(false);onSettings();}}>Manage saved guidance in Settings <ArrowUpRight/></button>
   {notice&&<p role="status" className="analysis-note">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
   <AlertDialogFooter><Button variant="ghost" disabled={busy} onClick={()=>{setFeedback('');setFeedbackOpen(false);}}>Cancel</Button><Button variant="outline" disabled={busy||!feedback.trim()} onClick={()=>saveFeedback(false)}>Save for future</Button><Button disabled={!canGenerate||!feedback.trim()} onClick={()=>saveFeedback(true)}>Save & regenerate</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </section>;
}
