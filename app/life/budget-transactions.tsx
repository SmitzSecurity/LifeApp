"use client";
import {DateInput} from './date-input';
import {formatDate} from '@/lib/life/date-display';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {transactionSchema,parseMoney,money,dueDate,type Transaction,type Budget,type Saved} from '@/lib/life/modules';
import {Choice} from './shared';
import {CurrencyInput,useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';
export const transactionKinds=[{value:'expense',label:'Expense'},{value:'income',label:'Income'},{value:'saving',label:'Move to savings'},{value:'investing',label:'Move to investments'}];
export const blankTransaction=(date:string):Saved<Transaction>=>({id:crypto.randomUUID(),version:0,data:transactionSchema.parse({date,kind:'expense',amountCents:1,categoryId:'',categoryName:'',note:'',recurringId:null,voided:false})});
type Props={plan:Saved<Budget>;today:string;onSave:(t:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter};
export function TransactionEditor({initial,scope,variable=false,confirmation=false,onLockChange,onCancel,onSaved,plan,today,onSave,onDirty}:Props&{initial:Saved<Transaction>;scope:string;variable?:boolean;confirmation?:boolean;onLockChange?:(locked:boolean)=>void;onCancel:()=>void;onSaved:()=>void}){
 const [base]=useState(initial),[data,setData]=useState(()=>confirmation?{...initial.data,date:plan.id===today.slice(0,7)?today:initial.data.date,voided:false,deleted:false}:initial.data),[initialAmount]=useState(!initial.version&&!initial.data.recurringId&&!initial.data.planned&&!confirmation?'':(initial.data.amountCents/100).toFixed(2)),[amount,setAmount]=useState(initialAmount);
 const operation=useItemSave(onSave),locked=operation.busy||!!operation.pending,dirty=JSON.stringify(data)!==JSON.stringify(base.data)||amount!==initialAmount;
 useEffect(()=>{onLockChange?.(locked);},[locked,onLockChange]);
 useEffect(()=>()=>onLockChange?.(false),[onLockChange]);
 useBudgetDirty('transaction-editor:'+scope,dirty||operation.busy||!!operation.pending,onDirty);
 function edit(patch:Partial<Transaction>){setData({...data,...patch});operation.setError('');}
 const mayPlan=!confirmation&&!data.recurringId,planned=mayPlan&&(data.planned===true||data.date>today),monthEnd=dueDate(plan.id,31),lastDate=mayPlan?monthEnd:today<monthEnd?today:monthEnd;
 async function save(record?:Saved<Transaction>){try{
  if(!record&&data.kind==='expense'&&!plan.data.categories.some(c=>c.id===data.categoryId)){operation.setError('Choose an expense category.');return;}
  if(!record&&(!data.date.startsWith(plan.id+'-')||data.date>lastDate))throw Error();
  const value=record||{...base,data:transactionSchema.parse({...data,amountCents:parseMoney(amount),...(confirmation?{planned:false,...(!data.recurringId?{expectedDate:base.data.expectedDate||base.data.date}:{})}:planned?{planned:true,expectedDate:data.date}:{})})};
  if(await operation.submit(value))onSaved();
 }catch{operation.setError(mayPlan?'Enter an amount greater than zero and a valid date in this month.':'Enter an amount greater than zero and a date in this month, no later than today.');}}
 // Void and Delete affect the saved record, without also committing field drafts.
 function change(patch:Partial<Transaction>){void save({...base,data:{...base.data,...patch}});}
 return <div className="inline-transaction"><div className="transaction-editor-fields"><fieldset disabled={operation.busy||!!operation.pending}><div className="form-grid">
 <label className="compact-field">Type<Choice label="Transaction type" value={data.kind} options={data.recurringId?transactionKinds.filter(k=>k.value===data.kind):transactionKinds} onChange={kind=>edit({kind:kind as Transaction['kind'],categoryId:''})}/></label>
 <CurrencyInput label={confirmation||data.recurringId?'Actual amount':planned?'Estimated amount':'Amount'} ariaLabel="Transaction amount" value={amount} onChange={setAmount} placeholder={data.recurringId?(base.data.amountCents/100).toFixed(2):'0.00'}/>
 <div className="compact-field"><DateInput label={planned?'Expected date':'Date'} required min={plan.id+'-01'} max={lastDate} value={data.date} onValueChange={date=>edit({date})}/></div>
 {data.kind==='expense'&&<label className="compact-field">Category<Choice label="Expense category" value={data.categoryId} options={plan.data.categories.filter(c=>(!c.archived||c.id===data.categoryId)&&(!data.recurringId||c.id===data.categoryId)).map(c=>({value:c.id,label:c.name}))} onChange={categoryId=>edit({categoryId})}/></label>}
 </div>{variable&&<p className="field-hint">Estimated {money(base.data.amountCents)}. Keep this amount or enter the actual amount.</p>}{planned&&<p className="field-hint">This is a planned item. It stays in expected payments until you confirm it.</p>}<label className="compact-field">Description<input maxLength={300} placeholder="e.g. Lunch" value={data.note} onChange={e=>edit({note:e.target.value})}/></label></fieldset>
 {operation.error&&<p role="alert" className="error">{operation.error}</p>}</div>
 <div className="action-row transaction-editor-actions"><Button disabled={operation.busy} onClick={()=>void save(operation.pending||undefined)}>{operation.busy?'Saving…':operation.pending?'Retry save':confirmation?'Confirm':'Save'}</Button>{base.version>0&&!base.data.deleted&&<><Button variant="ghost" disabled={locked} onClick={()=>change({voided:!base.data.voided})}>{base.data.voided?'Unvoid':'Void'}</Button><Button variant="ghost" className="delete-item" disabled={locked} onClick={()=>change({deleted:true})}>Delete</Button></>}<Button variant="ghost" disabled={locked} onClick={onCancel}>Cancel</Button></div></div>;
}
export function TransactionTile({record,scope,...props}:Props&{record:Saved<Transaction>;scope:string}){
 const [editing,setEditing]=useState(false);
 const title=record.data.note||transactionKinds.find(k=>k.value===record.data.kind)?.label||'Transaction';
 return <div className={`transaction-tile ${record.data.voided?'is-voided':''}`}>{editing?<TransactionEditor {...props} initial={record} scope={scope} onCancel={()=>setEditing(false)} onSaved={()=>setEditing(false)}/>:<>
 <div className="ledger-row"><button type="button" className="transaction-description transaction-name-button" disabled={!!record.data.deleted} onClick={()=>setEditing(true)} aria-label={'Edit '+title}><strong>{title}</strong><small>{formatDate(record.data.date)} · {record.data.categoryName||record.data.kind}{record.data.planned?' · Planned':''}</small></button><strong className="transaction-amount">{money(record.data.amountCents)}</strong>{record.data.voided&&<small className="voided-label">Voided</small>}</div></>}</div>;
}
