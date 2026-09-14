"use client";
import {useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {modules,score,todayIn,type Entry,type Profile,type HabitStatus} from '@/lib/life/domain';
import {completionIssues} from '@/lib/life/reviews';
import type {useDraftSync} from './use-draft-sync';
import Dictation from './dictation';

const choices=[['done','Done'],['missed','Missed'],['exempt','Exempt']] as const;
type Props={profile:Profile;entry:Entry;busy:boolean;embedded?:boolean;sync:ReturnType<typeof useDraftSync>;onEdit:(entry:Entry)=>void;onDate:(date:string)=>void;onSave:()=>void;onCancel:()=>void};
export default function CheckIn({profile,entry,busy,embedded=false,sync,onEdit,onDate,onSave,onCancel}:Props){
 const [listening,setListening]=useState(false),[dictationKey,setDictationKey]=useState(0);
 const summary=score(entry.habits),issues=completionIssues(entry);
 const extra=modules.filter(m=>m.id!=='reflection'&&!!entry.context[m.id]);
 const saved=sync.status==='saving'?'Saving…':sync.status==='error'?'Save unconfirmed':sync.dirty?'Unsaved changes':entry.version?'Saved':'New response';
 function setHabit(id:string,status:HabitStatus){onEdit({...entry,habits:entry.habits.map(h=>h.id===id?{...h,status}:h)});}
 return <section className={`response-editor${embedded?' embedded-response':''}`} aria-label="Response form"><div className="response-fields">
  <label className="response-field" htmlFor="response-date">Date<input id="response-date" type="date" max={todayIn(profile.timezone)} value={entry.date} disabled={busy||listening} onChange={e=>{if(e.target.value)onDate(e.target.value);}}/></label>
  <div className="response-field journal-field-with-dictation"><div className="journal-field-heading"><label htmlFor="journal">Journal</label><Dictation key={`${entry.date}:${dictationKey}`} value={entry.journal} onChange={journal=>onEdit({...entry,journal})} onListening={setListening} disabled={busy||sync.status==='error'} maxLength={6000} compact/></div><textarea id="journal" maxLength={6000} placeholder="Your day, movement, money, and anything on your mind" rows={3} value={entry.journal} readOnly={listening||busy} onChange={e=>onEdit({...entry,journal:e.target.value})}/></div>
  {!!extra.length&&<details className="legacy-context"><summary>Earlier section notes</summary>{extra.map(m=><label className="response-field" key={m.id} htmlFor={'context-'+m.id}><span>{m.name}<small>Optional</small></span><textarea id={'context-'+m.id} maxLength={2000} rows={2} value={entry.context[m.id]||''} onChange={e=>onEdit({...entry,context:{...entry.context,[m.id]:e.target.value}})}/></label>)}</details>}
  {entry.habits.map(h=><div className="response-habit" key={h.id}><div className="response-habit-label"><span>{h.title}</span>{h.status==='unrecorded'?<small>Not recorded</small>:<button className="clear-choice" onClick={()=>setHabit(h.id,'unrecorded')} aria-label={`Clear choice for ${h.title}`}>Clear</button>}</div><RadioGroup className="response-choices" aria-label={h.title} value={h.status} onValueChange={status=>setHabit(h.id,status as HabitStatus)}>{choices.map(([value,label])=><label key={value} className={`response-choice ${h.status===value?'selected':''}`}><RadioGroupItem value={value} aria-label={label}/><span>{label}</span></label>)}</RadioGroup></div>)}
  {!!entry.habits.length&&<details className="response-score"><summary>Habit score <strong>{summary.percent===null?'—':summary.percent+'%'}</strong></summary><p>{summary.done} done · {summary.missed} missed · {summary.exempt} exempt · {summary.unrecorded} not recorded</p><small>Only done and missed habits enter the score. Exempt and unrecorded habits are excluded.</small></details>}
  {issues.length>0&&<p className="completion-help">Saves as a draft. {issues.join(' ')}</p>}
  {sync.syncError&&<p className="error" role="alert">{sync.syncError} Keep this tab open and retry Save to confirm the result.</p>}</div>
  <div className="response-actions"><span role="status">{listening?'Listening…':saved}{!listening&&!sync.dirty&&entry.version>0?` · ${entry.complete?'Complete':'Draft'}`:''}</span><div><Button variant="ghost" disabled={busy||sync.status==='saving'||embedded&&sync.status==='error'} onClick={()=>{setDictationKey(key=>key+1);setListening(false);onCancel();}}>Cancel</Button><Button disabled={busy||listening||sync.status==='saving'||(!sync.dirty&&!entry.version)} onClick={onSave}>{sync.status==='saving'?<LoaderCircle className="spin"/>:null}Save</Button></div></div>
 </section>;
}
