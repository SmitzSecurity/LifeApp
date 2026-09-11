"use client";
import {useState} from 'react';
import {ArrowUp,ArrowDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import type {Budget,Saved} from '@/lib/life/modules';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import {useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';

export default function BudgetOrder({plan,onSave,onClose,onDirty}:{plan:Saved<Budget>;onSave:(change:BudgetItemChange)=>Promise<Saved<Budget>>;onClose:()=>void;onDirty:DirtyReporter}){
 const [base]=useState(plan),[order,setOrder]=useState(()=>plan.data.categories.map(c=>c.id)),[announcement,setAnnouncement]=useState('');
 const operation=useItemSave(onSave),previous=base.data.categories.map(c=>c.id),dirty=order.some((id,i)=>id!==previous[i]),locked=operation.busy||!!operation.pending;
 const visible=order.filter(id=>!base.data.categories.find(c=>c.id===id)!.archived);
 useBudgetDirty('category-order',dirty||locked,onDirty);
 function move(id:string,direction:number){const index=visible.indexOf(id),next=visible[index+direction];if(!next||locked)return;const changed=[...order],a=changed.indexOf(id),b=changed.indexOf(next);[changed[a],changed[b]]=[changed[b],changed[a]];setOrder(changed);operation.setError('');setAnnouncement(`${base.data.categories.find(c=>c.id===id)!.name} moved to position ${index+direction+1} of ${visible.length}.`);}
 async function save(){if(await operation.submit(operation.pending||{kind:'category-order',month:base.id,previous,order,...(!base.version?{initial:base.data}:{})}))onClose();}
 return <Dialog open onOpenChange={open=>{if(!open&&!dirty&&!locked)onClose();}}><DialogContent className="category-order-dialog" showCloseButton={!dirty&&!locked} onInteractOutside={e=>e.preventDefault()}>
  <DialogHeader><DialogTitle>Reorder categories</DialogTitle><DialogDescription>Move categories into the order you prefer for this month.</DialogDescription></DialogHeader>
  <ol className="category-order-list">{visible.map((id,index)=>{const category=base.data.categories.find(c=>c.id===id)!;return <li key={id}><span className="category-position" aria-hidden="true">{index+1}</span><span className="category-order-name">{category.name}</span><Button variant="ghost" size="icon" aria-label={`Move ${category.name} up`} disabled={locked||index===0} onClick={()=>move(id,-1)}><ArrowUp aria-hidden="true"/></Button><Button variant="ghost" size="icon" aria-label={`Move ${category.name} down`} disabled={locked||index===visible.length-1} onClick={()=>move(id,1)}><ArrowDown aria-hidden="true"/></Button></li>;})}</ol>
  <span className="sr-only" role="status">{announcement}</span>{operation.error&&<p role="alert" className="error">{operation.error}</p>}
  <DialogFooter><Button variant="ghost" disabled={locked} onClick={onClose}>Cancel</Button><Button disabled={operation.busy||(!dirty&&!operation.pending)} onClick={()=>void save()}>{operation.busy?'Saving…':operation.pending?'Retry save':'Save order'}</Button></DialogFooter>
 </DialogContent></Dialog>;
}
