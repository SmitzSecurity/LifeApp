"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,BookOpen,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {score,type Entry} from '@/lib/life/domain';
import type {HistoryFilters,HistoryPage} from '@/lib/life/history';
import {request} from './shared';

type Filters=Omit<HistoryFilters,'before'>;
const blank:Filters={query:'',from:'',through:'',status:'all'};
const niceDate=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});

export default function History({disabled,onOpen,onToday}:{disabled:boolean;onOpen:(date:string)=>void;onToday:()=>void}){
 const [filters,setFilters]=useState<Filters>(blank),[applied,setApplied]=useState<Filters>(blank);
 const [entries,setEntries]=useState<Entry[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const sequence=useRef(0);
 async function load(next:Filters,before:string|null=null){
  const token=++sequence.current;
  setLoading(true);setError('');
  if(!before){setApplied(next);setEntries([]);setCursor(null);setLoaded(false);}
  try{
   const page:HistoryPage=await request('',{action:'history',filters:{...next,before}});
   if(token!==sequence.current)return;
   setEntries(previous=>before?[...previous,...page.entries.filter(e=>!previous.some(p=>p.date===e.date))]:page.entries);
   setCursor(page.nextCursor);setLoaded(true);
  }catch{if(token===sequence.current)setError('History could not be loaded. Your saved check-ins are safe. Try again.');}
  finally{if(token===sequence.current)setLoading(false);}
 }
 useEffect(()=>{void load(blank);return()=>{sequence.current++;};},[]);
 const filtered=!!(applied.query||applied.from||applied.through||applied.status!=='all');
 const filtersChanged=JSON.stringify(filters)!==JSON.stringify(applied);
 function search(event:FormEvent){event.preventDefault();void load(filters);}
 function clear(){setFilters(blank);void load(blank);}
 return <section className="history-panel">
  <div className="section-heading"><div><div className="eyebrow">ONE DAY AT A TIME</div><h2>Your check-in history</h2></div><span role="status">{loaded?`${entries.length}${cursor?'+':''} ${filtered?(entries.length===1?'match':'matches'):'saved'}`:error?'History unavailable':'Loading history…'}</span></div>
  <form className="history-filters" onSubmit={search}>
   <label className="history-search">Search journal text<input type="search" maxLength={200} value={filters.query} onChange={e=>setFilters({...filters,query:e.target.value})} placeholder="Find a word or phrase"/></label>
   <label>From<input type="date" value={filters.from} max={filters.through||undefined} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
   <label>Through<input type="date" value={filters.through} min={filters.from||undefined} onChange={e=>setFilters({...filters,through:e.target.value})}/></label>
   <label>Check-in status<select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value as Filters['status']})}><option value="all">All check-ins</option><option value="complete">Complete</option><option value="draft">Drafts</option></select></label>
   <div className="action-row"><Button type="submit" disabled={disabled}><Search/>Search</Button><Button type="button" variant="ghost" onClick={clear} disabled={disabled}>Clear filters</Button></div>
  </form>
  {filtersChanged&&<p className="muted">Press Search to apply your changed filters.</p>}
  {error&&<div className="error" role="alert">{error} <Button variant="outline" onClick={()=>load(applied,cursor)} disabled={loading}>Retry</Button></div>}
  {loading&&<p className="muted" role="status">{entries.length?'Loading older check-ins…':'Searching your saved check-ins…'}</p>}
  {loaded&&!entries.length&&!loading&&<div className="empty-history"><BookOpen/><h3>{filtered?'No check-ins match these filters.':'Your story starts with a check-in.'}</h3><p>{filtered?'Try another phrase, a wider date range, or all check-in statuses.':'Save your first day and it will appear here.'}</p>{filtered?<Button variant="outline" onClick={clear}>Show all check-ins</Button>:<Button onClick={onToday}>Write today’s check-in</Button>}</div>}
  {entries.map(entry=>{const s=score(entry.habits);return <button key={entry.date} className="history-row" disabled={disabled||loading} onClick={()=>onOpen(entry.date)}><span className="history-date">{niceDate(entry.date)}<small>{entry.date.slice(0,4)}</small></span><span className="history-text">{entry.journal||'Habit check-in'}<small>{entry.complete?'Complete':'Draft'} · {s.done} done · {s.missed} missed · {s.exempt} exempt · {s.unrecorded} not recorded</small></span><span className="history-score">{s.percent===null?'—':s.percent+'%'}</span><ArrowRight/></button>;})}
  {cursor&&!error&&<div className="history-more"><Button variant="outline" disabled={loading||disabled||filtersChanged} onClick={()=>load(applied,cursor)}>Load older check-ins</Button></div>}
 </section>;
}
