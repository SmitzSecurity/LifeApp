"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {occurrenceOverrideSchema,type Budget,type Saved} from '@/lib/life/modules';
import {formatDate} from '@/lib/life/date-display';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import {DateInput} from './date-input';
import {useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';

type Recurring=Budget['recurring'][number];
export type OccurrenceDraft={source:Recurring;date:string;originalDate:string;period:string};
export default function OccurrenceDialog({initial,plan,scope,onSave,onClose,onEditSeries,onDirty}:{initial:OccurrenceDraft;plan:Saved<Budget>;scope:string;onSave:(change:BudgetItemChange)=>Promise<Saved<Budget>>;onClose:()=>void;onEditSeries:(source:Recurring)=>void;onDirty:DirtyReporter}){
 const [date,setDate]=useState(initial.date),operation=useItemSave(onSave);
 const locked=operation.busy||!!operation.pending,previous=initial.source.occurrenceOverrides?.find(o=>o.period===initial.period)||null;
 useBudgetDirty('transaction-editor:'+scope+':occurrence',true,onDirty);
 async function submit(skipped:boolean){
  let change=operation.pending;
  if(!change){
   const item=occurrenceOverrideSchema.safeParse({period:initial.period,date:skipped?initial.date:date,skipped});
   if(!item.success){operation.setError('Choose a date within this budget month. To move to another month, skip this occurrence and add a planned transaction there.');return;}
   change={kind:'occurrence',month:plan.id,recurringId:initial.source.id,period:initial.period,previous,item:item.data,...(!plan.version?{initial:plan.data}:{})};
  }
  if(await operation.submit(change))onClose();
 }
 const lastDay=new Date(Date.UTC(Number(plan.id.slice(0,4)),Number(plan.id.slice(5,7)),0)).getUTCDate();
 return <Dialog open onOpenChange={open=>{if(!open&&!locked)onClose();}}><DialogContent className="recurring-dialog budget-occurrence-dialog" showCloseButton={!locked} onInteractOutside={event=>event.preventDefault()}>
 <DialogHeader><DialogTitle>{initial.source.title}</DialogTitle><DialogDescription>Change this occurrence only. Your repeating schedule stays the same.</DialogDescription></DialogHeader>
 <div className="recurring-dialog-body"><fieldset disabled={locked}>
 <DateInput label="Date for this occurrence" required min={plan.id+'-01'} max={plan.id+'-'+lastDay} value={date} onValueChange={value=>{setDate(value);operation.setError('');}}/>
 <p className="field-hint">Usually {formatDate(initial.originalDate)}.{previous?.skipped?' This occurrence is currently skipped.':''}</p>
 {date!==initial.originalDate&&<Button variant="ghost" onClick={()=>setDate(initial.originalDate)}>Use original date</Button>}
 <p className="field-hint">For a different month, skip this occurrence and add a planned transaction in that month.</p>
 <Button variant="ghost" onClick={()=>{onClose();onEditSeries(initial.source);}}>Edit repeating schedule</Button>
 </fieldset>{operation.error&&<p className="error" role="alert">{operation.error}</p>}</div>
 <DialogFooter className="item-dialog-actions">{!previous?.skipped&&<Button variant="ghost" disabled={locked} onClick={()=>void submit(true)}>Skip this occurrence</Button>}<Button variant="ghost" disabled={locked} onClick={onClose}>Cancel</Button><Button disabled={operation.busy} onClick={()=>void submit(false)}>{operation.busy?'Saving…':operation.pending?'Retry save':previous?.skipped?'Restore occurrence':'Save date'}</Button></DialogFooter>
 </DialogContent></Dialog>;
}
