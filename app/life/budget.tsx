"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Pencil,Plus} from 'lucide-react';
import {todayIn,type Profile} from '@/lib/life/domain';
import {budgetSchema,transactionSchema,budgetSummary,occurrenceId,money,type Budget,type Transaction,type Saved} from '@/lib/life/modules';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import BudgetGoals from './budget-goals';
import CategoryAllowance from './budget-category';
import BudgetSection from './budget-section';
import BudgetOrder from './budget-order';
import RecurringDialog,{recurringDescription} from './budget-recurring';
import {TransactionEditor,TransactionTile,blankTransaction} from './budget-transactions';
import {SaveItemButton,type DirtyReporter} from './budget-fields';
import {request,saveRecord,useUnsaved} from './shared';

type Recurring=Budget['recurring'][number];
const blankPlan=():Budget=>budgetSchema.parse({currency:'USD',categories:['Housing','Groceries','Dining out','Transport','Bills','Personal'].map(name=>({id:crypto.randomUUID(),name,limitCents:0})),recurring:[],goals:{spending:'',saving:'',investing:''}});
export default function BudgetPanel({profile,onDirty,onProfileSaved}:{profile:Profile;onDirty:(v:boolean)=>void;onProfileSaved:(p:Profile)=>void}){
 const today=todayIn(profile.timezone),[month,setMonth]=useState(today.slice(0,7)),[plan,setPlan]=useState<Saved<Budget>|null>(null),[transactions,setTransactions]=useState<Saved<Transaction>[]>([]);
 const [quick,setQuick]=useState<Saved<Transaction>|null>(null),[newCategory,setNewCategory]=useState<Budget['categories'][number]|null>(null),[recurring,setRecurring]=useState<{item:Recurring;previous:Recurring|null}|null>(null);
 const [ordering,setOrdering]=useState(false);
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
  setTransactions(tx.records.map((t:Saved<Transaction>)=>({...t,data:transactionSchema.parse(t.data)})));resetQuick();setNewCategory(null);setRecurring(null);setDirtyItems({});setNotice('');setReady(true);
 }catch(e){if(sequence===loadSequence.current)setError((e as Error).message);}finally{if(sequence===loadSequence.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{loadSequence.current++;};},[month]);
 async function saveItem(change:BudgetItemChange):Promise<Saved<Budget>>{
  try{const result=await request('',{action:'budget-item',change});return acceptPlan(result.record);}
  catch(e){const latest=(e as {record?:Saved<Budget>}).record;if(latest)acceptPlan(latest);throw e;}
 }
 async function saveTransaction(record:Saved<Transaction>){
  // Initial month setup is an implementation detail of this Save, never a
  // prerequisite button or a reason to commit another editor's draft.
  const current=planRef.current;if(!current)throw Error('Reopen the budget and try again.');
  if(!current.version)await saveItem({kind:'initialize',month,initial:current.data});
  try{const saved=await saveRecord('transaction',record);setTransactions(previous=>{const newer=previous.find(t=>t.id===saved.id);return newer&&newer.version>saved.version?previous:[saved,...previous.filter(t=>t.id!==saved.id)];});setNotice(saved.data.deleted?'Transaction deleted. You can restore it below.':saved.data.voided?'Transaction voided.':'Transaction saved.');return saved;}
  catch(e){if((e as {status?:number}).status===409){try{const latest=await request('?kind=transaction&month='+month);setTransactions(latest.records.map((t:Saved<Transaction>)=>({...t,data:transactionSchema.parse(t.data)})));}catch{}throw Object.assign(Error('This transaction changed in another session. Cancel to load its saved values, then edit again.'),{status:409});}throw e;}
 }
 function addRecurring(){setRecurring({previous:null,item:{id:crypto.randomUUID(),title:'',kind:'expense',categoryId:plan?.data.categories.find(c=>!c.archived)?.id||'',amountCents:0,day:1,frequency:'monthly-day',week:'first',weekday:1,variable:false,active:true,deleted:false}});}
 function editRecurring(item:Recurring){setRecurring({previous:structuredClone(item),item:structuredClone(item)});}
 const hasTransactionDraft=(scope:string)=>!!dirtyItems['transaction-editor:'+scope];
 const hasDirtyPrefix=(prefix:string)=>Object.entries(dirtyItems).some(([key,value])=>value&&key.startsWith(prefix));
 const categoryHasDraft=(id:string)=>!!dirtyItems['category:'+id]||Object.entries(dirtyItems).some(([key,value])=>value&&key.startsWith('transaction-editor:'+id+':'));
 const summary=plan?budgetSummary(plan.data,transactions,month):null;
 // Keep an editor mounted if another item action archives its category or
 // removes its recurrence. Its draft stays available to finish or cancel.
 const displayedDue=plan?budgetSummary({...plan.data,recurring:plan.data.recurring.map(r=>hasTransactionDraft('due:'+occurrenceId(month,r.id))?{...r,active:true,deleted:false}:r)},transactions,month).due:[];
 const txProps=plan?{plan,today,onSave:saveTransaction,onDirty:reportDirty}:null;
 return <section className="budget-workspace"><div className="budget-toolbar"><h2>Your month</h2><label className="compact-field">Month<input aria-label="Budget month" type="month" value={month} disabled={loading||dirty} title={dirty?'Save or cancel your open edits before changing months':undefined} onInput={e=>{if(e.currentTarget.value)setMonth(e.currentTarget.value);}} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label></div>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="budget-notice">{notice}</p>}
 {!ready?<Button disabled={loading} onClick={()=>void load()}>{loading?'Opening budget…':'Retry budget'}</Button>:plan&&summary&&txProps&&<div key={month}>
 <div className="metric-grid budget-metrics">{[['Income',summary.income],['Spent',summary.expenses],['Saved / invested',summary.saving+summary.investing],['Cash flow',summary.cashFlow]].map(([label,value])=><div key={label}><small>{label}</small><strong>{money(value as number)}</strong></div>)}</div>
 <div className="budget-columns"><BudgetSection id="quick" title="Quick transaction" className="module-card quick-transaction" dirty={hasDirtyPrefix('transaction-editor:quick:')}>{quick&&<TransactionEditor key={quick.id} {...txProps} initial={quick} scope={'quick:'+quick.id} onCancel={resetQuick} onSaved={resetQuick}/>}</BudgetSection>
 <BudgetSection id="allowances" title="Category allowances" className="module-card category-allowances" dirty={hasDirtyPrefix('category:')||plan.data.categories.some(c=>categoryHasDraft(c.id)||hasDirtyPrefix('transaction-action:'+c.id+':'))||hasDirtyPrefix('restore-category:')||hasDirtyPrefix('restore-recurring:')||!!dirtyItems['category-order']} actions={<Button variant="ghost" disabled={plan.data.categories.filter(c=>!c.archived).length<2} onClick={()=>setOrdering(true)}>Reorder</Button>}>
 {summary.categories.filter(c=>!c.archived||categoryHasDraft(c.id)).map(c=>{const category=plan.data.categories.find(x=>x.id===c.id)!;const recorded=transactions.filter(t=>t.data.kind==='expense'&&t.data.categoryId===c.id&&(!t.data.deleted&&!t.data.voided||hasTransactionDraft(c.id+':'+t.id)));return <CategoryAllowance key={c.id} category={category} plan={plan} spent={c.spent} scheduled={c.scheduled} needsActual={summary.due.some(r=>r.categoryId===c.id&&r.variable&&!r.recorded&&r.date<=today)} onSave={saveItem} onDirty={reportDirty}>{recorded.length?recorded.map(t=><TransactionTile key={t.id} {...txProps} record={t} scope={c.id+':'+t.id}/>):<p className="muted">No recorded expenses in this category.</p>}</CategoryAllowance>;})}
 {newCategory&&<CategoryAllowance key={newCategory.id} category={newCategory} plan={plan} isNew onSave={saveItem} onDirty={reportDirty} onDone={()=>setNewCategory(null)}/>}
 {!newCategory&&<Button variant="ghost" disabled={plan.data.categories.length>=30} onClick={()=>setNewCategory({id:crypto.randomUUID(),name:'',limitCents:0,archived:false})}><Plus/>Category</Button>}
 {plan.data.categories.some(c=>c.archived)&&<details className="deleted-items"><summary>Archived categories</summary>{plan.data.categories.filter(c=>c.archived).map(c=><SaveItemButton key={c.id} id={'restore-category:'+c.id} label={'Restore '+c.name} item={{kind:'category',month,previous:c,item:{...c,archived:false},...(!plan.version?{initial:plan.data}:{})} as BudgetItemChange} save={saveItem} onDirty={reportDirty}/>)}</details>}
 <BudgetSection id="recurring" title="Recurring income & expenses" className="recurring-list" dirty={hasDirtyPrefix('restore-recurring:')} actions={<Button variant="ghost" disabled={plan.data.recurring.length>=60} onClick={addRecurring}><Plus/>Add recurring item</Button>}>
 {!plan.data.recurring.some(r=>!r.deleted)&&<p className="muted">Add the bills and income you expect each month.</p>}
 {plan.data.recurring.filter(r=>!r.deleted).map(r=><button className="recurring-summary" key={r.id} onClick={()=>editRecurring(r)}><span><strong>{r.title}</strong><small>{r.kind==='income'?'Income':plan.data.categories.find(c=>c.id===r.categoryId)?.name||'Expense'} · {recurringDescription(r)}</small>{(r.variable||!r.active)&&<small className="recurring-label">{r.variable?'Variable · Estimated amount':''}{!r.active?(r.variable?' · Paused':'Paused'):''}</small>}</span><strong>{money(r.amountCents)}</strong><Pencil aria-hidden="true"/></button>)}
 {plan.data.recurring.some(r=>r.deleted)&&<details className="deleted-items"><summary>Deleted monthly items</summary>{plan.data.recurring.filter(r=>r.deleted).map(r=><div className="ledger-row" key={r.id}><span>{r.title}</span><SaveItemButton id={'restore-recurring:'+r.id} label="Restore" item={{kind:'recurring',month,previous:r,item:{...r,deleted:false,active:true},...(!plan.version?{initial:plan.data}:{})} as BudgetItemChange} save={saveItem} onDirty={reportDirty}/></div>)}</details>}</BudgetSection>
 </BudgetSection></div>
 <div className="budget-columns budget-history"><BudgetSection id="history" title="Transaction history" className="module-card" dirty={hasDirtyPrefix('transaction-editor:history:')||hasDirtyPrefix('transaction-editor:deleted:')||hasDirtyPrefix('transaction-action:history:')||hasDirtyPrefix('transaction-action:deleted:')}>{!transactions.some(t=>!t.data.deleted)&&<p className="muted">Your recorded transactions appear here.</p>}{transactions.filter(t=>!t.data.deleted||hasTransactionDraft('history:'+t.id)).sort((a,b)=>b.data.date.localeCompare(a.data.date)).map(t=><TransactionTile key={t.id} {...txProps} record={t} scope={'history:'+t.id}/>)}
 {transactions.some(t=>t.data.deleted)&&<details className="deleted-items deleted-transactions"><summary>Deleted transactions ({transactions.filter(t=>t.data.deleted).length})</summary><p className="muted">Excluded from your history and totals. Restore an item if needed.</p>{transactions.filter(t=>t.data.deleted&&!hasTransactionDraft('history:'+t.id)).map(t=><TransactionTile key={t.id} {...txProps} record={t} scope={'deleted:'+t.id}/>)}</details>}</BudgetSection>
 <BudgetSection id="expected" title="Expected income & expenses" className="module-card" dirty={hasDirtyPrefix('transaction-editor:due:')}><div className="forecast-totals"><span>Income <strong>{money(summary.due.filter(r=>!r.recorded&&r.kind==='income').reduce((n,r)=>n+r.amountCents,0))}</strong></span><span>Expenses <strong>{money(summary.due.filter(r=>!r.recorded&&r.kind==='expense').reduce((n,r)=>n+r.amountCents,0))}</strong></span></div>
 {!summary.due.length&&<p className="muted">Add a recurring item to see expected payments.</p>}{[...displayedDue].sort((a,b)=>a.date.localeCompare(b.date)).map(r=><ExpectedItem key={r.id} {...txProps} due={r} source={plan.data.recurring.find(x=>occurrenceId(month,x.id)===r.id)!} transaction={transactions.find(t=>t.id===r.id)} onEditRecurring={editRecurring}/>)}</BudgetSection></div>
 <footer className="budget-footer"><span>Recorded totals exclude estimates.</span><BudgetGoals profile={profile} fallback={plan.data.goals} onProfileSaved={onProfileSaved} onDirty={setGoalsDirty} disabled={false}/></footer>
 {recurring&&<RecurringDialog key={recurring.item.id} {...recurring} plan={plan} onSave={saveItem} onClose={()=>setRecurring(null)} onDirty={reportDirty}/>} {ordering&&<BudgetOrder plan={plan} onSave={saveItem} onClose={()=>setOrdering(false)} onDirty={reportDirty}/>}</div>}
 </section>;
}

