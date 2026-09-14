"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Routine,Saved} from '@/lib/life/modules';
import type {RoutineBuildResult} from '@/lib/life/routine-build-schema';
import {repTarget} from '@/lib/life/exercise-presets';
import {request,useUnsaved} from './shared';
import Dictation from './dictation';
type Build={id:string;status:string;createdAt:string;result:RoutineBuildResult|null};
type Input={requestId:string;text:string;consent:true};
export default function RoutineBuilder({onDirty,onReview,reviewDisabled,embedded=false}:{embedded?:boolean;onDirty:(v:boolean)=>void;onReview:(routine:Saved<Routine>)=>void;reviewDisabled:boolean}){
 const [text,setText]=useState(''),[listening,setListening]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[available,setAvailable]=useState(false),[error,setError]=useState(''),[builds,setBuilds]=useState<Build[]>([]),[pending,setPending]=useState<Input|null>(null);
 useUnsaved(!!text||listening||!!pending,onDirty);
 async function refresh(){setBusy(true);setError('');try{const data=await request('?routine-builds');setBuilds(data.builds);setAvailable(data.available);setLoaded(true);if(pending&&data.builds.some((b:Build)=>b.id===pending.requestId)){setPending(null);setText('');}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[]);
 async function generate(){const input=pending||{requestId:crypto.randomUUID(),text:text.trim(),consent:true as const};setPending(input);setBusy(true);setError('');try{const data=await request('',{action:'routine-build',build:input});setBuilds(old=>[data.build,...old.filter(b=>b.id!==data.build.id)]);setPending(null);setText('');}catch(e){setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500))setPending(null);}finally{setBusy(false);}}
 const unconfirmed=builds.some(b=>['generating','uncertain'].includes(b.status));
 const content=<>
 <p className="muted">Describe your split, exercises, equipment and available time. AI will organize editable drafts for each training day.</p>
 <label className="compact-field">Describe your routine<textarea rows={4} maxLength={5000} disabled={busy||listening||!!pending} value={text} onChange={e=>setText(e.target.value)} placeholder="I train push / pull / legs three days a week, about 45 minutes. I have dumbbells and a cable machine. Build muscle, with strength secondary."/></label>
 <Dictation value={text} onChange={setText} onListening={setListening} disabled={busy||!!pending}/>
 <p className="muted builder-consent">Build with AI sends this description and your Movement goal to Google Gemini. Review the exercises and loads before saving.</p>
 {error&&<p role="alert" className="error">{error}</p>}
 {!loaded&&<p className="muted">{busy?'Opening the builder…':'Refresh to open the builder.'}</p>}{loaded&&!available&&<p className="muted">AI building is currently unavailable. You can still create routines manually.</p>}
 <div className="action-row"><Button disabled={busy||listening||!loaded||!available||(!pending&&(text.trim().length<10||unconfirmed))} onClick={()=>void generate()}>{busy?'Working…':pending?'Check / retry this build':'Build with AI'}</Button><Button variant="ghost" disabled={busy||listening} onClick={()=>void refresh()}>Refresh status</Button>{text&&<Button variant="ghost" disabled={busy||listening||!!pending} onClick={()=>setText('')}>Clear</Button>}</div>
 {builds.map(build=><article className="routine-build-result" key={build.id}>{build.result?<><h4>Routine drafts</h4>{build.result.notes&&<p className="builder-notes">{build.result.notes}</p>}{build.result.routines.map(r=><div className="routine-draft" key={r.id}><div className="section-heading"><strong>{r.data.name}</strong><Button variant="secondary" disabled={reviewDisabled||busy} onClick={()=>onReview(r)}>Review routine</Button></div><ul>{r.data.exercises.map(e=><li key={e.id}><span>{e.name}</span><small>{e.sets} × {repTarget(e)} · {e.restSeconds}s rest{e.load?` · ${e.load} ${e.unit}`:''}</small></li>)}</ul></div>)}<small className="muted">Each draft is saved to your routine list only after you review it and choose Save routine.</small></>:<p role="status">{build.status==='generating'?'Your routine build is in progress. Refresh status to check it.':build.status==='uncertain'?'This build could not be confirmed. It will not be sent again automatically. New builds are paused while its outcome is unknown.':'The response could not be turned into a valid routine. Your existing routines are unchanged. You can simplify the description and try again.'}</p>}</article>)}
 </>;return <section className="module-card routine-builder" aria-label="AI routine builder">{embedded?content:<details><summary>Build routines from a description</summary>{content}</details>}</section>;
}
