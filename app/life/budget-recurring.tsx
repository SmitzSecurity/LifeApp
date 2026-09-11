"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {recurringSchema,parseMoney,type Budget,type Saved} from '@/lib/life/modules';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import {Choice} from './shared';
import {CurrencyInput,useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';
type Recurring=Budget['recurring'][number];
export const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function recurringDescription(item:Recurring){return item.frequency==='monthly-weekday'?`${item.week[0].toUpperCase()+item.week.slice(1)} ${weekdays[item.weekday]} each month`:`Day ${item.day} each month`;}
export default function RecurringDialog({item,previous,plan,onSave,onClose,onDirty}:{item:Recurring;previous:Recurring|null;plan:Saved<Budget>;onSave:(change:BudgetItemChange)=>Promise<Saved<Budget>>;onClose:()=>void;onDirty:DirtyReporter}){
 const [draft,setDraft]=useState(item),[amount,setAmount]=useState(item.amountCents?(item.amountCents/100).toFixed(2):'');
 const operation=useItemSave(onSave),dirty=JSON.stringify(draft)!==JSON.stringify(item)||amount!==(item.amountCents?(item.amountCents/100).toFixed(2):'');
 useBudgetDirty('recurring-dialog',dirty||operation.busy||!!operation.pending,onDirty);
 function edit(patch:Partial<Recurring>){setDraft({...draft,...patch});operation.setError('');}
 async function save(change?:BudgetItemChange){
  try{const mutation=change||{kind:'recurring' as const,month:plan.id,previous,item:recurringSchema.parse({...draft,amountCents:parseMoney(amount)}),...(!plan.version?{initial:plan.data}:{})};if(await operation.submit(mutation))onClose();}
  catch{operation.setError('Enter a name and an amount greater than zero. Variable items need an estimate.');}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!dirty&&!operation.busy&&!operation.pending)onClose();}}><DialogContent className="recurring-dialog" showCloseButton={!dirty&&!operation.busy&&!operation.pending} onInteractOutside={e=>e.preventDefault()}>
 <DialogHeader><DialogTitle>{previous?.deleted?'Restore recurring item':previous?'Edit recurring item':'Add recurring item'}</DialogTitle><DialogDescription>Set the amount and when it repeats. {previous?'Changes apply to this month.':'It will be included in this month’s budget.'}</DialogDescription></DialogHeader>
 <div className="recurring-dialog-body"><fieldset disabled={operation.busy||!!operation.pending}><label className="compact-field">Name<input maxLength={100} value={draft.title} placeholder="e.g. Electric bill" onChange={e=>edit({title:e.target.value})}/></label>
 <div className="form-grid"><label className="compact-field">Type<Choice label="Recurring type" value={draft.kind} options={[{value:'expense',label:'Expense'},{value:'income',label:'Income'}]} onChange={kind=>edit({kind:kind as Recurring['kind'],categoryId:kind==='income'?'':plan.data.categories.find(c=>!c.archived)?.id||''})}/></label>
 <CurrencyInput label={draft.variable?'Estimated amount':'Amount'} value={amount} onChange={setAmount}/></div>
 <label className="inline-check"><input type="checkbox" checked={draft.variable} onChange={e=>edit({variable:e.target.checked})}/>The actual amount varies</label>{draft.variable&&<p className="field-hint">Use your best estimate. We’ll remind you to enter the actual amount when it’s due.</p>}
 <div className="form-grid"><label className="compact-field">Repeat by<Choice label="Recurring frequency" value={draft.frequency} options={[{value:'monthly-day',label:'Day of month'},{value:'monthly-weekday',label:'Weekday of month'}]} onChange={frequency=>edit({frequency:frequency as Recurring['frequency']})}/></label>
 {draft.frequency==='monthly-day'?<label className="compact-field">Day<input type="number" min={1} max={31} value={draft.day} onChange={e=>edit({day:Number(e.target.value)})}/></label>:<><label className="compact-field">Which week<Choice label="Recurring week" value={draft.week} options={['first','second','third','fourth','last'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))} onChange={week=>edit({week:week as Recurring['week']})}/></label><label className="compact-field">Weekday<Choice label="Recurring weekday" value={String(draft.weekday)} options={weekdays.map((label,i)=>({value:String(i),label}))} onChange={weekday=>edit({weekday:Number(weekday)})}/></label></>}
 {draft.kind==='expense'&&<label className="compact-field">Category<Choice label="Recurring category" value={draft.categoryId} options={plan.data.categories.filter(c=>!c.archived||c.id===draft.categoryId).map(c=>({value:c.id,label:c.name}))} onChange={categoryId=>edit({categoryId})}/></label>}</div>
 <label className="inline-check"><input type="checkbox" checked={draft.active} onChange={e=>edit({active:e.target.checked})}/>Active this month</label></fieldset>
 {operation.error&&<p role="alert" className="error">{operation.error}</p>}</div>
 <DialogFooter className="item-dialog-actions">{previous&&!previous.deleted&&<Button variant="ghost" className="delete-item" disabled={operation.busy||!!operation.pending} onClick={()=>void save({kind:'recurring',month:plan.id,previous,item:{...previous,deleted:true,active:false},...(!plan.version?{initial:plan.data}:{})})}>Delete item</Button>}<Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={onClose}>Cancel</Button><Button disabled={operation.busy} onClick={()=>void save(operation.pending||undefined)}>{operation.busy?'Saving…':operation.pending?'Retry save':previous?.deleted?'Restore item':'Save'}</Button></DialogFooter>
 </DialogContent></Dialog>;
}
