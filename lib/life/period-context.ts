import {buildReviewContext} from './review-context.ts';
import {activityTotals,type ActivityRecords} from './activity.ts';
import {type Entry,type Profile,score} from './domain.ts';
import {completionIssues,type Cadence,type ReviewRecord} from './reviews.ts';
// Aggregate all completed source days. Larger windows use clearly labeled excerpts,
// never silently pretend a sample of journal text is a complete transcript.
export function buildPeriodContext(profile:Profile,cadence:Cadence,from:string,through:string,entries:Entry[],activity:ActivityRecords,priorReviews:ReviewRecord[]){
 const base=buildReviewContext({profile,cadence,from,through,entries});
 const complete=entries.filter(e=>e.complete&&!completionIssues(e).length).sort((a,b)=>a.date.localeCompare(b.date));
 const sample=complete.length<=24?complete:Array.from({length:24},(_,i)=>complete[Math.round(i*(complete.length-1)/23)]);
 const habits=new Map<string,{title:string;done:number;missed:number;exempt:number;unrecorded:number}>();
 for(const entry of complete)for(const habit of entry.habits){const key=habit.id+':'+habit.title;const item=habits.get(key)||{title:habit.title,done:0,missed:0,exempt:0,unrecorded:0};item[habit.status]++;habits.set(key,item);}
 const earlier=priorReviews.filter(r=>r.from>=from&&r.through<=through).slice(0,12);
 return {...base,entries:sample.map(e=>({date:e.date,journalExcerpt:e.journal.slice(0,cadence==='weekly'?1200:400),contextExcerpts:Object.fromEntries(Object.entries(e.context).map(([k,v])=>[k,v?.slice(0,120)])),score:score(e.habits)})),
  sampling:{completedSourceDays:complete.length,excerptDays:sample.length,journalTextMayBeTruncated:true,method:complete.length>24?'24 evenly spaced completed days':'Every completed day',instruction:'Use totals for overall patterns. Excerpts are partial evidence; do not claim to have read omitted text.'},
  habitTotals:[...habits.values()].slice(0,50),omittedHabitGroups:Math.max(0,habits.size-50),activity:activityTotals(activity,from,through),
  priorReviews:earlier.map(r=>({...r,content:r.content.slice(0,800),excerpt:true})),workouts:[],cardio:[],
 };
}
