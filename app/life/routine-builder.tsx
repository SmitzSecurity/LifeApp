"use client";
import {useContext,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Routine,Saved} from '@/lib/life/modules';
import type {RoutineBuildResult} from '@/lib/life/routine-build-schema';
import {repTarget} from '@/lib/life/exercise-presets';
import {definiteClientRejection} from '@/lib/life/write-retry';
import {request,useUnsaved,useWorkoutCancel,WorkoutToolVisible} from './shared';
import {useAIStatus} from './use-ai-status';
import Dictation from './dictation';
type Build={deleted?:boolean;id:string;status:string;createdAt:string;result:RoutineBuildResult|null};
type Input={requestId:string;text:string;consent:true};
export default function RoutineBuilder({onDirty,onReview,reviewDisabled,embedded=false}:{embedded?:boolean;onDirty:(v:boolean)=>void;onReview:(routine:Saved<Routine>)=>void;reviewDisabled:boolean}){
 const [text,setText]=useState(''),[listening,setListening]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[available,setAvailable]=useState(false),[error,setError]=useState(''),[builds,setBuilds]=useState<Build[]>([]),[pending,setPending]=useState<Input|null>(null);
 const visible=useContext(WorkoutToolVisible),mounted=useRef(true),generation=useRef(0),pendingRef=useRef<Input|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useUnsaved(visible&&(!!text||listening||!!pending),onDirty);
 const status=useAIStatus<{builds:Build[];available:boolean}>({enabled:visible,scope:'routine-builder',load:()=>request('?routine-builds&summary=1'),active:!!pending,
  shouldPoll:data=>data.builds.some(b=>b.status==='generating'),
  onData:data=>{setBuilds(data.builds);setAvailable(data.available);setLoaded(true);const build=data.builds.find(b=>b.id===pendingRef.current?.requestId);if(build&&build.status!=='generating'){generation.current++;pendingRef.current=null;setPending(null);setBusy(false);if(build.result){setText('');setError('');}}},
 });
 const cancel=useWorkoutCancel(()=>{generation.current++;status.stop();setText('');setError('');setBusy(false);},busy&&!pending);
 async function generate(){
  const retrying=!!pending,input=pending||{requestId:crypto.randomUUID(),text:text.trim(),consent:true as const},ticket=++generation.current;pendingRef.current=input;setPending(input);setBusy(true);setError('');
  try{const data=await request('',{action:'routine-build',build:input});if(!mounted.current||ticket!==generation.current)return;setBuilds(old=>[data.build,...old.filter(b=>b.id!==data.build.id)]);if(data.build.status!=='generating'){pendingRef.current=null;setPending(null);if(data.build.result)setText('');}}
  catch(e){if(!mounted.current||ticket!==generation.current)return;setError((e as Error).message);if(definiteClientRejection((e as {status?:number}).status,retrying)){pendingRef.current=null;setPending(null);}}
  finally{if(mounted.current&&ticket===generation.current){setBusy(false);void status.check();}}
 }
 async function remove(build:Build){setBusy(true);setError('');try{await request('',{action:'record-deletion',change:{kind:'build',id:'routine:'+build.id,deleted:!build.deleted}});await status.check();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const unconfirmed=builds.some(b=>['generating','uncertain'].includes(b.status));
 const content=<>
 <p className="muted">Describe your split, exercises, equipment and available time. AI will organize editable drafts for each training day.</p>
 <label className="compact-field">Describe your routine<textarea rows={4} maxLength={5000} disabled={busy||listening||!!pending} value={text} onChange={e=>setText(e.target.value)} placeholder="I train push / pull / legs three days a week, about 45 minutes. I have dumbbells and a cable machine. Build muscle, with strength secondary."/></label>
 <Dictation value={text} onChange={setText} onListening={setListening} disabled={busy||!!pending}/>
 <p className="muted builder-consent">Build with AI sends this description and your Movement goal to Google Gemini. Review the exercises and loads before saving.</p>
 {pending&&<p className="field-hint" role="status">Building your routine... You can cancel this view; a submitted build may finish and appear in Saved AI drafts.</p>}{status.delayed&&<p className="field-hint" role="status">This is taking longer than expected. You can close this window and return to your saved drafts later.</p>}{status.error&&<p role="alert" className="error">Could not check saved drafts. {status.delayed?'Check your connection and reopen the builder.':'Trying again automatically...'}</p>}
 {error&&<p role="alert" className="error">{error}</p>}
 {!loaded&&!status.error&&<p className="muted">Opening the builder...</p>}{loaded&&!available&&<p className="muted">AI building is currently unavailable. You can still create routines manually.</p>}
 <div className="action-row"><Button disabled={busy||listening||!!pending&&!status.delayed||!loaded||!available||(!pending&&(text.trim().length<10||unconfirmed))} onClick={()=>void generate()}>{busy?'Working…':pending?'Retry this build':'Build with AI'}</Button>{embedded&&<Button variant="ghost" disabled={busy&&!pending} onClick={cancel}>Cancel</Button>}{text&&<Button variant="ghost" disabled={busy||listening||!!pending} onClick={()=>setText('')}>Clear</Button>}</div>
 {builds.filter(build=>!build.deleted).map(build=><article className="routine-build-result" key={build.id}><div className="section-heading"><small>{build.deleted?'Trash':'Saved AI draft'}</small><Button variant="ghost" disabled={busy||!!pending} onClick={()=>void remove(build)}>{build.deleted?'Restore':'Delete'}</Button></div>{build.deleted?null:build.result?<><h4>Routine drafts</h4>{build.result.notes&&<p className="builder-notes">{build.result.notes}</p>}{build.result.routines.map(r=><div className="routine-draft" key={r.id}><div className="section-heading"><strong>{r.data.name}</strong><Button variant="secondary" disabled={reviewDisabled||busy} onClick={()=>onReview(r)}>Review routine</Button></div><ul>{r.data.exercises.map(e=><li key={e.id}><span>{e.name}</span><small>{e.sets} × {repTarget(e)} · {e.restSeconds}s rest{e.load?` · ${e.load} ${e.unit}`:''}</small></li>)}</ul></div>)}<small className="muted">Each draft is saved to your routine list only after you review it and choose Save routine.</small></>:<p role="status">{build.status==='generating'?'Your routine build is in progress. It will appear here when it is ready.':build.status==='uncertain'?'This build could not be confirmed. It will not be sent again automatically. New builds are paused while its outcome is unknown.':'The response could not be turned into a valid routine. Your existing routines are unchanged. You can simplify the description and try again.'}</p>}</article>)}
 </>;return <section className="module-card routine-builder" aria-label="AI routine builder">{embedded?content:<details><summary>Build routines from a description</summary>{content}</details>}</section>;
}
