"use client";
import {useState,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {categorySchema,parseMoney,money,type Budget,type Saved} from '@/lib/life/modules';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import {CurrencyInput,useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';
type Category=Budget['categories'][number];
export default function CategoryAllowance({category,plan,spent=0,scheduled=0,needsActual=false,isNew=false,onSave,onDirty,onDone,children}:{category:Category;plan:Saved<Budget>;spent?:number;scheduled?:number;needsActual?:boolean;isNew?:boolean;onSave:(change:BudgetItemChange)=>Promise<Saved<Budget>>;onDirty:DirtyReporter;onDone?:()=>void;children?:ReactNode}){
 const [open,setOpen]=useState(isNew),[base,setBase]=useState(category),[name,setName]=useState(category.name),[amount,setAmount]=useState((category.limitCents/100).toFixed(2));
 const operation=useItemSave(onSave),dirty=name!==base.name||amount!==(base.limitCents/100).toFixed(2);
 useBudgetDirty('category:'+category.id,isNew||dirty||operation.busy||!!operation.pending,onDirty);
 function reset(){setBase(category);setName(category.name);setAmount((category.limitCents/100).toFixed(2));operation.setError('');}
 function toggle(){if(operation.busy||operation.pending)return;if(!open&&!dirty)reset();setOpen(!open);}
 function cancel(){reset();setOpen(false);if(isNew)onDone?.();}
 async function save(change?:BudgetItemChange){try{
  const mutation=change||{kind:'category' as const,month:plan.id,previous:isNew?null:base,item:categorySchema.parse({...base,name,limitCents:parseMoney(amount||'0')}),...(!plan.version?{initial:plan.data}:{})};
  const saved=await operation.submit(mutation);if(saved){const value=saved.data.categories.find(c=>c.id===category.id)!;setBase(value);setName(value.name);setAmount((value.limitCents/100).toFixed(2));setOpen(false);onDone?.();}
 }catch{operation.setError('Enter a category name and an allowance of zero or more.');}}
 const remaining=category.limitCents-spent;
 return <details className="allowance-row" open={open}><summary onClick={e=>{e.preventDefault();toggle();}}><span className="allowance-name"><ChevronDown aria-hidden="true"/>{isNew?'New category':category.name}{category.archived&&<small>Archived</small>}<span className="collapse-hint">Collapse</span>{dirty&&!open&&<small className="draft-label">Unsaved</small>}</span>{!isNew&&<><strong className={remaining<0?'negative':''}>{money(remaining)} left</strong><progress aria-label={`${category.name} allowance used`} value={Math.min(spent,category.limitCents)} max={category.limitCents||1}/><small>{money(spent)} / {money(category.limitCents)}{scheduled>0?` · ${money(scheduled)} upcoming`:''}{needsActual?' · Needs actual amount':''}</small></>}</summary>
 <div className="allowance-content"><fieldset disabled={operation.busy||!!operation.pending}><div className="form-grid"><label className="compact-field">Category name<input maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><CurrencyInput label="Monthly allowance" value={amount} onChange={setAmount}/></div></fieldset>
 {operation.error&&<p role="alert" className="error">{operation.error}</p>}
 <div className="action-row"><Button disabled={operation.busy} onClick={()=>void save(operation.pending||undefined)}>{operation.busy?'Saving…':operation.pending?'Retry save':isNew?'Save category':'Confirm'}</Button><Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={cancel}>Cancel</Button>{!isNew&&!category.archived&&<Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={()=>void save({kind:'category',month:plan.id,previous:category,item:{...category,archived:true},...(!plan.version?{initial:plan.data}:{})})}>Archive category</Button>}</div>
 {!isNew&&<><p className="muted allowance-total">{money(remaining-scheduled)} left after expected payments.</p>{children}</>}
 </div></details>;
}
