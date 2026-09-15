"use client";
import {useCallback,useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {modules,score,todayIn,type Entry,type Profile,type HabitStatus} from '@/lib/life/domain';
import {completionIssues} from '@/lib/life/reviews';
import type {useDraftSync} from './use-draft-sync';
import Dictation from './dictation';

const choices=[['done','Done'],['missed','Missed'],['exempt','Exempt']] as const;
type Props={profile:Profile;entry:Entry;busy:boolean;analysis?:ReactNode;sync:ReturnType<typeof useDraftSync>;onEdit:(entry:Entry)=>void;onDate:(date:string)=>void;onSave:()=>void;onCancel:()=>void;onListening?:(listening:boolean)=>void;cancelVoice:RefObject<(()=>void)|null>};
export default function CheckIn({profile,entry,busy,analysis,sync,onEdit,onDate,onSave,onCancel,onListening,cancelVoice}:Props){
 const [listening,setListening]=useState(false);
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
 function setHabit(id:string,status:HabitStatus){onEdit({...entry,habits:entry.habits.map(h=>h.id===id?{...h,status}:h)});}
 return <section className="response-editor" aria-label="Response form"><div className="response-fields">{analysis}
  <label className="response-field" htmlFor="response-date">Date<input id="response-date" type="date" max={todayIn(profile.timezone)} value={entry.date} disabled={busy||listening||sync.status==='error'} onInput={e=>{if(e.currentTarget.value&&e.currentTarget.value!==entry.date)onDate(e.currentTarget.value);}}/></label>
  <div className="response-field"><label htmlFor="journal">Journal</label><div className="journal-input"><textarea ref={journal} id="journal" maxLength={6000} placeholder="Your day, movement, money, and anything on your mind" rows={3} value={entry.journal} readOnly={listening||busy} onChange={e=>onEdit({...entry,journal:e.target.value})}/><Dictation key={entry.date} cancelRef={cancelVoice} value={entry.journal} onChange={journal=>onEdit({...entry,journal})} onListening={listeningChanged} disabled={busy||sync.status==='error'} maxLength={6000} compact/></div></div>
  {!!extra.length&&<details className="legacy-context"><summary>Earlier section notes</summary>{extra.map(m=><label className="response-field" key={m.id} htmlFor={'context-'+m.id}><span>{m.name}<small>Optional</small></span><textarea id={'context-'+m.id} maxLength={2000} rows={2} value={entry.context[m.id]||''} onChange={e=>onEdit({...entry,context:{...entry.context,[m.id]:e.target.value}})}/></label>)}</details>}
  {entry.habits.map(h=><div className="response-habit" key={h.id}><div className="response-habit-label"><span>{h.title}</span>{h.status==='unrecorded'?<small>Not recorded</small>:<button className="clear-choice" onClick={()=>setHabit(h.id,'unrecorded')} aria-label={`Clear choice for ${h.title}`}>Clear</button>}</div><RadioGroup className="response-choices" aria-label={h.title} value={h.status} onValueChange={status=>setHabit(h.id,status as HabitStatus)}>{choices.map(([value,label])=><label key={value} className={`response-choice ${h.status===value?'selected':''}`}><RadioGroupItem value={value} aria-label={label}/><span>{label}</span></label>)}</RadioGroup></div>)}
  {!!entry.habits.length&&<details className="response-score"><summary>Habit score <strong>{summary.percent===null?'—':summary.percent+'%'}</strong></summary><p>{summary.done} done · {summary.missed} missed · {summary.exempt} exempt · {summary.unrecorded} not recorded</p><small>Only done and missed habits enter the score. Exempt and unrecorded habits are excluded.</small></details>}
  {issues.length>0&&<p className="completion-help">Saves as a draft. {issues.join(' ')}</p>}
  {sync.syncError&&<p className="error" role="alert">{sync.syncError} Keep this tab open and retry Save to confirm the result.</p>}</div>
  <div className="response-actions"><span role="status">{saved}{!sync.dirty&&entry.version>0?` · ${entry.complete?'Complete':'Draft'}`:''}</span><div className="response-save-buttons"><Button variant="ghost" disabled={busy||sync.status==='saving'||sync.status==='error'} onClick={onCancel}>Cancel</Button><Button disabled={busy||listening||sync.status==='saving'||(!sync.dirty&&!entry.version)} onClick={onSave}>{sync.status==='saving'?<LoaderCircle className="spin"/>:null}Save</Button></div></div>
 </section>;
}
