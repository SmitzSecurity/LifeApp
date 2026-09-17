"use client";
import {DateInput} from './date-input';
import {useCallback,useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {modules,score,todayIn,emptyEntry,type Entry,type Profile,type HabitStatus} from '@/lib/life/domain';
import {completionIssues} from '@/lib/life/reviews';
import type {useDraftSync} from './use-draft-sync';
import Dictation from './dictation';
import {request} from './shared';

const choices=[['done','Done'],['missed','Missed'],['exempt','Exempt']] as const;
type Props={profile:Profile;entry:Entry;busy:boolean;analysis?:ReactNode;sync:ReturnType<typeof useDraftSync>;onEdit:(entry:Entry)=>void;onDate:(date:string)=>void;onSave:()=>void;onCancel:()=>void;onListening?:(listening:boolean)=>void;onConflictResolved?:()=>void;cancelVoice:RefObject<(()=>void)|null>};
export default function CheckIn({profile,entry,busy,analysis,sync,onEdit,onDate,onSave,onCancel,onListening,onConflictResolved,cancelVoice}:Props){
 const [listening,setListening]=useState(false);
 const [conflict,setConflict]=useState<Entry|null>(null),[checking,setChecking]=useState(false),[conflictError,setConflictError]=useState('');
 const journal=useRef<HTMLTextAreaElement>(null);
 const resizeJournal=useCallback(()=>{
  const field=journal.current;if(!field)return;const before=field.offsetHeight;
  field.style.height='auto';field.style.height=field.scrollHeight+'px';
  // Follow newly added lines at the end, including live speech. Editing in the
  // middle or opening an existing response keeps the reader's position.
  if(field.offsetHeight>before&&(listening||document.activeElement===field&&field.selectionStart===field.value.length)){
   const area=field.closest('.response-fields');if(area&&area.clientHeight){const bounds=area.getBoundingClientRect(),overflow=(field.parentElement?.getBoundingClientRect().bottom||field.getBoundingClientRect().bottom)-bounds.bottom;const scale=bounds.height/area.clientHeight;if(overflow>0&&scale>0)area.scrollTop+=overflow/scale+12;}
  }
 },[listening]);
 useLayoutEffect(resizeJournal,[resizeJournal,entry.journal,entry.date]);
 useLayoutEffect(()=>{const field=journal.current;if(!field||typeof ResizeObserver==='undefined')return;let width=field.clientWidth;const observer=new ResizeObserver(()=>{if(field.clientWidth!==width){width=field.clientWidth;resizeJournal();}});observer.observe(field);return()=>observer.disconnect();},[resizeJournal]);
 const listeningChanged=useCallback((value:boolean)=>{setListening(value);onListening?.(value);},[onListening]);
 const summary=score(entry.habits),issues=completionIssues(entry);
 const extra=modules.filter(m=>m.id!=='reflection'&&!!entry.context[m.id]);
 const saved=sync.status==='saving'?'Saving…':sync.status==='error'?'Save unconfirmed':sync.dirty?'Unsaved changes':entry.version?'Saved':'New response';
 async function reviewConflict(){
  setChecking(true);setConflictError('');
  try{const [day,state]=await Promise.all([request('?date='+encodeURIComponent(entry.date)),request('')]);if(!state.profile)throw Error('Sign in again to review the saved response.');setConflict(day.entry||emptyEntry(state.profile,entry.date));}
  catch(error){setConflictError((error as Error).message);}finally{setChecking(false);}
 }
 function setHabit(id:string,status:HabitStatus){onEdit({...entry,habits:entry.habits.map(h=>h.id===id?{...h,status}:h)});}
 return <section className="response-editor" aria-label="Response form"><div className="response-fields">{analysis}
  <div className="response-field"><DateInput label="Date" id="response-date" required max={todayIn(profile.timezone)} value={entry.date} disabled={busy||listening||sync.status==='error'} onValueChange={date=>{if(date&&date!==entry.date)onDate(date);}}/></div>
  <div className="response-field"><label htmlFor="journal">Journal</label><div className="journal-input"><textarea ref={journal} id="journal" maxLength={6000} placeholder="Write about your day…" rows={1} value={entry.journal} readOnly={listening||busy} onChange={e=>onEdit({...entry,journal:e.target.value})}/><Dictation key={entry.date} cancelRef={cancelVoice} value={entry.journal} onChange={journal=>onEdit({...entry,journal})} onListening={listeningChanged} disabled={busy||sync.status==='error'} maxLength={6000} compact/></div></div>
  {!!extra.length&&<details className="legacy-context"><summary>Earlier section notes</summary>{extra.map(m=><label className="response-field" key={m.id} htmlFor={'context-'+m.id}><span>{m.name}<small>Optional</small></span><textarea id={'context-'+m.id} maxLength={2000} rows={2} value={entry.context[m.id]||''} onChange={e=>onEdit({...entry,context:{...entry.context,[m.id]:e.target.value}})}/></label>)}</details>}
  {entry.habits.map(h=><div className="response-habit" key={h.id}><div className="response-habit-label"><span>{h.title}</span>{h.status==='unrecorded'?<small>Not recorded</small>:<button className="clear-choice" onClick={()=>setHabit(h.id,'unrecorded')} aria-label={`Clear choice for ${h.title}`}>Clear</button>}</div><RadioGroup className="response-choices" aria-label={h.title} value={h.status} onValueChange={status=>setHabit(h.id,status as HabitStatus)}>{choices.map(([value,label])=><label key={value} className={`response-choice ${h.status===value?'selected':''}`}><RadioGroupItem value={value} aria-label={label}/><span>{label}</span></label>)}</RadioGroup></div>)}
  {!!entry.habits.length&&<details className="response-score"><summary>Habit score <strong>{summary.percent===null?'—':summary.percent+'%'}</strong></summary><p>{summary.done} done · {summary.missed} missed · {summary.exempt} exempt · {summary.unrecorded} not recorded</p><small>Only done and missed habits enter the score. Exempt and unrecorded habits are excluded.</small></details>}
  {issues.length>0&&<p className="completion-help">Saves as a draft. {issues.join(' ')}</p>}
  {sync.syncError&&<div className="error" role="alert"><p>{sync.status==='conflict'?'This response changed in another session.':sync.syncError} {sync.status==='error'?'Keep this tab open and retry Save to confirm the result.':sync.status==='conflict'?'Your changes are still here. Review the saved response before saving again.':'Your changes are still here. Correct the entry and save again.'}</p>{sync.status==='conflict'&&<Button variant="outline" disabled={checking} onClick={()=>void reviewConflict()}>{checking?'Checking…':'Review saved response'}</Button>}</div>}{conflictError&&<p className="error" role="alert">{conflictError}</p>}</div>
  <div className="response-actions"><span className="sr-only" role="status">{saved}{!sync.dirty&&entry.version>0?` · ${entry.complete?'Complete':'Draft'}`:''}</span><div className="response-save-buttons"><Button variant="ghost" disabled={busy||checking||sync.status==='saving'||sync.status==='error'} onClick={onCancel}>Cancel</Button><Button variant="ghost" className="response-save" disabled={busy||checking||listening||sync.status==='saving'||sync.status==='conflict'||(!sync.dirty&&!entry.version)} onClick={onSave}>{sync.status==='saving'?<LoaderCircle className="spin"/>:null}Save</Button></div></div>
  <Dialog open={!!conflict} onOpenChange={open=>{if(!open)setConflict(null);}}><DialogContent className="response-conflict-dialog"><DialogHeader><DialogTitle>Review this response</DialogTitle><DialogDescription>{conflict?.deleted?'This response is in Trash. You can keep a copy of your text here, then use the saved version and restore it from Trash.':'Compare your changes with the saved response. Keep my changes returns to the editor for review; nothing is saved until you press Save.'}</DialogDescription></DialogHeader>{conflict&&<><div className="response-conflict-fields"><label>Your journal<textarea readOnly value={entry.journal} rows={5}/></label><label>Saved journal<textarea readOnly value={conflict.journal} rows={5}/></label>{conflict.habits.length>0&&<div><strong>Saved habit choices</strong>{conflict.habits.map(habit=><p key={habit.id}>{habit.title}: {habit.status}</p>)}</div>}<p className="muted">Keeping your changes preserves your journal, earlier section notes and matching habit choices. Newly added habits use their saved choices.</p></div><DialogFooter><Button variant="outline" onClick={()=>{sync.resolveConflict(conflict,false);setConflict(null);onConflictResolved?.();}}>Use saved response</Button><Button disabled={conflict.deleted} onClick={()=>{sync.resolveConflict(conflict,true);setConflict(null);onConflictResolved?.();}}>Keep my changes</Button></DialogFooter></>}</DialogContent></Dialog>
 </section>;
}
