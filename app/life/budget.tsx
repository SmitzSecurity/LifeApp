"use client";
import {MonthInput} from './date-input';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Plus} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {todayIn,type Profile} from '@/lib/life/domain';
import {formatDate} from '@/lib/life/date-display';
import {budgetSchema,transactionSchema,budgetSummary,incomeAllocations,money,type Budget,type Transaction,type Saved} from '@/lib/life/modules';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import BudgetBuilder from './budget-builder';
import BudgetDebts from './budget-debts';
import BudgetAnnualFund from './budget-annual-fund';
import {isAnnualExpense} from '@/lib/life/annual-fund';
import {calculateIncome} from '@/lib/life/income-planning';
import {scheduledInMonth} from '@/lib/life/budget-schedule';
import './budget-builder.css';
import BudgetGoals from './budget-goals';
import CategoryAllowance from './budget-category';
import BudgetSection from './budget-section';
import BudgetOrder from './budget-order';
import RecurringDialog,{recurringDescription} from './budget-recurring';
import {TransactionEditor,TransactionTile,blankTransaction} from './budget-transactions';
import {useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';
import {request,saveRecord,useUnsaved} from './shared';

type Recurring=Budget['recurring'][number];
const blankPlan=():Budget=>budgetSchema.parse({currency:'USD',categories:['Housing','Groceries','Dining out','Transport','Bills','Personal'].map(name=>({id:crypto.randomUUID(),name,limitCents:0})),recurring:[],goals:{spending:'',saving:'',investing:''}});
export default function BudgetPanel({profile,onDirty,onProfileSaved}:{profile:Profile;onDirty:(v:boolean)=>void;onProfileSaved:(p:Profile)=>void}){
 const today=todayIn(profile.timezone),[month,setMonth]=useState(today.slice(0,7)),[plan,setPlan]=useState<Saved<Budget>|null>(null),[transactions,setTransactions]=useState<Saved<Transaction>[]>([]);
 const [quick,setQuick]=useState<Saved<Transaction>|null>(null),[recurring,setRecurring]=useState<{item:Recurring;previous:Recurring|null}|null>(null);
 const [suppressedAllocations,setSuppressedAllocations]=useState<string[]>([]),[suppressedOccurrences,setSuppressedOccurrences]=useState<string[]>([]),allocationCache=useRef<Saved<Transaction>[]>([]);
 const dueCache=useRef<ReturnType<typeof budgetSummary>['due']>([]);
 const [ordering,setOrdering]=useState(false),[building,setBuilding]=useState(false);
 const [fundSetup,setFundSetup]=useState<'offer'|'manage'|null>(null),fundPromptShown=useRef(false);
 const [loading,setLoading]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dirtyItems,setDirtyItems]=useState<Record<string,boolean>>({}),[goalsDirty,setGoalsDirty]=useState(false);
 const planRef=useRef<Saved<Budget>|null>(null),loadSequence=useRef(0);
 const reportDirty:DirtyReporter=useCallback((id,dirty)=>setDirtyItems(previous=>!!previous[id]===dirty?previous:{...previous,[id]:dirty}),[]);
 const dirty=goalsDirty||Object.values(dirtyItems).some(Boolean);useUnsaved(dirty,onDirty);
 function resetQuick(){setQuick(blankTransaction(month===today.slice(0,7)?today:month+'-01'));}
 function acceptPlan(record:Saved<Budget>){const value={...record,data:budgetSchema.parse(record.data)};if(value.id===month&&(!planRef.current||planRef.current.id!==month||value.version>=planRef.current.version)){planRef.current=value;setPlan(value);}return value;}
 async function load(){const sequence=++loadSequence.current;setLoading(true);setReady(false);setError('');try{
  const [current,history,tx]=await Promise.all([request('?kind=budget&month='+month),request('?kind=budget'),request('?kind=transaction&month='+month)]);
  if(sequence!==loadSequence.current)return;
  const existing=current.records[0],earlier=(history.records as Saved<Budget>[]).filter(p=>p.id<month).sort((a,b)=>b.id.localeCompare(a.id))[0];
  planRef.current=null;acceptPlan(existing||{id:month,version:0,data:earlier?budgetSchema.parse(earlier.data):blankPlan()});
  setSuppressedAllocations(tx.suppressedAllocations||[]);setSuppressedOccurrences(tx.suppressedOccurrences||[]);allocationCache.current=[];dueCache.current=[];setTransactions(tx.records.map((t:Saved<Transaction>)=>({...t,data:transactionSchema.parse(t.data)})));resetQuick();setRecurring(null);setDirtyItems({});setNotice('');setReady(true);
 }catch(e){if(sequence===loadSequence.current)setError((e as Error).message);}finally{if(sequence===loadSequence.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{loadSequence.current++;};},[month]);
 async function saveItem(change:BudgetItemChange):Promise<Saved<Budget>>{
  try{const result=await request('',{action:'budget-item',change});const saved=acceptPlan(result.record);
   const eligible=(item:Recurring)=>isAnnualExpense(item)&&item.active&&!item.deleted&&!item.excludeFromAnnualFund;
   const newAnnual=change.kind==='recurring'?eligible(change.item)&&(!change.previous||!eligible(change.previous)):change.kind==='import'&&change.recurring.some(row=>eligible(row.item)&&(!row.previous||!eligible(row.previous)));
   if(newAnnual&&profile.annualFund===undefined&&!fundPromptShown.current){fundPromptShown.current=true;setFundSetup('offer');}
   return saved;}
  catch(e){const latest=(e as {record?:Saved<Budget>}).record;if(latest)acceptPlan(latest);throw e;}
 }
 async function saveTransaction(record:Saved<Transaction>){
  // Initial month setup is an implementation detail of this Save, never a
  // prerequisite button or a reason to commit another editor's draft.
  const current=planRef.current;if(!current)throw Error('Reopen the budget and try again.');
  if(!current.version)await saveItem({kind:'initialize',month,initial:current.data});
  try{const saved=await saveRecord('transaction',record);setTransactions(previous=>{const newer=previous.find(t=>t.id===saved.id);return newer&&newer.version>saved.version?previous:[saved,...previous.filter(t=>t.id!==saved.id)];});setNotice(saved.data.deleted?'':saved.data.voided?'Transaction voided.':saved.data.planned?'Planned transaction saved.':'Transaction saved.');return saved;}
  catch(e){if((e as {status?:number}).status===409){try{const latest=await request('?kind=transaction&month='+month);setTransactions(latest.records.map((t:Saved<Transaction>)=>({...t,data:transactionSchema.parse(t.data)})));setSuppressedAllocations(latest.suppressedAllocations||[]);setSuppressedOccurrences(latest.suppressedOccurrences||[]);}catch{}throw Object.assign(Error('This transaction changed in another session. Cancel to load its saved values, then edit again.'),{status:409});}throw e;}
 }
 function addRecurring(loan=false){setRecurring({previous:null,item:{id:crypto.randomUUID(),title:'',kind:'expense',categoryId:plan?.data.categories.find(c=>!c.archived)?.id||'',amountCents:0,day:1,frequency:'monthly-day',week:'first',weekday:1,variable:false,active:true,deleted:false,...(loan?{startDate:month+'-01',debt:{originalBalanceCents:0,balanceCents:0,balanceDate:today,annualRatePercent:0,interestMethod:'monthly' as const,otherPaymentCents:0}}:{})}});}
 function editRecurring(item:Recurring){setRecurring({previous:structuredClone(item),item:structuredClone(item)});}
 const hasTransactionDraft=(scope:string)=>!!dirtyItems['transaction-editor:'+scope];
 const hasDirtyPrefix=(prefix:string)=>Object.entries(dirtyItems).some(([key,value])=>value&&key.startsWith(prefix));
 const categoryHasDraft=(id:string)=>!!dirtyItems['category:'+id]||Object.entries(dirtyItems).some(([key,value])=>value&&(key.startsWith('transaction-editor:'+id+':')||key.startsWith('transaction-editor:category-due:'+id+':')));
 const dueHasDraft=(id:string)=>Object.entries(dirtyItems).some(([key,value])=>{const scope=key.replace(/:undo$/,'');return value&&scope.startsWith('transaction-editor:')&&(scope==='transaction-editor:due:'+id||scope.startsWith('transaction-editor:category-due:')&&scope.endsWith(':'+id));});
 const summary=plan?budgetSummary(plan.data,transactions,month,suppressedOccurrences):null;
 // Keep an editor mounted if another item action archives its category or
 // removes its recurrence. Its draft stays available to finish or cancel.
 const displayedDue=[...(summary?.due||[]),...dueCache.current.filter(due=>dueHasDraft(due.id)&&!summary?.due.some(current=>current.id===due.id))];dueCache.current=displayedDue;
 const txProps=plan?{plan,today,annualFundEnabled:!!profile.annualFund?.enabled,onSave:saveTransaction,onDirty:reportDirty}:null;
 const derivedAllocations=incomeAllocations(transactions,month,suppressedAllocations);
 const keptAllocations=allocationCache.current.filter(t=>dueHasDraft(t.id)&&!transactions.some(x=>x.id===t.id)&&!derivedAllocations.some(x=>x.id===t.id));
 allocationCache.current=[...derivedAllocations,...keptAllocations];const allTransactions=[...transactions,...allocationCache.current];
 const expected:ExpectedPayment[]=[...displayedDue.map(due=>({...due,amountCents:due.incomePlan?calculateIncome(due.amountCents,due.incomePlan).netCents:due.amountCents})),...allTransactions.filter(t=>!t.data.recurringId&&(t.data.planned||t.data.expectedDate)&&(!t.data.deleted&&!t.data.voided||dueHasDraft(t.id))).map(t=>({id:t.id,title:t.data.note||'Planned '+t.data.kind,kind:t.data.kind,amountCents:t.data.amountCents,categoryId:t.data.categoryId,date:t.data.expectedDate||t.data.date,variable:false,recorded:!t.data.planned&&!t.data.deleted&&!t.data.voided,actualCents:t.data.amountCents}))].sort(compareExpected);
 const renderExpected=(item:ExpectedPayment,scope?:string)=><ExpectedItem key={item.id} {...txProps!} scope={scope} due={item} source={plan!.data.recurring.find(x=>x.id===item.recurringId)} transaction={allTransactions.find(t=>t.id===item.id)} onEditRecurring={editRecurring}/>;
 const unscheduled=plan?.data.recurring.filter(r=>!r.deleted&&!r.debt&&!displayedDue.some(d=>d.recurringId===r.id))||[];
 return <section className="budget-workspace">
 <div className="metric-grid budget-metrics"><div className="budget-month-metric"><MonthInput variant="tile" label="Month" aria-label="Budget month" required value={month} disabled={loading||dirty} title={dirty?'Save or cancel your open edits before changing months':undefined} onValueChange={month=>{if(month)setMonth(month);}}/></div>{[['Income',summary?.income],['Spent',summary?.expenses],['Saved / invested',summary?summary.saving+summary.investing:undefined],['Cash flow',summary?.cashFlow]].map(([label,value])=><div key={label}><small>{label}</small><strong>{ready?money(value as number):'—'}</strong></div>)}</div>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="budget-notice">{notice}</p>}
 {!ready?<Button disabled={loading} onClick={()=>void load()}>{loading?'Opening budget…':'Retry budget'}</Button>:plan&&summary&&txProps&&<div key={month}>
 <div className="budget-columns"><BudgetSection id="quick" title="Quick transaction" className="module-card quick-transaction" dirty={hasDirtyPrefix('transaction-editor:quick:')}>{quick&&<TransactionEditor key={quick.id} {...txProps} initial={quick} scope={'quick:'+quick.id} onCancel={resetQuick} onSaved={resetQuick}/>}</BudgetSection>
 <BudgetSection id="allowances" title="Category allowances" className="module-card category-allowances" dirty={hasDirtyPrefix('category:')||plan.data.categories.some(c=>categoryHasDraft(c.id))||!!dirtyItems['category-order']} actions={<Button variant="ghost" onClick={()=>setOrdering(true)} aria-label="Edit categories">Edit</Button>}>
 {summary.categories.filter(c=>!c.archived||categoryHasDraft(c.id)).map(c=>{const category=plan.data.categories.find(x=>x.id===c.id)!;const upcoming=expected.filter(r=>r.categoryId===c.id&&!r.recorded||hasTransactionDraft('category-due:'+c.id+':'+r.id));const recorded=transactions.filter(t=>hasTransactionDraft(c.id+':'+t.id)||t.data.kind==='expense'&&t.data.categoryId===c.id&&!t.data.planned&&!t.data.deleted&&!t.data.voided).filter(t=>!upcoming.some(r=>r.id===t.id)||hasTransactionDraft(c.id+':'+t.id)).sort((a,b)=>b.data.date.localeCompare(a.data.date));return <CategoryAllowance key={c.id} category={category} plan={plan} spent={c.spent} scheduled={c.scheduled} onSave={saveItem} onDirty={reportDirty}><div className="category-activity">{upcoming.map(r=>renderExpected(r,'category-due:'+c.id+':'+r.id))}{recorded.map(t=><TransactionTile key={t.id} {...txProps} record={t} scope={c.id+':'+t.id}/>)}{!upcoming.length&&!recorded.length&&<p className="muted">No activity in this category.</p>}</div></CategoryAllowance>;})}
 </BudgetSection></div>
 <BudgetAnnualFund profile={profile} plan={plan} today={today} transactions={transactions} setup={recurring||building?null:fundSetup} onSetup={setFundSetup} onProfileSaved={onProfileSaved} onSave={saveTransaction} onDirty={reportDirty}/>
 <BudgetDebts dirtyItems={dirtyItems} plan={plan} today={today} transactions={transactions} onEdit={editRecurring} onAdd={()=>addRecurring(true)} onSave={saveTransaction} onDirty={reportDirty}/>
 <div className="budget-columns budget-history"><BudgetSection id="history" title="Transaction history" className="module-card" dirty={hasDirtyPrefix('transaction-editor:history:')}>{!transactions.some(t=>!t.data.deleted&&(!t.data.planned||t.data.voided))&&<p className="muted">Your recorded transactions appear here.</p>}{transactions.filter(t=>!t.data.deleted&&(!t.data.planned||t.data.voided)||hasTransactionDraft('history:'+t.id)).sort((a,b)=>b.data.date.localeCompare(a.data.date)).map(t=><TransactionTile key={t.id} {...txProps} record={t} scope={'history:'+t.id}/>)}
 </BudgetSection>
 <BudgetSection id="expected" title="Expected income & expenses" className="module-card" dirty={hasDirtyPrefix('transaction-editor:due:')}><div className="forecast-totals"><span>Upcoming Income <strong>{money(summary.due.filter(r=>!r.recorded&&r.kind==='income').reduce((n,r)=>n+(r.incomePlan?calculateIncome(r.amountCents,r.incomePlan).netCents:r.amountCents),0)+transactions.filter(t=>t.data.planned&&!t.data.deleted&&!t.data.voided&&t.data.kind==='income').reduce((n,t)=>n+t.data.amountCents,0))}</strong></span><span>Upcoming Expenses <strong>{money(summary.categories.reduce((n,c)=>n+c.scheduled,0))}</strong></span>{expected.some(r=>r.kind==='transfer'&&!r.recorded)&&<span>Card payments / transfers <strong>{money(summary.due.filter(r=>!r.recorded&&r.kind==='transfer').reduce((n,r)=>n+r.amountCents,0)+transactions.filter(t=>t.data.planned&&!t.data.deleted&&!t.data.voided&&t.data.kind==='transfer').reduce((n,t)=>n+t.data.amountCents,0))}</strong>{summary.due.some(r=>!r.recorded&&r.kind==='transfer'&&!r.amountCents)&&<small>Some amounts needed</small>}</span>}<Button variant="ghost" disabled={plan.data.recurring.length>=60} onClick={()=>addRecurring()}><Plus/>Add recurring item</Button></div>
 {!expected.length&&<p className="muted">No expected payments this month.</p>}{expected.map(r=>renderExpected(r))}
 {unscheduled.length>0&&<details className="unscheduled-recurring"><summary>Other recurring items <span>{unscheduled.length}</span></summary>{unscheduled.map(r=><div className="ledger-row" key={r.id}><button className="expected-item-title" onClick={()=>editRecurring(r)}><strong>{r.title}</strong><small>{recurringDescription(r)} · {!r.active?'Paused':!scheduledInMonth(month,r)?'Not due this month':'Schedule ended'}</small></button><span className="expected-amount"><strong>{r.kind==='transfer'&&!r.amountCents?'Amount needed':money(r.amountCents)}</strong>{r.variable&&r.amountCents>0&&<small>Estimated</small>}</span></div>)}</details>}
 </BudgetSection></div>
 <footer className="budget-footer"><div className="budget-footer-actions"><BudgetGoals profile={profile} fallback={plan.data.goals} onProfileSaved={onProfileSaved} onDirty={setGoalsDirty} disabled={false}/><span className="budget-goals-link"><button type="button" onClick={()=>setBuilding(true)}>Build with AI</button></span><span className="budget-goals-link"><button type="button" onClick={()=>setFundSetup('manage')}>Annual bills fund</button></span></div></footer>
 {building&&<BudgetBuilder plan={plan} onSave={saveItem} onClose={()=>setBuilding(false)} onDirty={reportDirty}/>}
 {recurring&&<RecurringDialog key={recurring.item.id} {...recurring} plan={plan} annualFundEnabled={!!profile.annualFund?.enabled} onSave={saveItem} onClose={()=>setRecurring(null)} onDirty={reportDirty}/>} {ordering&&<BudgetOrder plan={plan} onSave={saveItem} onClose={()=>setOrdering(false)} onDirty={reportDirty}/>}</div>}
 </section>;
}

