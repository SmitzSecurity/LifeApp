"use client";
import {DateInput} from './date-input';
import {formatDate} from '@/lib/life/date-display';
import {useEffect,useState,type FormEvent} from 'react';
import {SquarePen,BookOpen,Search,Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';
import {score,type Entry} from '@/lib/life/domain';
import type {HistoryFilters,HistoryPage} from '@/lib/life/history';
import {request} from './shared';

type Filters=Omit<HistoryFilters,'before'>;
const blank:Filters={query:'',from:'',through:'',status:'all',deleted:false};
const niceDate=formatDate;
type HistoryQuery={filters:Filters;before:string|null;previous:Entry[];refreshKey:number};
type HistoryResult={query:HistoryQuery;entries:Entry[];cursor:string|null;error:string};

export default function History({disabled,onOpen,onDeleted,onBusy,searchOpen=false,refreshKey=0}:{disabled:boolean;onOpen:(date:string)=>void;onDeleted:(date:string)=>void;onBusy:(busy:boolean)=>void;searchOpen?:boolean;refreshKey?:number}){
 const [filters,setFilters]=useState<Filters>(blank),[query,setQuery]=useState<HistoryQuery>({filters:blank,before:null,previous:[],refreshKey});
 const [result,setResult]=useState<HistoryResult|null>(null);
 const [removing,setRemoving]=useState<Entry|null>(null),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
 if(query.refreshKey!==refreshKey)setQuery({filters:query.filters,before:null,previous:[],refreshKey});
 const applied=query.filters,current=result?.query===query&&query.refreshKey===refreshKey?result:null;
 const loading=!current,loaded=!!current&&!current.error,error=current?.error||'',entries=current?.entries||query.previous,cursor=current?current.cursor:query.before;
 function load(next:Filters,before:string|null=null){setQuery({filters:next,before,previous:before?entries:[],refreshKey});}
 useEffect(()=>{
  let cancelled=false;
  // A refresh always starts at the first page, retaining the selected filters.
  // Each effect owns its response; abandoned filter/pagination reads cannot win.
  const {before,previous}=query;
  void request('',{action:'history',filters:{...query.filters,before}}).then((page:HistoryPage)=>{
   if(!cancelled)setResult({query,entries:before?[...previous,...page.entries.filter(e=>!previous.some(p=>p.date===e.date))]:page.entries,cursor:page.nextCursor,error:''});
  },()=>{if(!cancelled)setResult({query,entries:previous,cursor:before,error:'History could not be loaded. Your saved check-ins are safe. Try again.'});});
  return()=>{cancelled=true;};
 },[query]);
 const filtered=!!(applied.query||applied.from||applied.through||applied.status!=='all');
 const filtersChanged=JSON.stringify(filters)!==JSON.stringify(applied);
 function search(event:FormEvent){event.preventDefault();void load(filters);}
 function clear(){setFilters(blank);void load(blank);}
 async function remove(){if(!removing||deleting)return;setDeleting(true);onBusy(true);setDeleteError('');try{await request('',{action:'record-deletion',change:{kind:'entry',id:removing.date,version:removing.version,deleted:true}});onDeleted(removing.date);setRemoving(null);await load(applied);}catch(e){setDeleteError((e as Error).message);}finally{setDeleting(false);onBusy(false);}}
 return <section className="history-panel" aria-label="Saved responses" tabIndex={0}>
  <form className="history-filters" onSubmit={search} hidden={!searchOpen}>
   <label className="history-search">Search journal text<input type="search" maxLength={200} value={filters.query} onChange={e=>setFilters({...filters,query:e.target.value})} placeholder="Find a word or phrase"/></label>
   <div className="compact-field"><DateInput label="From" clearable value={filters.from} max={filters.through||undefined} onValueChange={from=>setFilters({...filters,from})}/></div>
   <div className="compact-field"><DateInput label="Through" clearable value={filters.through} min={filters.from||undefined} onValueChange={through=>setFilters({...filters,through})}/></div>
   <label>Check-in status<select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value as Filters['status']})}><option value="all">All check-ins</option><option value="complete">Complete</option><option value="draft">Drafts</option></select></label>
   <div className="action-row"><Button type="submit" disabled={disabled}><Search/>Search</Button><Button type="button" variant="ghost" onClick={clear} disabled={disabled}>Clear filters</Button></div>
  </form>
  {searchOpen&&filtersChanged&&<p className="muted">Press Search to apply your changed filters.</p>}
  {filtered&&<div className="filter-summary"><span role="status">{entries.length}{cursor?'+':''} matches · Filters applied</span>{!searchOpen&&<Button variant="ghost" onClick={clear} disabled={disabled}>Clear filters</Button>}</div>}
  {error&&<div className="error" role="alert">{error} <Button variant="outline" onClick={()=>load(applied,cursor)} disabled={loading}>Retry</Button></div>}
  {loading&&<p className="muted" role="status">{entries.length?'Loading older responses…':'Loading your saved responses…'}</p>}
  {loaded&&!entries.length&&!loading&&<div className="empty-history"><BookOpen/><h3>{filtered?'No responses found.':'No responses yet.'}</h3><p>{filtered?'Try another phrase or date range.':'Your saved responses will appear here.'}</p>{filtered&&<Button variant="outline" onClick={clear}>Show all responses</Button>}</div>}
  {entries.map(entry=>{const s=score(entry.habits);return <article className="history-entry" key={entry.date}><button className="history-row" aria-label={`Open response for ${niceDate(entry.date)}`} disabled={disabled||loading} onClick={()=>onOpen(entry.date)}><span className="history-date">{niceDate(entry.date)}{!entry.complete&&<small className="response-draft">Draft</small>}</span><span className="history-score" aria-label={s.percent===null?'No habit score':`Habit score ${s.percent}%`}>{s.percent===null?'—':s.percent+'%'}</span><span className="history-text">{entry.journal||'No journal text'}</span></button><div className="response-row-actions"><Button variant="ghost" size="icon" disabled={disabled||loading} onClick={()=>onOpen(entry.date)} aria-label={`Edit response for ${niceDate(entry.date)}`} title="Edit response"><SquarePen aria-hidden="true"/></Button><Button variant="ghost" size="icon" disabled={disabled||loading} onClick={()=>{setDeleteError('');setRemoving(entry);}} aria-label={`Delete response for ${niceDate(entry.date)}`} title="Delete response"><Trash2 aria-hidden="true"/></Button></div></article>;})}
  {cursor&&!error&&<div className="history-more"><Button variant="outline" disabled={loading||disabled} onClick={()=>load(applied,cursor)}>Load older responses</Button></div>}
 <AlertDialog open={!!removing} onOpenChange={open=>{if(!open&&!deleting)setRemoving(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this response?</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete the response for {removing?niceDate(removing.date):''}? It will move to Trash for seven days. Any unsaved edits to this day will also be discarded.</AlertDialogDescription></AlertDialogHeader>{deleteError&&<p className="error" role="alert">{deleteError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><Button variant="destructive" disabled={deleting} onClick={()=>void remove()}>{deleting?'Deleting…':'Delete response'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </section>;
}
