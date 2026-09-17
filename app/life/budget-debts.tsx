"use client";
import {formatDate} from '@/lib/life/date-display';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {ChevronDown,Pencil,Sparkles} from 'lucide-react';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {debtEstimate} from '@/lib/life/debt';
import {LOAN_PRESETS} from '@/lib/life/loan-presets';
import {money,occurrenceId,recurringDate,transactionSchema,type Budget,type Saved,type Transaction} from '@/lib/life/modules';
import {scheduledInMonth} from '@/lib/life/budget-schedule';
import {request} from './shared';
import BudgetSection from './budget-section';
import {TransactionEditor} from './budget-transactions';
import {recurringDescription} from './budget-recurring';
import type {DirtyReporter} from './budget-fields';
import './loan-builder.css';

export default function BudgetDebts({plan,today,transactions,onEdit,onAdd,onAI,onSave,onDirty,dirtyItems}:{dirtyItems:Record<string,boolean>;plan:Saved<Budget>;today:string;transactions:Saved<Transaction>[];onEdit:(item:Budget['recurring'][number])=>void;onAdd:()=>void;onAI?:()=>void;onSave:(record:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter}){
 const [payments,setPayments]=useState<Saved<Transaction>[]>([]),[suppressedOccurrences,setSuppressedOccurrences]=useState<string[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[reload,setReload]=useState(0);
 useEffect(()=>{let cancelled=false;setLoaded(false);setError('');request('?debt-payments&month='+plan.id).then(data=>{if(!cancelled){setPayments(data.records.map((r:Saved<Transaction>)=>({...r,data:transactionSchema.parse(r.data)})));setSuppressedOccurrences(data.suppressedOccurrences||[]);setLoaded(true);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[plan.id,plan.version,transactions,reload]);
 const loans=plan.data.recurring.filter(r=>!!r.debt&&(!r.deleted||dirtyItems['transaction-editor:loan-payment:'+r.id]));
 return <BudgetSection id="loans" title="Loans & payoff" className="module-card budget-debts" dirty={Object.entries(dirtyItems).some(([k,v])=>v&&k.startsWith('transaction-editor:loan-payment:'))} actions={onAI?<DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" disabled={plan.data.recurring.length>=60}>+ Add loan<ChevronDown size={16} aria-hidden="true"/></Button></DropdownMenuTrigger><DropdownMenuContent className="life-menu" align="end"><DropdownMenuItem onSelect={onAdd}><Pencil aria-hidden="true"/><span>Manual Build</span></DropdownMenuItem><DropdownMenuItem onSelect={onAI}><Sparkles aria-hidden="true"/><span>AI Build</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>:<Button variant="ghost" disabled={plan.data.recurring.length>=60} onClick={onAdd}>+ Add loan</Button>}>
 {!loans.length&&<p className="field-hint">Choose a loan preset or use a statement to build with AI. Track a balance now and add payments when you’re ready.</p>}
 {error&&<p className="error" role="alert">Could not load loan payments. {error} <Button variant="ghost" onClick={()=>setReload(value=>value+1)}>Retry</Button></p>}
 <div className="loan-grid">{loans.map(item=><LoanCard key={plan.id+item.id} {...{item,plan,today,payments,suppressedOccurrences,loaded,onEdit,onSave,onDirty}}/>)}</div>
 </BudgetSection>;
}
function LoanCard({item,plan,today,payments,suppressedOccurrences,loaded,onEdit,onSave,onDirty}:{item:Budget['recurring'][number];plan:Saved<Budget>;today:string;payments:Saved<Transaction>[];suppressedOccurrences:string[];loaded:boolean;onEdit:(item:Budget['recurring'][number])=>void;onSave:(record:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter}){
 const [draft,setDraft]=useState<Saved<Transaction>|null>(null),estimate=loaded?debtEstimate(item,payments,today):null,debt=item.debt!,id=occurrenceId(plan.id,item.id),saved=payments.find(t=>t.id===id),date=recurringDate(plan.id,item),balanceOnly=debt.paymentStatus==='balance-only',suppressed=suppressedOccurrences.includes(id),paid=!!saved&&!saved.data.voided&&!saved.data.deleted,eligible=!item.deleted&&item.active&&!balanceOnly&&scheduledInMonth(plan.id,item)&&date<=today&&!suppressed;
 const statement=estimate?.estimateMode==='statement',loanLabel=LOAN_PRESETS.find(preset=>preset.type===debt.loanType)?.label;
 function log(){
  const current={kind:item.kind as Transaction['kind'],categoryId:item.kind==='expense'?item.categoryId:'',categoryName:item.kind==='expense'?plan.data.categories.find(category=>category.id===item.categoryId)?.name||'':'',note:item.title,incomeDetails:undefined,annualFund:undefined};
  setDraft(saved?{...saved,data:{...saved.data,...(!paid?current:{}),voided:false,deleted:false}}:{id,version:0,data:{date:plan.id===today.slice(0,7)?today:date,...current,amountCents:item.amountCents,recurringId:item.id,voided:false,deleted:false}});
 }
 return <article className="loan-card"><div className="section-heading"><strong>{item.title}</strong><Button variant="ghost" onClick={()=>onEdit(item)}>Edit</Button></div>
 <small className="loan-balance-label">{loanLabel?loanLabel+' · ':''}{statement?debt.loanType!=='credit-card'&&debt.accruedInterestCents===undefined?'Principal balance':'Statement balance':'Estimated balance'}</small><strong className="loan-balance">{estimate?money(estimate.balanceCents):'…'}</strong><small>Statement dated {formatDate(debt.balanceDate)}{debt.loanType!=='credit-card'&&debt.accruedInterestCents===undefined?' · Existing unpaid interest not entered':''}</small>
 {estimate&&debt.loanType!=='credit-card'&&<div className="loan-statement-parts"><span>{money(estimate.principalCents)} principal</span>{(estimate.accruedInterestCents>0||debt.accruedInterestCents!==undefined)&&<span>{money(estimate.accruedInterestCents)} unpaid interest</span>}</div>}
 {estimate&&estimate.progress!==null&&!statement&&<progress aria-label={`${item.title} estimated payoff progress`} max={100} value={estimate.progress}/>}
 <div className="loan-figures"><span>{balanceOnly?'No scheduled payment':item.amountCents?money(item.amountCents)+' / month':'Payment amount not set'}</span><span>{debt.interestAccrual==='paused'?'Interest paused':debt.annualRatePercent===undefined?'Rate not set':debt.annualRatePercent+'% '+(debt.loanType==='credit-card'?'APR':'interest')}</span></div>{!balanceOnly&&<small>{recurringDescription(item)}</small>}
 {estimate&&<><p className="field-hint">{!statement&&estimate.balanceCents===0?'Estimated paid off. Confirm your statement balance before ending payments.':estimate.payoffDate?`Estimated payoff ${formatDate(estimate.payoffDate)} · ${estimate.projectedPayments} future payments`:estimate.reason}{'assumption' in estimate&&estimate.assumption?' '+estimate.assumption:''}</p><small>{money(estimate.confirmedPaymentCents)} in logged payments since the statement date.</small></>}
 {draft?<TransactionEditor initial={draft} plan={plan} today={today} unknownAmount={!paid&&item.amountCents===0} scope={'loan-payment:'+item.id} onDirty={onDirty} onSave={onSave} onSaved={()=>setDraft(null)} onCancel={()=>setDraft(null)}/>:balanceOnly?<div className="loan-card-actions"><Button variant="secondary" onClick={()=>onEdit(item)}>Add payment schedule</Button></div>:suppressed?<small className="field-hint">This month’s payment was permanently removed.</small>:<div className="loan-card-actions"><Button variant="secondary" disabled={!loaded||(!paid&&!eligible)} onClick={log}>{paid?'Edit this month’s payment':'Log this month’s payment'}</Button></div>}
 </article>;
}