type ExpectedPayment={id:string;title:string;kind:Transaction['kind'];amountCents:number;categoryId:string;date:string;variable:boolean;recorded:boolean;actualCents:number;recurringId?:string;occurrenceDate?:string;paymentDueDate?:string};
function compareExpected(a:ExpectedPayment,b:ExpectedPayment){return Number(a.recorded)-Number(b.recorded)||a.date.localeCompare(b.date)||a.title.localeCompare(b.title);}
function ExpectedItem({due,source,transaction,onEditRecurring,scope,...props}:{due:ExpectedPayment;source?:Recurring;transaction?:Saved<Transaction>;scope?:string;annualFundEnabled?:boolean;onEditRecurring:(item:Recurring)=>void;plan:Saved<Budget>;today:string;onSave:(t:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter}){
 const [initial,setInitial]=useState<Saved<Transaction>|null>(null),[confirming,setConfirming]=useState(false),[locked,setLocked]=useState(false),[undoTarget,setUndoTarget]=useState<Saved<Transaction>|null>(null);
 const undo=useItemSave(props.onSave),undoLocked=undo.busy||!!undo.pending,editorScope=scope||'due:'+due.id;
 useBudgetDirty('transaction-editor:'+editorScope+':undo',!!undoTarget||undoLocked,props.onDirty);
 const daysUntil=Math.round((Date.parse((due.paymentDueDate||due.date)+'T00:00:00Z')-Date.parse(props.today+'T00:00:00Z'))/86400000);
 const urgency=due.recorded?'is-confirmed':daysUntil<=0?'is-due':daysUntil<=7?'is-upcoming':'';
 const status=due.recorded?'Confirmed':daysUntil<0?'Overdue':daysUntil===0?'Due today':daysUntil<=7?'Due soon':'Expected';
 function close(){if(!locked)setInitial(null);}
 function requestUndo(){if(transaction){setUndoTarget(structuredClone(transaction));undo.setError('');}}
 async function undoConfirmation(){if(!undoTarget)return;const oneOff=!undoTarget.data.recurringId&&!!undoTarget.data.expectedDate;const record=undo.pending||{...undoTarget,data:oneOff?{...undoTarget.data,date:undoTarget.data.expectedDate!,planned:true}:{...undoTarget.data,deleted:true}};if(await undo.submit(record))setUndoTarget(null);}
 function editActual(){
  if(due.recorded){requestUndo();return;}
  setConfirming(!due.recorded);
  const current=transaction&&source&&(transaction.data.deleted||transaction.data.voided)?{...transaction,data:transactionSchema.parse({...transaction.data,kind:due.kind,categoryId:due.categoryId,categoryName:'',incomeDetails:source.incomePlan?{grossCents:source.amountCents,plan:source.incomePlan}:undefined,annualFund:due.kind==='expense'&&transaction.data.annualFund==='payment'?transaction.data.annualFund:undefined})}:transaction;
  setInitial(current||{id:due.id,version:0,data:transactionSchema.parse({date:due.date,kind:due.kind,amountCents:Math.max(1,due.amountCents),categoryId:due.categoryId,categoryName:'',note:due.title,recurringId:source!.id,voided:false,...(due.occurrenceDate?{occurrenceDate:due.occurrenceDate}:{}),...(source!.incomePlan?{incomeDetails:{grossCents:source!.amountCents,plan:source!.incomePlan}}:{})})});
 }
 function editName(){if(due.recorded){requestUndo();return;}if(source)onEditRecurring(source);else if(transaction){setConfirming(false);setInitial(transaction);}}
 const amountNeeded=due.kind==='transfer'&&!due.amountCents&&!due.recorded;
 return <div className={`transaction-tile expected-item ${urgency}`}><div className="ledger-row"><button className="expected-item-title" aria-label={`${due.recorded?'Undo confirmation for':'Edit'} ${due.title}`} onClick={editName}><strong>{due.title}</strong><small>{formatDate(due.date)} · {due.kind==='transfer'?'Card payment / transfer':due.kind} · {status}{due.paymentDueDate?' · Pay by '+formatDate(due.paymentDueDate):''}</small></button><button className="expected-amount" aria-label={`${due.recorded?'Undo confirmation for':'Confirm'} ${due.title}: ${amountNeeded?'Amount needed':money(due.recorded?due.actualCents:due.amountCents)}`} onClick={editActual}><strong>{amountNeeded?'Amount needed':money(due.recorded?due.actualCents:due.amountCents)}</strong>{due.variable&&!due.recorded&&!amountNeeded&&<small>Estimated</small>}</button></div>
 {initial&&<Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="budget-payment-dialog" showCloseButton={!locked} onInteractOutside={e=>e.preventDefault()}><DialogHeader><DialogTitle>{confirming?'Confirm payment':initial.data.planned?'Edit planned transaction':'Edit payment'}</DialogTitle><DialogDescription>{due.title}</DialogDescription></DialogHeader>{confirming&&props.plan.id>props.today.slice(0,7)?<><p>Payments can be confirmed once this budget month begins. To record an earlier payment, add a transaction in the month it actually happened.</p><Button variant="ghost" onClick={close}>Cancel</Button></>:<TransactionEditor {...props} initial={initial} confirmation={confirming} unknownAmount={amountNeeded} onLockChange={setLocked} scope={editorScope} variable={due.variable&&!due.recorded} onCancel={close} onSaved={()=>setInitial(null)}/>}</DialogContent></Dialog>}
 {undoTarget&&<Dialog open onOpenChange={open=>{if(!open&&!undoLocked)setUndoTarget(null);}}><DialogContent className="budget-payment-dialog budget-undo-dialog" showCloseButton={!undoLocked} onInteractOutside={event=>event.preventDefault()}><DialogHeader><DialogTitle>Undo payment confirmation?</DialogTitle><DialogDescription>{due.title} · {money(undoTarget.data.amountCents)}</DialogDescription></DialogHeader><p>{undoTarget.data.recurringId?'The recorded payment moves to Trash and this item becomes pending again.':'This item becomes planned again and is removed from recorded totals.'}</p>{undoTarget.data.incomeDetails&&<p className="field-hint">Savings or investment transfers you already confirmed stay recorded.</p>}{undo.error&&<p className="error" role="alert">{undo.error}</p>}<DialogFooter><Button disabled={undo.busy} onClick={()=>void undoConfirmation()}>{undo.busy?'Undoing…':undo.pending?'Retry undo':'Undo confirmation'}</Button><Button variant="ghost" disabled={undoLocked} onClick={()=>setUndoTarget(null)}>Cancel</Button></DialogFooter></DialogContent></Dialog>}
 </div>;
}
