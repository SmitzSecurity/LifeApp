"use client";
import {Check,LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {modules,score,todayIn,type Entry,type Profile,type HabitStatus} from '@/lib/life/domain';
import {completionIssues} from '@/lib/life/reviews';
import type {useDraftSync} from './use-draft-sync';

const labels:Record<HabitStatus,string>={done:'Done',missed:'Missed',exempt:'Exempt',unrecorded:'Not recorded'};
type Props={profile:Profile;entry:Entry;busy:boolean;sync:ReturnType<typeof useDraftSync>;onEdit:(entry:Entry)=>void;onDate:(date:string)=>void;onFinish:()=>void};
export default function CheckIn({profile,entry,busy,sync,onEdit,onDate,onFinish}:Props){
 const summary=score(entry.habits),issues=completionIssues(entry);
 const extra=modules.filter(m=>m.id!=='reflection'&&(profile.modules.includes(m.id)||entry.context[m.id]!==undefined));
 const dateLabel=new Date(entry.date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
 const saved=sync.status==='saving'?'Saving…':sync.status==='waiting'?'Waiting to save…':sync.status==='error'?'Not synced':entry.version?'Saved to your account':'Saves as you write';
 return <div className="daily-layout">
  <section className="entry-panel">
   <div className="section-heading"><div><div className="eyebrow">{entry.date===todayIn(profile.timezone)?'TODAY’S CHECK-IN':'FROM YOUR JOURNAL'}</div><h2>{dateLabel}</h2></div><label className="date-control"><span>Choose a day</span><input aria-label="Check-in date" type="date" max={todayIn(profile.timezone)} value={entry.date} disabled={busy} onChange={e=>{if(e.target.value)onDate(e.target.value);}}/></label></div>
   <div className="journal-field"><label htmlFor="journal">How was your day?</label><p className="journal-prompt">What stayed with you? A few honest words are enough.</p>{profile.moduleGoals.reflection&&<p className="goal-reminder">Your focus: {profile.moduleGoals.reflection}</p>}<textarea id="journal" maxLength={6000} placeholder="Start wherever you are…" rows={7} value={entry.journal} onChange={e=>onEdit({...entry,journal:e.target.value})}/></div>
   <div className="habits-heading"><h3>Your chosen habits</h3><span>{entry.habits.length} {entry.habits.length===1?'habit':'habits'}</span></div>
   {!entry.habits.length?<p className="empty-inline">A journal is enough. You can add habits in My setup whenever you want.</p>:entry.habits.map(h=><div className="habit-row" key={h.id}><div><strong>{h.title}</strong><small>{modules.find(m=>m.id===h.module)?.name}</small></div><RadioGroup className="status-options" aria-label={h.title} value={h.status} onValueChange={status=>onEdit({...entry,habits:entry.habits.map(x=>x.id===h.id?{...x,status:status as HabitStatus}:x)})}>{(['done','missed','exempt','unrecorded'] as HabitStatus[]).map(s=><label key={s} className={`status-option ${h.status===s?'selected '+s:''}`}><RadioGroupItem value={s} aria-label={labels[s]}/><span>{labels[s]}</span></label>)}</RadioGroup></div>)}
   {extra.length>0&&<details className="quiet-details context-fields"><summary>More about your day <span>Optional notes · {extra.length} sections</span></summary>{extra.map(m=><div className="field" key={m.id}><label htmlFor={m.id}>{m.name}<span>Optional</span></label>{profile.moduleGoals[m.id]&&<p className="goal-reminder">Your focus: {profile.moduleGoals[m.id]}</p>}<textarea id={m.id} maxLength={2000} rows={2} placeholder={m.prompt} value={entry.context[m.id]||''} onChange={e=>onEdit({...entry,context:{...entry.context,[m.id]:e.target.value}})}/></div>)}</details>}
   <div className="save-bar"><span role="status">{saved}</span><div className="action-row">{sync.status==='error'&&<Button variant="outline" onClick={()=>sync.flush().catch(()=>{})}>Retry sync</Button>}<Button disabled={busy||sync.status==='saving'||issues.length>0} onClick={onFinish}>{busy?<LoaderCircle className="spin"/>:<Check/>}{entry.complete&&!sync.dirty?'Check-in complete':'Finish check-in'}</Button></div></div>
   {sync.syncError&&<p className="error" role="alert">{sync.syncError} Your unsynced text is still in this tab.</p>}
   {issues.length>0&&<p className="completion-help">To finish: {issues.join(' ')}</p>}
   {entry.complete&&!sync.dirty&&<p className="completion-help">Complete. Your saved review preferences decide what happens next.</p>}
  </section>
  <aside className="review-panel"><div className="eyebrow">A LITTLE PERSPECTIVE</div><h3>One day at a time.</h3><p className="score-caption">A check-in helps you notice. It doesn’t need to be a perfect day.</p><div className="score-number">{summary.percent===null?'—':summary.percent}<span>{summary.percent===null?'No score yet':'%'}</span></div><p className="score-caption">{summary.eligible?`${summary.done} of ${summary.eligible} recorded habits done`:'Your words matter, with or without a habit score.'}</p><details className="quiet-details"><summary>Habit details</summary><dl><div><dt>Done</dt><dd>{summary.done}</dd></div><div><dt>Missed</dt><dd>{summary.missed}</dd></div><div><dt>Exempt</dt><dd>{summary.exempt}</dd></div><div><dt>Not recorded</dt><dd>{summary.unrecorded}</dd></div></dl><p className="score-explainer">Only done and missed habits enter the score. Exempt and unrecorded habits stay separate. AI reviews are separate from this score.</p></details></aside>
 </div>;
}
