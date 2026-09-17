"use client";
import {IncomePlanEditor} from './budget-income';
import {DateInput} from './date-input';
import {formatDate} from '@/lib/life/date-display';
import NumericInput from './numeric-input';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {recurringSchema,parseMoney,type Budget,type Saved} from '@/lib/life/modules';
import {isAdvancedSchedule} from '@/lib/life/budget-schedule';
import {isAnnualExpense} from '@/lib/life/annual-fund';
import {loanPreset} from '@/lib/life/loan-presets';
import LoanDialog from './loan-builder';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import {Choice} from './shared';
import {CurrencyInput,useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';
type Recurring=Budget['recurring'][number];
export const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const weeks=['first','second','third','fourth','last'] as const;
const titleCase=(value:string)=>value[0].toUpperCase()+value.slice(1);
export function recurringDescription(item:Recurring){
 let repeat=item.frequency==='annual'?`Every year on ${String(item.month).padStart(2,'0')}/${String(item.day).padStart(2,'0')}`:item.frequency==='monthly-weekday'?`${titleCase(item.week)} ${weekdays[item.weekday]} each month`:`Day ${item.day} each month`;
 if(item.frequency==='weekly'||item.frequency==='biweekly')repeat=item.frequency==='weekly'?'Every week':'Every 2 weeks';
 if(item.frequency==='custom'&&item.custom){const c=item.custom;repeat=`Every ${c.interval} ${c.unit}`+(c.unit==='weeks'?` · ${(c.weekdays||[]).map(day=>weekdays[day]).join(', ')}`:c.unit==='months'?` · ${c.days?.length?'days '+c.days.join(', '):(c.weekdayRules||[]).map(rule=>`${titleCase(rule.week)} ${weekdays[rule.weekday]}`).join(', ')}`:` on ${String(item.month).padStart(2,'0')}/${String(item.day).padStart(2,'0')}`);}
 return repeat+(item.startDate?' · from '+formatDate(item.startDate):'')+(item.endDate?' · until '+formatDate(item.endDate):'')+(item.installments?' · '+item.installments+' payments':'');
}
function CustomSchedule({item,onChange,defaultMonth}:{item:Recurring;onChange:(patch:Partial<Recurring>)=>void;defaultMonth:number}){
 const custom=item.custom!;
 const set=(patch:Partial<NonNullable<Recurring['custom']>>)=>onChange({custom:{...custom,...patch}});
 const weekOptions=weeks.map(value=>({value,label:titleCase(value)}));
 return <div className="recurring-custom"><div className="form-grid"><label className="compact-field">Repeat every<NumericInput aria-label="Custom repeat interval" min={1} max={60} value={custom.interval} onValueChange={interval=>set({interval})}/></label><label className="compact-field">Unit<Choice label="Custom repeat unit" value={custom.unit} options={[{value:'weeks',label:'Weeks'},{value:'months',label:'Months'},{value:'years',label:'Years'}]} onChange={unit=>onChange({custom:{unit:unit as typeof custom.unit,interval:custom.interval,...(unit==='weeks'?{weekdays:[1]}:unit==='months'?{days:[item.day]}:{})},month:unit==='years'?item.month??defaultMonth:undefined})}/></label></div>
 {custom.unit==='weeks'&&<fieldset className="recurring-weekdays"><legend>Repeat on</legend>{weekdays.map((name,day)=><label className="inline-check" key={name}><input type="checkbox" checked={custom.weekdays?.includes(day)||false} onChange={event=>set({weekdays:event.target.checked?[...(custom.weekdays||[]),day].sort((a,b)=>a-b):(custom.weekdays||[]).filter(value=>value!==day)})}/>{name.slice(0,3)}</label>)}</fieldset>}
 {custom.unit==='months'&&<><label className="compact-field">Which dates<Choice label="Custom monthly dates" value={custom.weekdayRules?'weekdays':'days'} options={[{value:'days',label:'Days of month'},{value:'weekdays',label:'Weekdays of month'}]} onChange={mode=>onChange({custom:{unit:'months',interval:custom.interval,...(mode==='days'?{days:[item.day]}:{weekdayRules:[{week:'first',weekday:1}]})}})}/></label>
 {custom.days?.map((day,index)=><div className="recurring-custom-row" key={index}><label className="compact-field">Day {index+1}<NumericInput aria-label={`Recurring day ${index+1}`} min={1} max={31} value={day} onValueChange={value=>set({days:custom.days!.map((other,i)=>i===index?value:other)})}/></label><Button variant="ghost" aria-label={`Remove recurring day ${index+1}`} disabled={custom.days!.length<=1} onClick={()=>set({days:custom.days!.filter((_,i)=>i!==index)})}>Remove</Button></div>)}
 {custom.days&&custom.days.length<31&&<Button variant="ghost" onClick={()=>set({days:[...custom.days!,Array.from({length:31},(_,i)=>i+1).find(day=>!custom.days!.includes(day))||1]})}>+ Add day</Button>}
 {custom.weekdayRules?.map((rule,index)=><div className="recurring-custom-row recurring-weekday-rule" key={index}><label className="compact-field">Week<Choice label={`Pattern ${index+1} week`} value={rule.week} options={weekOptions} onChange={week=>set({weekdayRules:custom.weekdayRules!.map((other,i)=>i===index?{...other,week:week as typeof rule.week}:other)})}/></label><label className="compact-field">Weekday<Choice label={`Pattern ${index+1} weekday`} value={String(rule.weekday)} options={weekdays.map((label,i)=>({value:String(i),label}))} onChange={weekday=>set({weekdayRules:custom.weekdayRules!.map((other,i)=>i===index?{...other,weekday:Number(weekday)}:other)})}/></label><Button variant="ghost" aria-label={`Remove weekday pattern ${index+1}`} disabled={custom.weekdayRules!.length<=1} onClick={()=>set({weekdayRules:custom.weekdayRules!.filter((_,i)=>i!==index)})}>Remove</Button></div>)}
 {custom.weekdayRules&&custom.weekdayRules.length<10&&<Button variant="ghost" onClick={()=>set({weekdayRules:[...custom.weekdayRules!,{week:'last',weekday:5}]})}>+ Add weekday</Button>}
 <p className="field-hint">For example, days 1 and 15, or the first Monday and last Friday. Dates beyond a month’s length use its final day.</p></>}
 {custom.unit==='years'&&<p className="field-hint">The full amount appears only in eligible years, on the month and day above.</p>}
 </div>;
}
export default function RecurringDialog({item,previous,plan,onSave,onClose,onDirty,draftMode=false,annualFundEnabled=false}:{draftMode?:boolean;annualFundEnabled?:boolean;item:Recurring;previous:Recurring|null;plan:Saved<Budget>;onSave:(change:BudgetItemChange)=>Promise<Saved<Budget>>;onClose:()=>void;onDirty:DirtyReporter}){
 const [draft,setDraft]=useState(item),[amount,setAmount]=useState(item.amountCents?(item.amountCents/100).toFixed(2):'');
 const [endMode,setEndMode]=useState(item.installments?'count':item.endDate?'date':'never');
 const operation=useItemSave(onSave),dirty=JSON.stringify(draft)!==JSON.stringify(item)||amount!==(item.amountCents?(item.amountCents/100).toFixed(2):'');
 useBudgetDirty('recurring-dialog',dirty||operation.busy||!!operation.pending,onDirty);
 function edit(patch:Partial<Recurring>){setDraft({...draft,...patch});operation.setError('');}
 function frequencyChanged(frequency:string){edit({frequency:frequency as Recurring['frequency'],custom:frequency==='custom'?draft.custom||{unit:'months',interval:1,days:[draft.day]}:undefined,month:frequency==='annual'||frequency==='custom'&&draft.custom?.unit==='years'?draft.month??Number(plan.id.slice(5,7)):undefined,paymentDueDay:['monthly-day','monthly-weekday'].includes(frequency)?draft.paymentDueDay:undefined});}
 async function save(change?:BudgetItemChange){
  try{
   // Saved-record deletion and exact retries must not validate or commit the
   // current form draft. It may contain an intentionally unfinished amount.
   let mutation=change;
   if(!mutation){
    if(endMode==='date'&&!draft.endDate)throw Error('Choose the final eligible date.');
    const cents=draft.kind==='transfer'&&!amount.trim()?0:parseMoney(amount);
    mutation={kind:'recurring',month:plan.id,previous,item:recurringSchema.parse({...draft,amountCents:cents,variable:draft.kind==='transfer'&&cents===0?true:draft.variable}),...(!plan.version?{initial:plan.data}:{})};
   }
   if(await operation.submit(mutation))onClose();
  }
  catch(e){operation.setError(e instanceof Error&&'issues' in e?((e as unknown as {issues:{message:string}[]}).issues[0]?.message||'Check the schedule details.'):'Enter a valid amount and schedule.');}
 }
 if(draft.debt)return <LoanDialog item={draft} previous={previous} plan={plan} onSave={onSave} onClose={onClose} onDirty={onDirty} draftMode={draftMode} initialAmount={amount}/>;
 return <Dialog open onOpenChange={open=>{if(!open&&!operation.busy&&!operation.pending)onClose();}}><DialogContent className="recurring-dialog" showCloseButton={!operation.busy&&!operation.pending} onInteractOutside={e=>e.preventDefault()}>
 <DialogHeader><DialogTitle>{previous?.deleted?'Restore recurring item':previous?'Edit recurring item':draft.debt?'Add loan':'Add recurring item'}</DialogTitle><DialogDescription>Set the amount and when it repeats. {draftMode?'Review these values before adding them to your budget.':previous?'Changes apply to this month and future months copied from it.':'This schedule is saved with this month’s plan and carried into future plans.'}</DialogDescription></DialogHeader>
 <div className="recurring-dialog-body"><fieldset disabled={operation.busy||!!operation.pending}><label className="compact-field">Name<input maxLength={100} value={draft.title} placeholder="e.g. Electric bill" onChange={e=>edit({title:e.target.value})}/></label>
 <div className="form-grid"><label className="compact-field">Type<Choice label="Recurring type" value={draft.kind} options={[{value:'expense',label:'Expense'},{value:'income',label:'Income'},{value:'transfer',label:'Credit card payment'}]} onChange={kind=>edit({debt:kind==='expense'?draft.debt:undefined,incomePlan:kind==='income'?draft.incomePlan:undefined,paymentDueDay:kind==='transfer'?draft.paymentDueDay:undefined,kind:kind as Recurring['kind'],categoryId:kind==='expense'&&!draftMode?plan.data.categories.find(c=>!c.archived)?.id||'':''})}/></label>
 <CurrencyInput label={draft.kind==='transfer'?'Estimated payment (optional)':draft.incomePlan?'Gross amount':draft.frequency==='annual'?(draft.variable?'Estimated annual amount':'Annual amount'):draft.variable?'Estimated amount':'Amount'} value={amount} onChange={setAmount}/></div>
 {draft.kind==='transfer'&&<p className="field-hint">Leave the estimate blank for an amount-needed reminder. Confirm the payment after moving the money; it is a transfer, so card purchases are not counted as expenses twice.</p>}
 <label className="inline-check"><input type="checkbox" checked={draft.variable} onChange={e=>edit({variable:e.target.checked})}/>The actual amount varies</label>{draft.variable&&<p className="field-hint">Use your best estimate. We’ll remind you to enter the actual amount when it’s due.</p>}
 {draft.kind==='income'&&<label className="inline-check"><input type="checkbox" checked={!!draft.incomePlan} onChange={e=>edit({incomePlan:e.target.checked?{withholdings:[]}:undefined})}/>Withholdings &amp; payday targets</label>}{draft.kind==='income'&&draft.incomePlan&&<IncomePlanEditor plan={draft.incomePlan} grossCents={Math.round(Number(amount)*100)} onChange={incomePlan=>edit({incomePlan})}/>}
 <div className="form-grid"><label className="compact-field">Repeat by<Choice label="Recurring frequency" value={draft.frequency} options={[{value:'monthly-day',label:'Day of month'},{value:'monthly-weekday',label:'Weekday of month'},...(!draft.debt?[{value:'weekly',label:'Weekly'},{value:'biweekly',label:'Every 2 weeks'},{value:'annual',label:'Yearly'},{value:'custom',label:'Custom'}]:[])]} onChange={frequencyChanged}/></label>
 {(draft.frequency==='annual'||draft.frequency==='custom'&&draft.custom?.unit==='years')&&<label className="compact-field">Month<Choice label="Annual charge month" value={String(draft.month??Number(plan.id.slice(5,7)))} options={months.map((label,index)=>({value:String(index+1),label}))} onChange={month=>edit({month:Number(month)})}/></label>}
 {(draft.frequency==='monthly-day'||draft.frequency==='annual'||draft.frequency==='custom'&&draft.custom?.unit==='years')&&<label className="compact-field">Day<NumericInput min={1} max={31} value={draft.day} onValueChange={day=>edit({day})}/></label>}
 {draft.frequency==='monthly-weekday'&&<><label className="compact-field">Which week<Choice label="Recurring week" value={draft.week} options={weeks.map(value=>({value,label:titleCase(value)}))} onChange={week=>edit({week:week as Recurring['week']})}/></label><label className="compact-field">Weekday<Choice label="Recurring weekday" value={String(draft.weekday)} options={weekdays.map((label,i)=>({value:String(i),label}))} onChange={weekday=>edit({weekday:Number(weekday)})}/></label></>}
 {draft.kind==='transfer'&&['monthly-day','monthly-weekday'].includes(draft.frequency)&&<label className="compact-field">Payment due day (optional)<NumericInput min={1} max={31} optional value={draft.paymentDueDay??null} onValueChange={paymentDueDay=>edit({paymentDueDay:paymentDueDay??undefined})}/></label>}
 {draft.kind==='expense'&&<label className="compact-field">Category<Choice label="Recurring category" value={draft.categoryId||'unassigned'} options={[...(draftMode?[{value:'unassigned',label:'Choose a category'}]:[]),...plan.data.categories.filter(c=>!c.archived||c.id===draft.categoryId).map(c=>({value:c.id,label:c.name}))]} onChange={categoryId=>edit({categoryId:categoryId==='unassigned'?'':categoryId})}/></label>}</div>
 {draft.frequency==='custom'&&draft.custom&&<CustomSchedule item={draft} onChange={edit} defaultMonth={Number(plan.id.slice(5,7))}/>}
 {draft.frequency==='annual'&&<p className="field-hint">The full yearly charge appears in {months[(draft.month??Number(plan.id.slice(5,7)))-1]} only. Dates beyond that month’s length use its final day.</p>}
 {isAnnualExpense(draft)&&(annualFundEnabled||draft.excludeFromAnnualFund!==undefined)&&<label className="inline-check"><input type="checkbox" checked={!draft.excludeFromAnnualFund} onChange={event=>edit({excludeFromAnnualFund:!event.target.checked})}/>Include in the annual bills fund target</label>}
 {(draft.frequency==='weekly'||draft.frequency==='biweekly')&&<p className="field-hint">The start date sets the weekday and the first payment.</p>}
 {draft.paymentDueDay&&<p className="field-hint">The recurring day is your statement or reminder date. The separate payment due day is shown with it.</p>}
 <div className="form-grid recurring-schedule-limits"><div className="compact-field"><DateInput label={isAdvancedSchedule(draft)?'First occurrence / starts on':'Starts on'} required={isAdvancedSchedule(draft)} clearable={!isAdvancedSchedule(draft)} value={draft.startDate||''} onValueChange={startDate=>edit({startDate:startDate||undefined})}/></div><label className="compact-field">Ends<Choice label="Schedule end" value={endMode} options={[{value:'never',label:'No end date'},{value:'date',label:'On a date'},{value:'count',label:'After installments'}]} onChange={value=>{setEndMode(value);edit({endDate:value==='date'?draft.endDate||plan.id+'-28':undefined,installments:value==='count'?draft.installments||6:undefined,startDate:value==='count'?draft.startDate||plan.id+'-01':draft.startDate});}}/></label>
 {endMode==='date'&&<div className="compact-field"><DateInput label="Last eligible date" required value={draft.endDate||''} onValueChange={endDate=>edit({endDate:endDate||undefined})}/></div>}{endMode==='count'&&<label className="compact-field">Number of payments<NumericInput min={1} max={600} value={draft.installments??NaN} onValueChange={installments=>edit({installments})}/></label>}</div>
 {endMode==='count'&&<p className="field-hint">Counts scheduled payments from the first due date on or after the start. Missed payments do not extend the schedule.</p>}
 {draft.kind==='expense'&&['monthly-day','monthly-weekday'].includes(draft.frequency)&&<label className="inline-check"><input type="checkbox" checked={false} onChange={event=>{if(event.target.checked)edit({debt:{...loanPreset('other',plan.id+'-01'),paymentStatus:amount.trim()?'scheduled':'balance-only'}});}}/>Track as a loan or debt</label>}
 <label className="inline-check"><input type="checkbox" checked={draft.active} onChange={e=>edit({active:e.target.checked})}/> {draft.frequency==='annual'?'Yearly item enabled':'Active this month'}</label></fieldset>
 {operation.error&&<p role="alert" className="error">{operation.error}</p>}</div>
 <DialogFooter className="item-dialog-actions">{previous&&!previous.deleted&&!draftMode&&<Button variant="ghost" className="delete-item" disabled={operation.busy||!!operation.pending} onClick={()=>void save({kind:'recurring',month:plan.id,previous,item:{...previous,deleted:true,active:false},...(!plan.version?{initial:plan.data}:{})})}>Delete item</Button>}<Button variant="ghost" disabled={operation.busy||!!operation.pending} onClick={onClose}>Cancel</Button><Button disabled={operation.busy} onClick={()=>void save(operation.pending||undefined)}>{operation.busy?'Saving…':operation.pending?'Retry save':previous?.deleted?'Restore item':draftMode?'Keep changes':'Save'}</Button></DialogFooter>
 </DialogContent></Dialog>;
}
