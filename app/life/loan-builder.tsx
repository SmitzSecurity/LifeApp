"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {recurringSchema,parseMoney,type Budget,type Saved} from '@/lib/life/modules';
import {loanPreset,LOAN_PRESETS,type LoanType} from '@/lib/life/loan-presets';
import type {Debt} from '@/lib/life/debt';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import {Choice} from './shared';
import {DateInput} from './date-input';
import NumericInput from './numeric-input';
import {CurrencyInput,useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';
import './loan-builder.css';

type Recurring=Budget['recurring'][number];
type Props={item:Recurring;previous:Recurring|null;plan:Saved<Budget>;onSave:(change:BudgetItemChange)=>Promise<Saved<Budget>>;onClose:()=>void;onDirty:DirtyReporter;draftMode?:boolean;initialAmount?:string};
const centsText=(value:number|undefined)=>value===undefined?'':(value/100).toFixed(2);
const weeks=['first','second','third','fourth','last'] as const;
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const capital=(text:string)=>text[0].toUpperCase()+text.slice(1);

/** Statement fields stay raw until Save. A preset chooses a model, not a rate,
 * principal, payment or lender-specific repayment obligation. */
export default function LoanDialog({item,previous,plan,onSave,onClose,onDirty,draftMode=false,initialAmount}:Props){
 const initialDebt=item.debt||loanPreset('other',plan.id+'-01');
 const [draft,setDraft]=useState<Recurring>({...item,debt:initialDebt});
 const [amount,setAmount]=useState(initialAmount??(item.amountCents?centsText(item.amountCents):''));
 const initialAmounts={balance:previous||initialDebt.balanceCents?centsText(initialDebt.balanceCents):'',original:centsText(initialDebt.originalBalanceCents),interest:centsText(initialDebt.accruedInterestCents),other:initialDebt.otherPaymentCents?centsText(initialDebt.otherPaymentCents):'',rate:initialDebt.annualRatePercent===undefined?'':String(initialDebt.annualRatePercent)};
 const [amounts,setAmounts]=useState(initialAmounts),[endMode,setEndMode]=useState(item.installments?'count':item.endDate?'date':'never');
 const operation=useItemSave(onSave),locked=operation.busy||!!operation.pending;
 const debt=draft.debt!,type=debt.loanType||'other',card=type==='credit-card',scheduled=debt.paymentStatus!=='balance-only';
 const preset=LOAN_PRESETS.find(value=>value.type===type)!;
 const dirty=JSON.stringify(draft)!==JSON.stringify({...item,debt:initialDebt})||JSON.stringify(amounts)!==JSON.stringify(initialAmounts)||amount!==(initialAmount??(item.amountCents?centsText(item.amountCents):''));
 useBudgetDirty('loan-dialog',dirty||locked,onDirty);
 function edit(patch:Partial<Recurring>){setDraft(value=>({...value,...patch}));operation.setError('');}
 function editDebt(patch:Partial<Debt>){edit({debt:{...debt,...patch}});}
 function moneyEdit(key:keyof typeof amounts,value:string){setAmounts(previous=>({...previous,[key]:value}));operation.setError('');}
 function chooseType(value:string){
  const next=loanPreset(value as LoanType,debt.balanceDate);
  edit({kind:value==='credit-card'?'transfer':'expense',categoryId:value==='credit-card'?'':draft.categoryId,paymentDueDay:value==='credit-card'?draft.paymentDueDay:undefined,incomePlan:undefined,debt:{...debt,loanType:next.loanType,interestMethod:next.interestMethod,interestAccrual:next.interestAccrual}});
 }
 function cancel(){if(!locked)onClose();}
 async function save(change?:BudgetItemChange){
  try{
   if(!change&&scheduled&&endMode==='date'&&!draft.endDate)throw Error('Choose a final eligible date.');
   if(!change&&!amounts.balance.trim())throw Error(card?'Enter the balance shown on your statement.':'Enter the remaining principal shown on your statement.');
   if(!change&&draft.kind==='expense'&&!draftMode&&!plan.data.categories.some(category=>category.id===draft.categoryId&&(!category.archived||category.id===previous?.categoryId)))throw Error('Choose a payment category.');
   const mutation=change||{kind:'recurring' as const,month:plan.id,previous,item:recurringSchema.parse({...draft,
    amountCents:scheduled&&amount.trim()?parseMoney(amount):0,variable:card&&!amount.trim()?true:draft.variable,
    ...(!scheduled?{frequency:'monthly-day',day:1,week:'first',weekday:1,custom:undefined,month:undefined,startDate:undefined,endDate:undefined,installments:undefined,paymentDueDay:undefined}:{}),
    debt:{...debt,balanceCents:parseMoney(amounts.balance),originalBalanceCents:!card&&amounts.original.trim()?parseMoney(amounts.original):undefined,accruedInterestCents:!card&&amounts.interest.trim()?parseMoney(amounts.interest):undefined,otherPaymentCents:!card&&amounts.other.trim()?parseMoney(amounts.other):0,annualRatePercent:amounts.rate.trim()?Number(amounts.rate):undefined},
   }),...(!plan.version?{initial:plan.data}:{})};
   if(await operation.submit(mutation))onClose();
  }catch(error){
   operation.setError(error instanceof Error&&'issues' in error?((error as unknown as {issues:{message:string}[]}).issues[0]?.message||'Check the loan details.'):error instanceof Error?error.message:'Check the loan details.');
  }
 }
 return <Dialog open onOpenChange={open=>{if(!open)cancel();}}><DialogContent className="loan-builder-dialog" showCloseButton={!locked} onInteractOutside={event=>event.preventDefault()}>
  <DialogHeader><DialogTitle>{previous?.deleted?'Restore loan':previous?'Edit loan':'Add loan'}</DialogTitle><DialogDescription>{draftMode?'Review the statement details before adding this loan.':'Start with your latest statement. You can track a balance before payments begin.'}</DialogDescription></DialogHeader>
  <div className="loan-builder-body"><fieldset disabled={locked}>
   <div className="loan-form-grid"><label className="compact-field">Loan type<Choice label="Loan type" value={type} options={LOAN_PRESETS.map(value=>({value:value.type,label:value.label}))} onChange={chooseType}/></label><label className="compact-field">Name<input maxLength={100} value={draft.title} placeholder={card?'e.g. Everyday card':type==='student'?'e.g. MOHELA — loan group A':type==='mortgage'?'e.g. Home mortgage':'e.g. '+preset.label} onChange={event=>edit({title:event.target.value})}/></label></div>
   <p className="field-hint loan-preset-help">{preset.description}</p>
   <section className="loan-builder-section" aria-label="Statement details"><h3>Statement details</h3>
    <div className="loan-form-grid"><CurrencyInput label={card?'Statement balance':'Principal remaining'} value={amounts.balance} onChange={value=>moneyEdit('balance',value)}/><div className="compact-field"><DateInput label="Balance as of (end of day)" required value={debt.balanceDate} onValueChange={balanceDate=>editDebt({balanceDate})}/></div>
    {!card&&<CurrencyInput label="Unpaid interest (if listed)" value={amounts.interest} onChange={value=>moneyEdit('interest',value)} placeholder="Optional"/>}
    <label className="compact-field">{card?'APR (optional, for reference)':'Interest rate % (if known)'}<input inputMode="decimal" placeholder={card?'Optional':'0 if interest-free'} value={amounts.rate} onChange={event=>moneyEdit('rate',event.target.value)}/></label>
    {!card&&<label className="compact-field">Interest right now<Choice label="Current interest accrual" value={debt.interestAccrual||'accruing'} options={[{value:'unknown',label:'Not sure'},{value:'accruing',label:'Accruing'},{value:'paused',label:'Paused / not charged'}]} onChange={interestAccrual=>editDebt({interestAccrual:interestAccrual as Debt['interestAccrual']})}/></label>}
    </div>
    <p className="field-hint">{card?'Track the statement balance; payments are transfers and do not count your purchases twice. No payoff estimate is assumed.':type==='student'?'Use one entry per loan group if rates or repayment terms differ. Keep unpaid interest separate from principal.':'Use the loan’s interest rate, not its fee-inclusive APR. Leave it blank if you need to check.'}{!card&&!amounts.interest.trim()?' Unpaid interest is not entered; estimates will exclude any existing unpaid interest.':''}</p>
   </section>
   <section className="loan-builder-section" aria-label="Payment setup"><h3>Payments</h3>
    <label className="compact-field">Payment setup<Choice label="Loan payment setup" value={scheduled?'scheduled':'balance-only'} options={[{value:'balance-only',label:'Track balance only'},{value:'scheduled',label:'Add a monthly payment'}]} onChange={paymentStatus=>editDebt({paymentStatus:paymentStatus as Debt['paymentStatus']})}/></label>
    {!scheduled&&<p className="field-hint">No payment reminder or budget expense is created until you add a schedule.</p>}
    {scheduled&&<><div className="loan-form-grid"><CurrencyInput label={card?'Payment estimate (optional)':'Monthly payment'} value={amount} onChange={setAmount}/>{draft.frequency==='monthly-weekday'?<label className="compact-field">Week<Choice label="Payment week" value={draft.week} options={weeks.map(value=>({value,label:capital(value)}))} onChange={week=>edit({week:week as Recurring['week']})}/></label>:<label className="compact-field">Payment day<NumericInput min={1} max={31} value={draft.day} onValueChange={day=>edit({day})}/></label>}
    {draft.frequency==='monthly-weekday'&&<label className="compact-field">Weekday<Choice label="Payment weekday" value={String(draft.weekday)} options={weekdays.map((label,index)=>({value:String(index),label}))} onChange={weekday=>edit({weekday:Number(weekday)})}/></label>}
    {type==='mortgage'&&<CurrencyInput label="Escrow / other included costs" value={amounts.other} onChange={value=>moneyEdit('other',value)}/>}
    {!card&&<label className="compact-field">Payment category<Choice label="Loan payment category" value={draft.categoryId||'unassigned'} options={[{value:'unassigned',label:'Choose a category'},...plan.data.categories.filter(category=>!category.archived||category.id===draft.categoryId).map(category=>({value:category.id,label:category.name}))]} onChange={categoryId=>edit({categoryId:categoryId==='unassigned'?'':categoryId})}/></label>}
    </div><label className="inline-check"><input type="checkbox" checked={draft.variable} onChange={event=>edit({variable:event.target.checked})}/>Payment amount varies</label>{card&&<p className="field-hint">Leave the amount blank for an amount-needed reminder, then enter the payment when you confirm it.</p>}</>}
    {!scheduled&&!card&&<label className="compact-field">Category for future payments<Choice label="Loan payment category" value={draft.categoryId||'unassigned'} options={[{value:'unassigned',label:'Choose a category'},...plan.data.categories.filter(category=>!category.archived||category.id===draft.categoryId).map(category=>({value:category.id,label:category.name}))]} onChange={categoryId=>edit({categoryId:categoryId==='unassigned'?'':categoryId})}/></label>}
   </section>
   <details className="loan-additional"><summary>More details</summary>
    <div className="loan-form-grid">{!card&&<><CurrencyInput label="Original principal (optional)" value={amounts.original} onChange={value=>moneyEdit('original',value)} placeholder="Optional"/><label className="compact-field">Interest estimate<Choice label="Loan interest method" value={debt.interestMethod} options={[{value:'monthly',label:'Monthly'},{value:'daily',label:'Daily simple'},{value:'statement',label:'Statement only'}]} onChange={interestMethod=>editDebt({interestMethod:interestMethod as Debt['interestMethod']})}/></label></>}
    {!card&&type!=='mortgage'&&<CurrencyInput label="Fees included in each payment" value={amounts.other} onChange={value=>moneyEdit('other',value)}/>}
    {scheduled&&<><label className="compact-field">Repeat by<Choice label="Loan payment frequency" value={draft.frequency} options={[{value:'monthly-day',label:'Day of month'},{value:'monthly-weekday',label:'Weekday of month'}]} onChange={frequency=>edit({frequency:frequency as Recurring['frequency']})}/></label><div className="compact-field"><DateInput label="Starts on" clearable value={draft.startDate||''} onValueChange={startDate=>edit({startDate:startDate||undefined})}/></div><label className="compact-field">Ends<Choice label="Loan schedule end" value={endMode} options={[{value:'never',label:'No end date'},{value:'date',label:'On a date'},{value:'count',label:'After installments'}]} onChange={value=>{setEndMode(value);edit({endDate:value==='date'?draft.endDate:undefined,installments:value==='count'?draft.installments||6:undefined,startDate:value==='count'?draft.startDate||plan.id+'-01':draft.startDate});}}/></label>
    {endMode==='date'&&<div className="compact-field"><DateInput label="Last eligible date" required value={draft.endDate||''} onValueChange={endDate=>edit({endDate:endDate||undefined})}/></div>}{endMode==='count'&&<label className="compact-field">Number of payments<NumericInput min={1} max={600} value={draft.installments??NaN} onValueChange={installments=>edit({installments})}/></label>}
    {card&&<label className="compact-field">Separate due day (optional)<NumericInput optional min={1} max={31} value={draft.paymentDueDay??null} onValueChange={paymentDueDay=>edit({paymentDueDay:paymentDueDay??undefined})}/></label>}</>}
    </div>{endMode==='count'&&scheduled&&<p className="field-hint">Counts scheduled installments, not payments you have confirmed. Missed payments do not extend this schedule.</p>}
    {!card&&<p className="field-hint">Payoff is an estimate at a constant rate. Refresh the statement balance when terms, fees or capitalized interest change.</p>}
    <label className="inline-check"><input type="checkbox" checked={draft.active} onChange={event=>edit({active:event.target.checked})}/>Enabled in this plan</label>
   </details>
  </fieldset>{operation.error&&<p role="alert" className="error">{operation.error}</p>}</div>
  <DialogFooter className="loan-builder-actions">{previous&&!previous.deleted&&!draftMode&&<Button variant="ghost" className="delete-item" disabled={locked} onClick={()=>void save({kind:'recurring',month:plan.id,previous,item:{...previous,deleted:true,active:false},...(!plan.version?{initial:plan.data}:{})})}>Delete</Button>}<Button variant="ghost" disabled={locked} onClick={cancel}>Cancel</Button><Button disabled={operation.busy} onClick={()=>void save(operation.pending||undefined)}>{operation.busy?'Saving…':operation.pending?'Retry save':previous?.deleted?'Restore':draftMode?'Keep changes':'Save'}</Button></DialogFooter>
 </DialogContent></Dialog>;
}
