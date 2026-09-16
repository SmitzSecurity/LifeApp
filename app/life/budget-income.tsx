"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {calculateIncome,incomePlanError,type IncomePlan,type IncomeRule} from '@/lib/life/income-planning';
import {money,parseMoney} from '@/lib/life/modules';
import {Choice} from './shared';
import NumericInput from './numeric-input';
import {CurrencyInput} from './budget-fields';

function RuleEditor({label,rule,onChange}:{label:string;rule:IncomeRule;onChange:(rule:IncomeRule)=>void}){
 const [amount,setAmount]=useState({source:rule.value,text:rule.mode==='fixed'?(rule.value/100).toFixed(2):''});
 if(!Object.is(amount.source,rule.value))setAmount({source:rule.value,text:Number.isFinite(rule.value)?(rule.value/100).toFixed(2):''});
 return <div className="income-rule-controls"><label className="compact-field">{label}<Choice label={label+' method'} value={rule.mode} options={[{value:'fixed',label:'Fixed amount'},{value:'percent',label:'Percentage'}]} onChange={mode=>{setAmount({source:NaN,text:''});onChange({mode:mode as IncomeRule['mode'],value:NaN});}}/></label>{rule.mode==='fixed'?<CurrencyInput label="Amount" ariaLabel={label+' amount'} value={amount.text} onChange={text=>{let value=NaN;try{value=parseMoney(text);}catch{}setAmount({source:value,text});onChange({mode:'fixed',value});}}/>:<label className="compact-field">Percent<NumericInput aria-label={label+' percent'} min={0} max={100} step={0.01} value={rule.value} onValueChange={value=>onChange({mode:'percent',value})}/></label>}</div>;
}
export function IncomePlanEditor({plan,grossCents,onChange}:{plan:IncomePlan;grossCents:number;onChange:(plan:IncomePlan)=>void}){
 return <div className="income-plan-editor"><p className="field-hint">The income amount is gross pay. Enter your own deductions; percentages use gross pay. LifeApp does not estimate taxes.</p>
 {plan.withholdings.map((item,index)=><div className="income-withholding" key={index}><div className="income-rule-name"><label className="compact-field">Withholding<input maxLength={60} aria-label={'Withholding '+(index+1)+' name'} placeholder="Taxes, benefits…" value={item.name} onChange={e=>onChange({...plan,withholdings:plan.withholdings.map((row,i)=>i===index?{...row,name:e.target.value}:row)})}/></label><Button variant="ghost" aria-label={'Remove withholding '+(index+1)} onClick={()=>onChange({...plan,withholdings:plan.withholdings.filter((_,i)=>i!==index)})}>Remove</Button></div><RuleEditor label={'Withholding '+(index+1)} rule={item.rule} onChange={rule=>onChange({...plan,withholdings:plan.withholdings.map((row,i)=>i===index?{...row,rule}:row)})}/></div>)}
 <Button variant="ghost" disabled={plan.withholdings.length>=8} onClick={()=>onChange({...plan,withholdings:[...plan.withholdings,{name:'',rule:{mode:'fixed',value:0}}]})}>+ Withholding</Button>
 <p className="field-hint">Savings and investment percentages use take-home pay. Confirming income creates planned transfers for you to confirm separately; LifeApp does not move money.</p>
 {(['saving','investing'] as const).map(kind=><div key={kind}><label className="inline-check"><input type="checkbox" checked={!!plan[kind]} onChange={e=>onChange({...plan,[kind]:e.target.checked?{mode:'percent',value:10}:undefined})}/>{kind==='saving'?'Plan savings':'Plan investments'}</label>{plan[kind]&&<RuleEditor label={kind==='saving'?'Savings':'Investments'} rule={plan[kind]!} onChange={rule=>onChange({...plan,[kind]:rule})}/>}</div>)}
 <IncomePreview grossCents={grossCents} plan={plan}/></div>;
}
export function IncomePreview({grossCents,plan}:{grossCents:number;plan:IncomePlan}){
 const result=calculateIncome(grossCents,plan),error=incomePlanError(grossCents,plan);
 if(!Number.isFinite(result.remainingCents)||!grossCents)return null;
 return <div className="income-preview"><dl><div><dt>Gross</dt><dd>{money(result.grossCents)}</dd></div>{result.withholdings.map((item,index)=><div key={index}><dt>{item.name||'Withholding'}</dt><dd>−{money(item.amountCents)}</dd></div>)}<div className="income-net"><dt>Take-home</dt><dd>{money(result.netCents)}</dd></div>{plan.saving&&<div><dt>Planned savings</dt><dd>{money(result.savingCents)}</dd></div>}{plan.investing&&<div><dt>Planned investments</dt><dd>{money(result.investingCents)}</dd></div>}{(plan.saving||plan.investing)&&<div><dt>After planned transfers</dt><dd>{money(result.remainingCents)}</dd></div>}</dl>{error&&<p className="error" role="alert">{error}</p>}</div>;
}
