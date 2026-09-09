"use client";
import {LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {modules,score,todayIn,type Entry,type Profile,type HabitStatus} from '@/lib/life/domain';
import {completionIssues} from '@/lib/life/reviews';
import type {useDraftSync} from './use-draft-sync';

const choices=[['done','Done'],['missed','Missed'],['exempt','Exempt']] as const;
type Props={profile:Profile;entry:Entry;busy:boolean;sync:ReturnType<typeof useDraftSync>;onEdit:(entry:Entry)=>void;onDate:(date:string)=>void;onSave:()=>void;onCancel:()=>void};
export default function CheckIn({profile,entry,busy,sync,onEdit,onDate,onSave,onCancel}:Props){
 const summary=score(entry.habits),issues=completionIssues(entry);
 const extra=modules.filter(m=>m.id!=='reflection'&&(profile.modules.includes(m.id)||entry.context[m.id]!==undefined));
 const saved=sync.status==='saving'?'Saving…':sync.status==='error'?'Save unconfirmed':sync.dirty?'Unsaved changes':entry.version?'Saved':'New response';
 function setHabit(id:string,status:HabitStatus){onEdit({...entry,habits:entry.habits.map(h=>h.id===id?{...h,status}:h)});}
 return <section className="response-editor" aria-label="Response form">
  <label className="response-field" htmlFor="response-date">Date<input id="response-date" type="date" max={todayIn(profile.timezone)} value={entry.date} disabled={busy} onChange={e=>{if(e.target.value)onDate(e.target.value);}}/></label>
  <label className="response-field" htmlFor="journal">Journal<textarea id="journal" maxLength={6000} placeholder="A few words about your day" rows={3} value={entry.journal} onChange={e=>onEdit({...entry,journal:e.target.value})}/></label>
  {extra.map(m=><label className="response-field" key={m.id} htmlFor={'context-'+m.id}><span>{m.name}<small>Optional</small></span><textarea id={'context-'+m.id} maxLength={2000} rows={2} value={entry.context[m.id]||''} onChange={e=>onEdit({...entry,context:{...entry.context,[m.id]:e.target.value}})}/></label>)}
  {entry.habits.map(h=><div className="response-habit" key={h.id}><div className="response-habit-label"><span>{h.title}</span>{h.status==='unrecorded'?<small>Not recorded</small>:<button className="clear-choice" onClick={()=>setHabit(h.id,'unrecorded')} aria-label={`Clear choice for ${h.title}`}>Clear</button>}</div><RadioGroup className="response-choices" aria-label={h.title} value={h.status} onValueChange={status=>setHabit(h.id,status as HabitStatus)}>{choices.map(([value,label])=><label key={value} className={`response-choice ${h.status===value?'selected':''}`}><RadioGroupItem value={value} aria-label={label}/><span>{label}</span></label>)}</RadioGroup></div>)}
  {!!entry.habits.length&&<details className="response-score"><summary>Habit score <strong>{summary.percent===null?'—':summary.percent+'%'}</strong></summary><p>{summary.done} done · {summary.missed} missed · {summary.exempt} exempt · {summary.unrecorded} not recorded</p><small>Only done and missed habits enter the score. Exempt and unrecorded habits are excluded.</small></details>}
  {issues.length>0&&<p className="completion-help">Saves as a draft. {issues.join(' ')}</p>}
  {sync.syncError&&<p className="error" role="alert">{sync.syncError} Keep this tab open and retry Save to confirm the result.</p>}
  <div className="response-actions"><span role="status">{saved}{!sync.dirty&&entry.version>0?` · ${entry.complete?'Complete':'Draft'}`:''}</span><div><Button variant="ghost" disabled={busy||sync.status==='saving'} onClick={onCancel}>Cancel</Button><Button disabled={busy||sync.status==='saving'||(!sync.dirty&&!entry.version)} onClick={onSave}>{sync.status==='saving'?<LoaderCircle className="spin"/>:null}Save</Button></div></div>
 </section>;
}
