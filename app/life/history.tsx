"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {SquarePen,BookOpen,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {score,type Entry} from '@/lib/life/domain';
import type {HistoryFilters,HistoryPage} from '@/lib/life/history';
import {request} from './shared';

type Filters=Omit<HistoryFilters,'before'>;
const blank:Filters={query:'',from:'',through:'',status:'all'};
const niceDate=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString(undefined,{year:'numeric',month:'numeric',day:'numeric'});

export default function History({disabled,onOpen,onToday,searchOpen=false,refreshKey=0}:{disabled:boolean;onOpen:(date:string)=>void;onToday:()=>void;searchOpen?:boolean;refreshKey?:number}){
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
 useEffect(()=>{void load(applied);return()=>{sequence.current++;};},[refreshKey]);
 const filtered=!!(applied.query||applied.from||applied.through||applied.status!=='all');
 const filtersChanged=JSON.stringify(filters)!==JSON.stringify(applied);
 function search(event:FormEvent){event.preventDefault();void load(filters);}
 function clear(){setFilters(blank);void load(blank);}
 return <section className="history-panel" aria-label="Saved responses">
  <form className="history-filters" onSubmit={search} hidden={!searchOpen}>
   <label className="history-search">Search journal text<input type="search" maxLength={200} value={filters.query} onChange={e=>setFilters({...filters,query:e.target.value})} placeholder="Find a word or phrase"/></label>
   <label>From<input type="date" value={filters.from} max={filters.through||undefined} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
   <label>Through<input type="date" value={filters.through} min={filters.from||undefined} onChange={e=>setFilters({...filters,through:e.target.value})}/></label>
   <label>Check-in status<select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value as Filters['status']})}><option value="all">All check-ins</option><option value="complete">Complete</option><option value="draft">Drafts</option></select></label>
   <div className="action-row"><Button type="submit" disabled={disabled}><Search/>Search</Button><Button type="button" variant="ghost" onClick={clear} disabled={disabled}>Clear filters</Button></div>
  </form>
  {searchOpen&&filtersChanged&&<p className="muted">Press Search to apply your changed filters.</p>}
  {filtered&&<div className="filter-summary"><span role="status">{entries.length}{cursor?'+':''} matches · Filters applied</span>{!searchOpen&&<Button variant="ghost" onClick={clear} disabled={disabled}>Clear filters</Button>}</div>}
  {error&&<div className="error" role="alert">{error} <Button variant="outline" onClick={()=>load(applied,cursor)} disabled={loading}>Retry</Button></div>}
  {loading&&<p className="muted" role="status">{entries.length?'Loading older responses…':'Loading your saved responses…'}</p>}
  {loaded&&!entries.length&&!loading&&<div className="empty-history"><BookOpen/><h3>{filtered?'No responses found.':'No responses yet.'}</h3><p>{filtered?'Try another phrase or date range.':'Add your first response to get started.'}</p>{filtered?<Button variant="outline" onClick={clear}>Show all responses</Button>:<Button onClick={onToday}>Add response</Button>}</div>}
  {entries.map(entry=>{const s=score(entry.habits);return <button key={entry.date} className="history-row" aria-label={`Edit response for ${niceDate(entry.date)}`} disabled={disabled||loading} onClick={()=>onOpen(entry.date)}><span className="history-date">{niceDate(entry.date)}</span><span className="history-score" aria-label={s.percent===null?'No habit score':`Habit score ${s.percent}%`}>{s.percent===null?'—':s.percent+'%'}</span><span className="history-text">{entry.journal||'No journal text'}</span><span className="response-row-footer"><small>{entry.complete?'':'Draft'}</small><SquarePen aria-hidden="true"/></span></button>;})}
  {cursor&&!error&&<div className="history-more"><Button variant="outline" disabled={loading||disabled} onClick={()=>load(applied,cursor)}>Load older responses</Button></div>}
 </section>;
}
