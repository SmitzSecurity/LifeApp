"use client";
import {useEffect,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import type {Profile} from '@/lib/life/domain';
import {annualFundTarget,type AnnualFundBalance} from '@/lib/life/annual-fund';
import {money,transactionSchema,type Budget,type Saved,type Transaction} from '@/lib/life/modules';
import {TransactionEditor} from './budget-transactions';
import {useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';
import {request} from './shared';

type Choice={previous:Profile['annualFund']|null;item:{enabled:boolean}};
type Props={profile:Profile;plan:Saved<Budget>;today:string;transactions:Saved<Transaction>[];setup:'offer'|'manage'|null;onSetup:(value:'offer'|'manage'|null)=>void;onProfileSaved:(profile:Profile)=>void;onSave:(record:Saved<Transaction>)=>Promise<Saved<Transaction>>;onDirty:DirtyReporter};
export default function BudgetAnnualFund({profile,plan,today,transactions,setup,onSetup,onProfileSaved,onSave,onDirty}:Props){
 const target=annualFundTarget(plan.data,plan.id),enabled=!!profile.annualFund?.enabled;
 const [refresh,setRefresh]=useState(0),[contribution,setContribution]=useState<Saved<Transaction>|null>(null),[contributionLocked,setContributionLocked]=useState(false);
 const revision=transactions.map(record=>record.id+':'+record.version).sort().join('|');
 const setupOpen=!!setup;
 const readKey=useMemo(()=>({month:plan.id,profileVersion:profile.version,revision,refresh,enabled,setupOpen}),[plan.id,profile.version,revision,refresh,enabled,setupOpen]);
 const [result,setResult]=useState<{key:typeof readKey;balance:AnnualFundBalance|null;error:string}|null>(null);
 const current=result?.key===readKey?result:null,balance=current?.balance??null,error=current?.error??'',reading=(enabled||setupOpen)&&!current;
 useEffect(()=>{
  if(!readKey.enabled&&!readKey.setupOpen)return;
  let cancelled=false;
  request('?annual-fund&month='+readKey.month).then(result=>{if(!cancelled)setResult({key:readKey,balance:result.balance,error:''});}).catch(reason=>{if(!cancelled)setResult({key:readKey,balance:null,error:(reason as Error).message});});
  return()=>{cancelled=true;};
 },[readKey]);
 const setting=useItemSave<Choice,Profile>(async change=>{
  try{const result=await request('',{action:'annual-fund-settings',change});onProfileSaved(result.profile);return result.profile;}
  catch(reason){if((reason as {status?:number}).status===409){try{const latest=(await request('')).profile;if(latest)onProfileSaved(latest);}catch{}}throw reason;}
 });
 const settingsLocked=setting.busy||!!setting.pending;
 useBudgetDirty('annual-fund-settings',settingsLocked,onDirty);
 function closeSetup(){if(!settingsLocked){onSetup(null);setting.setError('');}}
 async function choose(value:boolean){if(await setting.submit(setting.pending||{previous:profile.annualFund||null,item:{enabled:value}}))onSetup(null);}
 function startContribution(){setContribution({id:crypto.randomUUID(),version:0,data:transactionSchema.parse({date:plan.id===today.slice(0,7)?today:plan.id+'-01',kind:'saving',amountCents:Math.max(1,target.monthlyCents),categoryId:'',note:'Annual bills fund contribution',recurringId:null,voided:false,annualFund:'contribution'})});}
 const balanceText=reading?'…':balance?money(balance.balanceCents):'—';
 return <>
 {enabled&&<section className="module-card annual-fund-card"><div className="section-heading"><h3>Annual bills fund</h3><Button variant="ghost" onClick={()=>onSetup('manage')}>Manage</Button></div><div className="annual-fund-summary"><span>Monthly target<strong>{money(target.monthlyCents)}</strong>{target.estimated&&<small>Includes estimates</small>}</span><span>Recorded fund balance<strong className={balance&&balance.balanceCents<0?'negative':undefined}>{balanceText}</strong></span><span>Set aside this month<strong>{reading?'…':balance?money(balance.monthContributionsCents):'—'}</strong></span><Button variant="secondary" disabled={!!contribution||plan.id>today.slice(0,7)} onClick={startContribution}>Record contribution</Button></div><p className="field-hint">{target.items.length} included yearly {target.items.length===1?'bill':'bills'} · {money(target.annualCents)} per year. Only confirmed contributions and payments change this balance.{plan.id>today.slice(0,7)?' Record contributions in the month they happen.':''}</p>{error&&<p className="error" role="alert">Could not load the fund balance. <Button variant="ghost" onClick={()=>setRefresh(value=>value+1)}>Retry</Button></p>}</section>}
 {setup&&<Dialog open onOpenChange={open=>{if(!open)closeSetup();}}><DialogContent className="budget-payment-dialog annual-fund-dialog" showCloseButton={!settingsLocked} onInteractOutside={event=>event.preventDefault()}><DialogHeader><DialogTitle>{setup==='offer'?'Set aside money for annual bills?':'Annual bills fund'}</DialogTitle><DialogDescription>Set a monthly target for your yearly expenses and track money you actually put aside. LifeApp does not move money between accounts.</DialogDescription></DialogHeader><div className="annual-fund-dialog-body"><div className="annual-fund-summary"><span>Monthly target<strong>{money(target.monthlyCents)}</strong></span><span>Included annual bills<strong>{money(target.annualCents)}</strong></span>{setup==='manage'&&<span>Recorded fund balance<strong>{balanceText}</strong></span>}</div><p className="field-hint">{target.estimated?'Some bill amounts are estimates. ':''}The target is the included annual total divided by 12. Each bill keeps its full charge in its renewal month.</p>{target.items.length>0&&<ul className="annual-fund-items">{target.items.map(item=><li key={item.id}><span>{item.title}</span><strong>{money(item.amountCents)}</strong></li>)}</ul>}<p className="field-hint">When enabled, new annual expenses join this fund automatically. You can exclude individual bills in their recurring-item settings. Turning it off preserves your saved history.</p>{error&&<p className="error" role="alert">Could not load the fund balance. <Button variant="ghost" onClick={()=>setRefresh(value=>value+1)}>Retry</Button></p>}{setting.error&&<p className="error" role="alert">{setting.error}</p>}</div><DialogFooter>{setting.pending?<><Button disabled={setting.busy} onClick={()=>void choose(setting.pending!.item.enabled)}>{setting.busy?'Saving…':'Retry choice'}</Button><Button variant="ghost" disabled>Cancel</Button></>:setup==='offer'?<><Button variant="ghost" disabled={setting.busy} onClick={()=>void choose(false)}>Not now</Button><Button disabled={setting.busy} onClick={()=>void choose(true)}>{setting.busy?'Saving…':'Create fund'}</Button></>:<><Button disabled={setting.busy} onClick={()=>void choose(!enabled)}>{setting.busy?'Saving…':enabled?'Turn off fund':'Enable fund'}</Button><Button variant="ghost" disabled={setting.busy} onClick={closeSetup}>Cancel</Button></>}</DialogFooter></DialogContent></Dialog>}
 {contribution&&<Dialog open onOpenChange={open=>{if(!open&&!contributionLocked)setContribution(null);}}><DialogContent className="budget-payment-dialog" showCloseButton={!contributionLocked} onInteractOutside={event=>event.preventDefault()}><DialogHeader><DialogTitle>Record fund contribution</DialogTitle><DialogDescription>Confirm money you have already set aside for annual bills.</DialogDescription></DialogHeader><TransactionEditor initial={contribution} plan={plan} today={today} annualFundEnabled={enabled} confirmation unknownAmount={!target.monthlyCents} scope={'annual-fund:'+contribution.id} onLockChange={setContributionLocked} onSave={onSave} onDirty={onDirty} onCancel={()=>{if(!contributionLocked)setContribution(null);}} onSaved={()=>setContribution(null)}/></DialogContent></Dialog>}
 </>;
}