function ExpectedItem({due,source,transaction,onEditRecurring,...props}:{due:ReturnType<typeof budgetSummary>['due'][number];source:Recurring;transaction?:Saved<Transaction>;onEditRecurring:(item:Recurring)=>void;plan:Saved<Budget>;today:string;onSave:(t:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter}){
 const [initial,setInitial]=useState<Saved<Transaction>|null>(null);
 function editActual(){setInitial(transaction?{...transaction,data:{...transaction.data,voided:false,deleted:false}}:{id:due.id,version:0,data:transactionSchema.parse({date:due.date,kind:due.kind,amountCents:due.amountCents,categoryId:due.categoryId,categoryName:'',note:due.title,recurringId:source.id,voided:false})});}
 return <div className={`transaction-tile expected-item ${!due.recorded&&due.variable&&due.date<=props.today?'needs-amount':''}`}>{initial?<TransactionEditor {...props} initial={initial} scope={'due:'+due.id} variable={due.variable&&!due.recorded} onCancel={()=>setInitial(null)} onSaved={()=>setInitial(null)}/>:<div className="ledger-row"><button className="expected-item-title" onClick={()=>onEditRecurring(source)}><strong>{due.title}<Pencil aria-hidden="true"/></strong><small>{due.date} · {due.kind}{due.recorded?' · Recorded':due.variable&&due.date<=props.today?' · Needs actual amount':due.variable?' · Variable estimate':' · Expected'}</small></button><strong>{money(due.recorded?due.actualCents:due.amountCents)}{due.variable&&!due.recorded&&<small>Estimated</small>}</strong>{(due.recorded||due.date<=props.today)&&<Button variant="ghost" onClick={editActual}>{due.recorded?'Edit payment':due.variable?'Enter actual':'Confirm'}</Button>}</div>}</div>;
}
