"use client";
import {formatDateTime} from '@/lib/life/date-display';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter} from '@/components/ui/alert-dialog';
import type {TrashItem} from '@/lib/life/trash';
import {request} from './shared';

export default function Trash({onChanged}:{onChanged:()=>void}){
 const [items,setItems]=useState<TrashItem[]>([]),[next,setNext]=useState<number|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[confirm,setConfirm]=useState<TrashItem|null>(null),[notice,setNotice]=useState(''),[now,setNow]=useState(()=>Date.now());
 async function load(offset=0){setBusy(true);setError('');try{const data=await request('?trash&offset='+offset);setItems(old=>offset?[...old,...data.items.filter((i:TrashItem)=>!old.some(o=>o.id===i.id&&o.kind===i.kind))]:data.items);setNext(data.nextOffset);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{let current=true;void request('?trash&offset=0').then(data=>{if(current){setItems(data.items);setNext(data.nextOffset);}}).catch(e=>{if(current)setError((e as Error).message);}).finally(()=>{if(current)setBusy(false);});return()=>{current=false;};},[]);
 const nextExpiry=Math.min(...items.map(item=>Date.parse(item.expiresAt)).filter(expiry=>expiry>now));
 useEffect(()=>{if(!Number.isFinite(nextExpiry))return;const timer=setTimeout(()=>setNow(Date.now()),Math.min(2147483647,Math.max(0,nextExpiry-Date.now())));return()=>clearTimeout(timer);},[nextExpiry]);
 async function change(item:TrashItem,operation:'restore'|'purge'){setBusy(true);setError('');try{await request('',{action:'trash',change:{kind:item.kind,id:item.id,deletedAt:item.deletedAt,operation}});setConfirm(null);setNotice(operation==='restore'?'Item restored.':'Item permanently deleted.');onChanged();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="trash-page" aria-label="Trash"><div className="section-heading"><div><h2>Trash</h2><p className="muted">Deleted items are permanently removed after 7 days.</p></div><Button variant="ghost" disabled={busy} onClick={()=>void load()}>Refresh</Button></div>
 {notice&&<p role="status" className="analysis-note">{notice}</p>}{error&&!confirm&&<p role="alert" className="error">{error}</p>}
 {!items.length&&<p className="empty-inline">{busy?'Opening Trash…':'Trash is empty.'}</p>}
 {items.map(item=><article className="trash-item" key={item.kind+':'+item.id}><div><strong>{item.title}</strong>{item.detail&&<p>{item.detail}</p>}<small>Automatically deleted {formatDateTime(item.expiresAt)}</small></div><div className="action-row"><Button variant="ghost" disabled={busy||Date.parse(item.expiresAt)<=now} onClick={()=>void change(item,'restore')}>Restore</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirm(item)}>Delete permanently</Button></div></article>)}
 {next!==null&&<Button variant="outline" disabled={busy} onClick={()=>void load(next)}>Load more</Button>}
 <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open&&!busy)setConfirm(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete permanently?</AlertDialogTitle><AlertDialogDescription>{confirm?.title} will be removed and cannot be restored.</AlertDialogDescription></AlertDialogHeader>{error&&<p role="alert" className="error">{error}</p>}<AlertDialogFooter><Button variant="ghost" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</Button><Button disabled={busy} onClick={()=>confirm&&void change(confirm,'purge')}>{busy?'Deleting…':'Delete permanently'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </section>;
}
