"use client";
import {useEffect,useRef,useState} from 'react';
import {MessageSquare,RotateCw,LoaderCircle,ArrowUpRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter} from '@/components/ui/alert-dialog';
import type {Entry,Profile} from '@/lib/life/domain';
import type {Cadence} from '@/lib/life/reviews';
import {request} from './shared';
import AnalysisText from './analysis-text';
import {useAIStatus} from './use-ai-status';
export type AnalysisReport={deleted?:boolean;id:string;date:string;cadence:Cadence;from:string;revision:number;sourceVersion:number;status:string;text:string|null};
type State={available:boolean;reports:AnalysisReport[];regenerationsRemaining:number};
type FeedbackWrite={id:string;text:string;reportId:string;date:string;cadence:Cadence;profileVersion:number;regenerate:boolean};
type ReviewWrite={cadence:Cadence;date:string;requestId:string;sourceVersion:number;predecessorId:string|null;critique:string;consent:true};
type Props={entry?:Entry|null;date?:string;cadence?:Cadence;profile:Profile;synced:boolean;heading?:string;onBusy:(busy:boolean)=>void;onProfileSaved:(profile:Profile)=>void;onSettings:()=>void;onGenerated?:()=>void};
export default function AIReview({entry,date,cadence='daily',profile,synced,heading='Analysis',onBusy,onProfileSaved,onSettings,onGenerated}:Props){
 const targetDate=date||entry!.date;
 const [data,setData]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[generating,setGenerating]=useState(false),[pending,setPending]=useState<string|null>(null),[dismissed,setDismissed]=useState(false),[feedbackOpen,setFeedbackOpen]=useState(false),[feedback,setFeedback]=useState(''),[feedbackId,setFeedbackId]=useState(''),[requestId,setRequestId]=useState(''),[notice,setNotice]=useState('');
 const [deletePending,setDeletePending]=useState<AnalysisReport|null>(null),[feedbackPending,setFeedbackPending]=useState<FeedbackWrite|null>(null);
 const [pendingInput,setPendingInput]=useState<ReviewWrite|null>(null),mounted=useRef(false),scope=useRef(''),scopeEpoch=useRef(0),generation=useRef({epoch:0,id:null as string|null});if(scope.current!==cadence+':'+targetDate){scope.current=cadence+':'+targetDate;scopeEpoch.current++;}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const status=useAIStatus<State>({scope:scope.current,load:()=>request('?ai=1&date='+targetDate+'&cadence='+cadence),active:!!pending,shouldPoll:next=>next.reports.some(r=>r.status==='generating'),onData:next=>{setData(next);if(generation.current.id&&next.reports.some(r=>r.id===generation.current.id&&r.status!=='generating')){if(next.reports.some(r=>r.id===generation.current.id&&r.status==='complete')){setError('');onGenerated?.();}generation.current={epoch:generation.current.epoch+1,id:null};setGenerating(false);setRequestId(crypto.randomUUID());}setPending(current=>current&&next.reports.some(r=>r.id===current&&r.status!=='generating')?null:current);setPendingInput(current=>current&&next.reports.some(r=>r.id===(current.predecessorId?current.requestId:current.cadence+':'+current.date)&&r.status!=='generating')?null:current);setDeletePending(current=>current&&next.reports.some(r=>r.id===current.id&&!!r.deleted===!current.deleted)?null:current);}});
 useEffect(()=>{generation.current={epoch:generation.current.epoch+1,id:null};setData(null);setError('');setNotice('');setFeedback('');setFeedbackOpen(false);setPending(null);setPendingInput(null);setGenerating(false);setDismissed(false);setRequestId(crypto.randomUUID());},[targetDate,cadence]);
 useEffect(()=>{if(synced)void status.check();},[entry?.version,synced]);
 useEffect(()=>{onBusy(busy||!!deletePending||!!feedbackPending||(generating&&!dismissed));return()=>onBusy(false);},[busy,deletePending,feedbackPending,generating,dismissed,onBusy]);
 const reports=[...(data?.reports||[])].sort((a,b)=>b.revision-a.revision),latest=reports[0],shown=reports.find(r=>r.status==='complete'&&!r.deleted),unconfirmed=!!latest&&latest.status!=='complete';
 const ready=cadence!=='daily'||!!entry?.complete&&!entry?.deleted;
 const canGenerate=!!data?.available&&synced&&ready&&!unconfirmed&&!busy&&!generating&&!pending&&!deletePending&&!feedbackPending&&(!latest||data.regenerationsRemaining>0);
 async function remove(report:AnalysisReport){const target=deletePending||report,ticket=scopeEpoch.current,current=()=>mounted.current&&scopeEpoch.current===ticket;setDeletePending(target);setBusy(true);setError('');try{await request('',{action:'record-deletion',change:{kind:'analysis',id:target.id,deleted:!target.deleted}});if(!current())return;setDeletePending(null);await status.check();if(!current())return;onGenerated?.();setNotice(target.deleted?'Analysis restored.':'Analysis moved to Trash.');}catch(e){if(!current())return;setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500))setDeletePending(null);await status.check();}finally{if(current())setBusy(false);}}
 async function runGeneration(nextProfile:Profile,critique=''){
  const input=pendingInput||{cadence,date:targetDate,requestId,sourceVersion:cadence==='daily'?entry!.version:nextProfile.version,predecessorId:latest?.id||null,critique,consent:true as const},ticket=scopeEpoch.current,run=generation.current.epoch+1,id=input.predecessorId?input.requestId:input.cadence+':'+input.date;generation.current={epoch:run,id};const current=()=>mounted.current&&scopeEpoch.current===ticket&&generation.current.epoch===run;
  setPendingInput(input);setPending(id);setGenerating(true);setDismissed(false);
  try{await request('',{action:'ai',review:input});if(!current())return;setRequestId(crypto.randomUUID());await status.check();}
  catch(e){if(!current())return;setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500)){setPending(null);setPendingInput(null);generation.current.id=null;}await status.check();}
  finally{if(current())setGenerating(false);}
 }
 async function generate(){setError('');setNotice('');await runGeneration(profile);}
 function cancelWait(){setDismissed(true);}
 function openFeedback(){setFeedbackId(crypto.randomUUID());setFeedback('');setFeedbackOpen(true);setError('');}
 async function saveFeedback(regenerate:boolean){
  if(!shown||!feedback.trim())return;const input=feedbackPending||{id:feedbackId,text:feedback,reportId:shown.id,date:targetDate,cadence,profileVersion:profile.version,regenerate},ticket=scopeEpoch.current,current=()=>mounted.current&&scopeEpoch.current===ticket;setFeedbackPending(input);setBusy(true);setError('');
  try{
   const {regenerate:run,...payload}=input;const result=await request('',{action:'analysis-feedback',feedback:payload});if(!current())return;setFeedbackPending(null);
   onProfileSaved(result.profile);setNotice('Feedback saved for future analyses.');
   setFeedback('');setFeedbackOpen(false);
   setBusy(false);if(run)await runGeneration(result.profile,input.text);
  }catch(e){if(!current())return;setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500))setFeedbackPending(null);if(regenerate)await status.check();}finally{if(current())setBusy(false);}
 }
 const canRetry=status.delayed&&!!pending&&!!pendingInput&&!generating&&!reports.some(r=>r.id===pending)&&!busy&&!deletePending&&!feedbackPending;
 return <section className="analysis-card" aria-label={heading}>
  <div className="analysis-heading"><h2>{heading}</h2></div>
  {!data&&!error&&!status.error&&<p className="muted">Opening analysis…</p>}
  {shown?.text?<AnalysisText text={shown.text}/>:data&&<p className="analysis-empty">{unconfirmed?'The analysis is not ready yet.':cadence==='daily'?ready?'Your analysis is ready to generate.':`Your next analysis appears here after a complete journal entry is saved. Daily analysis runs around ${profile.reviewPreferences.daily.time}.`:'No analysis has been generated for this period yet.'}</p>}
  {!dismissed&&(generating||pending||latest?.status==='generating')&&<div className="analysis-progress" role="status"><LoaderCircle className="spin"/><span>{status.delayed?'This is taking longer than usual. A completed analysis will appear when you return.':'Preparing your analysis…'}</span><Button variant="ghost" disabled={busy} onClick={cancelWait}>Cancel</Button></div>}
  {dismissed&&(generating||pending||latest?.status==='generating')&&<p className="analysis-note" role="status">You can continue using LifeApp. The analysis may still finish in the background.</p>}
  {unconfirmed&&latest.status!=='generating'&&!generating&&<p className="analysis-note">This analysis could not be confirmed. Your journal and earlier analyses are safe.</p>}
  {(error||status.error)&&!feedbackOpen&&<p className="error" role="alert">{error||status.error}</p>}
  {notice&&!feedbackOpen&&<p className="analysis-note" role="status">{notice}</p>}
  {data&&<div className="analysis-tools">{latest&&!shown&&!latest.deleted&&<Button variant="ghost" disabled={busy||!!feedbackPending} onClick={()=>void remove(latest)}>{deletePending?'Retry delete':'Delete'}</Button>}
   {shown&&<Button variant="ghost" disabled={busy||!synced||!!feedbackPending} onClick={()=>void remove(shown)}>{deletePending?'Retry delete':'Delete'}</Button>}
   {shown&&<Button variant="ghost" disabled={busy||!synced||!!deletePending||!!feedbackPending} onClick={openFeedback}><MessageSquare/>Feedback</Button>}
   {(!unconfirmed||canRetry)&&<Button variant={shown?'ghost':'default'} disabled={!canGenerate&&!canRetry} onClick={generate}>{shown?<RotateCw/>:null}{canRetry?'Retry this analysis':shown?'Regenerate':'Generate analysis'}</Button>}
  </div>}
  {data&&!latest&&ready&&<p className="analysis-note">Uses your saved journal and preferences with Google Gemini.</p>}
  {shown&&!ready&&<p className="analysis-note">Save a complete entry to regenerate its analysis.</p>}
  {!!latest&&data?.regenerationsRemaining===0&&<p className="analysis-note">Regeneration limit reached for today. You can still save feedback.</p>}
  <AlertDialog open={feedbackOpen} onOpenChange={open=>{if(!busy&&!feedbackPending&&(open||!feedback.trim()))setFeedbackOpen(open);}}><AlertDialogContent className="feedback-dialog"><AlertDialogHeader><AlertDialogTitle>Guide your analysis</AlertDialogTitle><AlertDialogDescription>What should LifeApp understand or do differently? Your feedback is saved for future analyses.</AlertDialogDescription></AlertDialogHeader>
   <label className="compact-field" htmlFor="analysis-feedback">Your feedback<textarea id="analysis-feedback" rows={4} maxLength={500} value={feedback} disabled={busy||!!feedbackPending} onChange={e=>{setFeedback(e.target.value);setFeedbackId(crypto.randomUUID());}} placeholder="For example: focus on consistency, and keep suggestions practical."/></label>
   <button className="guidance-link" disabled={busy||!!feedbackPending} onClick={()=>{setFeedback('');setFeedbackOpen(false);onSettings();}}>Manage saved guidance in Settings <ArrowUpRight/></button>
   {notice&&<p role="status" className="analysis-note">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
   <AlertDialogFooter><Button variant="ghost" disabled={busy||!!feedbackPending} onClick={()=>{setFeedback('');setFeedbackOpen(false);}}>Cancel</Button><Button variant="outline" disabled={busy||!feedback.trim()||feedbackPending?.regenerate===true} onClick={()=>saveFeedback(false)}>{feedbackPending?.regenerate===false?'Retry save':'Save for future'}</Button><Button disabled={busy||!feedback.trim()||(feedbackPending?!feedbackPending.regenerate:!canGenerate)} onClick={()=>saveFeedback(true)}>{feedbackPending?.regenerate?'Retry save & regenerate':'Save & regenerate'}</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </section>;
}
