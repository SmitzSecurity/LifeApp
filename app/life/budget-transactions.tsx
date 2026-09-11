"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {transactionSchema,parseMoney,money,dueDate,type Transaction,type Budget,type Saved} from '@/lib/life/modules';
import {Choice} from './shared';
import {CurrencyInput,useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';
export const transactionKinds=[{value:'expense',label:'Expense'},{value:'income',label:'Income'},{value:'saving',label:'Move to savings'},{value:'investing',label:'Move to investments'}];
export const blankTransaction=(date:string):Saved<Transaction>=>({id:crypto.randomUUID(),version:0,data:transactionSchema.parse({date,kind:'expense',amountCents:1,categoryId:'',categoryName:'',note:'',recurringId:null,voided:false})});
type Props={plan:Saved<Budget>;today:string;onSave:(t:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter};
export function TransactionEditor({initial,scope,variable=false,onCancel,onSaved,plan,today,onSave,onDirty}:Props&{initial:Saved<Transaction>;scope:string;variable?:boolean;onCancel:()=>void;onSaved:()=>void}){
 const [base]=useState(initial),[data,setData]=useState(initial.data),[amount,setAmount]=useState(variable||!initial.version&&!initial.data.recurringId?'':(initial.data.amountCents/100).toFixed(2));
 const operation=useItemSave(onSave),dirty=JSON.stringify(data)!==JSON.stringify(base.data)||amount!==(variable||!base.version&&!base.data.recurringId?'':(base.data.amountCents/100).toFixed(2));
 useBudgetDirty('transaction-editor:'+scope,dirty||operation.busy||!!operation.pending,onDirty);
 function edit(patch:Partial<Transaction>){setData({...data,...patch});operation.setError('');}
 async function save(record?:Saved<Transaction>){try{if(!record&&data.kind==='expense'&&!plan.data.categories.some(c=>c.id===data.categoryId)){operation.setError('Choose an expense category.');return;}if(!record&&(data.date>today||!data.date.startsWith(plan.id+'-')))throw Error();const value=record||{...base,data:transactionSchema.parse({...data,amountCents:parseMoney(amount)})};if(await operation.submit(value))onSaved();}catch{operation.setError('Enter an amount greater than zero and a date in this month, no later than today.');}}
 return <div className="inline-transaction"><fieldset disabled={operation.busy||!!operation.pending}><div className="form-grid">
 <label className="compact-field">Type<Choice label="Transaction type" value={data.kind} options={data.recurringId?transactionKinds.filter(k=>k.value===data.kind):transactionKinds} onChange={kind=>edit({kind:kind as Transaction['kind'],categoryId:''})}/></label>
 <CurrencyInput label={data.recurringId?'Actual amount':'Amount'} ariaLabel="Transaction amount" value={amount} onChange={setAmount} placeholder={data.recurringId?(base.data.amountCents/100).toFixed(2):'0.00'}/>
 <label className="compact-field">Date<input type="date" min={plan.id+'-01'} max={plan.id===today.slice(0,7)?today:dueDate(plan.id,31)} value={data.date} onChange={e=>edit({date:e.target.value})}/></label>
 {data.kind==='expense'&&<label className="compact-field">Category<Choice label="Expense category" value={data.categoryId} options={plan.data.categories.filter(c=>(!c.archived||c.id===data.categoryId)&&(!data.recurringId||c.id===data.categoryId)).map(c=>({value:c.id,label:c.name}))} onChange={categoryId=>edit({categoryId})}/></label>}
 </div>{variable&&<p className="field-hint">Estimated {money(base.data.amountCents)}. Enter the actual amount.</p>}<label className="compact-field">Description<input maxLength={300} placeholder="e.g. Lunch" value={data.note} onChange={e=>edit({note:e.target.value})}/></label>
 {base.version>0&&<label className="inline-check"><input type="checkbox" checked={data.voided} onChange={e=>edit({voided:e.target.checked})}/>Void transaction</label>}</fieldset>
 {operation.error&&<p role="alert" className="error">{operation.error}</p>}
 <div className="action-row"><Button disabled={operation.busy} onClick={()=>void save(operation.pending||undefined)}>{operation.busy?'Saving…':operation.pending?'Retry save':'Save transaction'}</Button><Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={onCancel}>Cancel</Button></div></div>;
}
export function TransactionTile({record,scope,...props}:Props&{record:Saved<Transaction>;scope:string}){
 const [editing,setEditing]=useState(false),operation=useItemSave(props.onSave);
 useBudgetDirty('transaction-action:'+scope,operation.busy||!!operation.pending,props.onDirty);
 async function change(patch:Partial<Transaction>){await operation.submit({...record,data:{...record.data,...patch}});}
 const title=record.data.note||transactionKinds.find(k=>k.value===record.data.kind)?.label;
 return <div className={`transaction-tile ${record.data.voided?'is-voided':''}`}>{editing?<TransactionEditor {...props} initial={record} scope={scope} onCancel={()=>setEditing(false)} onSaved={()=>setEditing(false)}/>:<>
 <div className="ledger-row"><span className="transaction-description"><strong>{title}</strong><small>{record.data.date} · {record.data.categoryName||record.data.kind}</small></span><strong className="transaction-amount">{money(record.data.amountCents)}</strong>{record.data.voided&&<small className="voided-label">Voided</small>}
 <div className="transaction-actions">{record.data.deleted?<Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={()=>void change({deleted:false})}>Restore</Button>:<><Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={()=>setEditing(true)}>Edit</Button><Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={()=>void change({voided:!record.data.voided})}>{record.data.voided?'Unvoid':'Void'}</Button><Button variant="ghost" className="delete-item" disabled={operation.busy||!!operation.pending} onClick={()=>void change({deleted:true})}>Delete</Button></>}</div></div>
 {operation.error&&<p role="alert" className="error">{operation.error}</p>}{operation.pending&&<Button disabled={operation.busy} onClick={()=>void operation.submit(operation.pending!)}>{operation.busy?'Saving…':'Retry save'}</Button>}</>}</div>;
}
