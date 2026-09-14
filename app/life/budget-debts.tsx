"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {debtEstimate} from '@/lib/life/debt';
import {money,occurrenceId,recurringDate,transactionSchema,type Budget,type Saved,type Transaction} from '@/lib/life/modules';
import {scheduledInMonth} from '@/lib/life/budget-schedule';
import {request} from './shared';
import BudgetSection from './budget-section';
import {TransactionEditor} from './budget-transactions';
import {recurringDescription} from './budget-recurring';
import type {DirtyReporter} from './budget-fields';

export default function BudgetDebts({plan,today,transactions,onEdit,onAdd,onSave,onDirty,dirtyItems}:{dirtyItems:Record<string,boolean>;plan:Saved<Budget>;today:string;transactions:Saved<Transaction>[];onEdit:(item:Budget['recurring'][number])=>void;onAdd:()=>void;onSave:(record:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter}){
 const [payments,setPayments]=useState<Saved<Transaction>[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 useEffect(()=>{let cancelled=false;setLoaded(false);setError('');request('?debt-payments&month='+plan.id).then(data=>{if(!cancelled){setPayments(data.records.map((r:Saved<Transaction>)=>({...r,data:transactionSchema.parse(r.data)})));setLoaded(true);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[plan.id,plan.version,transactions]);
 const loans=plan.data.recurring.filter(r=>!!r.debt&&(!r.deleted||dirtyItems['transaction-editor:loan-payment:'+r.id]));
 return <BudgetSection id="loans" title="Loans & payoff" className="module-card budget-debts" dirty={Object.entries(dirtyItems).some(([k,v])=>v&&k.startsWith('transaction-editor:loan-payment:'))} actions={<Button variant="ghost" disabled={plan.data.recurring.length>=60} onClick={onAdd}>+ Add loan</Button>}>
 {!loans.length&&<p className="field-hint">Track a medical payment plan, student loan or mortgage alongside its monthly payment.</p>}
 {error&&<p className="error" role="alert">{error}</p>}
 <div className="loan-grid">{loans.map(item=><LoanCard key={plan.id+item.id} {...{item,plan,today,payments,loaded,onEdit,onSave,onDirty}}/>)}</div>
 </BudgetSection>;
}
function LoanCard({item,plan,today,payments,loaded,onEdit,onSave,onDirty}:{item:Budget['recurring'][number];plan:Saved<Budget>;today:string;payments:Saved<Transaction>[];loaded:boolean;onEdit:(item:Budget['recurring'][number])=>void;onSave:(record:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter}){
 const [draft,setDraft]=useState<Saved<Transaction>|null>(null),estimate=loaded?debtEstimate(item,payments,today):null,debt=item.debt!,saved=payments.find(t=>t.id===occurrenceId(plan.id,item.id)),date=recurringDate(plan.id,item),eligible=!item.deleted&&item.active&&scheduledInMonth(plan.id,item)&&date<=today;
 function log(){setDraft(saved?{...saved,data:{...saved.data,voided:false,deleted:false}}:{id:occurrenceId(plan.id,item.id),version:0,data:{date:plan.id===today.slice(0,7)?today:date,kind:'expense',amountCents:item.amountCents,categoryId:item.categoryId,categoryName:plan.data.categories.find(c=>c.id===item.categoryId)?.name||'',note:item.title,recurringId:item.id,voided:false,deleted:false}});}
 return <article className="loan-card"><div className="section-heading"><strong>{item.title}</strong><Button variant="ghost" onClick={()=>onEdit(item)}>Edit</Button></div><strong className="loan-balance">{estimate?money(estimate.balanceCents):'…'}</strong><small>Estimated balance · statement {money(debt.balanceCents)} on {debt.balanceDate}</small><progress aria-label={`${item.title} estimated payoff progress`} max={100} value={estimate?.progress||0}/><div className="loan-figures"><span>{money(item.amountCents)} / month</span><span>{debt.annualRatePercent}% interest</span></div><small>{recurringDescription(item)}</small>
 {estimate&&<><p className="field-hint">{estimate.balanceCents===0?'Estimated paid off. Confirm your statement balance before ending payments.':estimate.payoffDate?`Estimated payoff ${estimate.payoffDate} · ${estimate.projectedPayments} future payments`:estimate.reason}{estimate.reason&&estimate.remainingAtEndCents>0?` Remaining estimate: ${money(estimate.remainingAtEndCents)}.`:''}</p><small>{money(estimate.confirmedPaymentCents)} in logged payments since the statement date.</small></>}
 {draft?<TransactionEditor initial={draft} plan={plan} today={today} scope={'loan-payment:'+item.id} onDirty={onDirty} onSave={onSave} onSaved={()=>setDraft(null)} onCancel={()=>setDraft(null)}/>:<Button variant="secondary" disabled={!loaded||!eligible} onClick={log}>{saved&&!saved.data.voided&&!saved.data.deleted?'Edit this month’s payment':'Log this month’s payment'}</Button>}
 <small className="field-hint">Payoff assumes future payments stay on schedule. Only logged payments count as spending.</small></article>;
}
