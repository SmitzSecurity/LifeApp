"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {Camera,Paperclip,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {formatMonth,isCalendarDate} from '@/lib/life/date-display';
import {BUDGET_TEXT_LIMIT} from '@/lib/life/budget-build-schema';
import type {TransactionBuildResult} from '@/lib/life/transaction-build-schema';
import {addTransactionReviewCategory,beginTransactionReview,editTransactionReviewRow,reviewMonthPlan,transactionReviewCategories,transactionReviewRecords,type TransactionReview,type TransactionReviewMonth,type TransactionReviewRow} from '@/lib/life/transaction-review';
import {type Budget,type Saved,type Transaction} from '@/lib/life/modules';
import {BUDGET_FILE_ACCEPT,budgetAttachmentText,prepareBudgetFile,type BudgetAttachment} from './budget-file';
import {CurrencyInput,useBudgetDirty,definiteBudgetRejection,type DirtyReporter} from './budget-fields';
import {TransactionEditor,blankTransaction} from './budget-transactions';
import {Choice,request} from './shared';
import {DateInput} from './date-input';
import {useAIStatus} from './use-ai-status';
import './transaction-window.css';

type Build={id:string;month?:string;intent?:string;status:string;deleted?:boolean;adopted?:boolean;errorCode?:string|null;resolvedBlocker?:boolean;result:TransactionBuildResult|null};
type BuildInput={requestId:string;text:string;month:string;intent:'transactions';consent:true;image?:BudgetAttachment['image'];document?:BudgetAttachment['document']};
type ImportInput={requestId:string;buildId:string;months:{month:string;initial:Budget;categories:Budget['categories']}[];transactions:Saved<Transaction>[]};
type ImportResult={records:Saved<Transaction>[];plans:Saved<Budget>[];alreadyImported?:boolean;missingTransactionIds?:string[]};
type Props={plan:Saved<Budget>;today:string;annualFundEnabled?:boolean;onSaveTransaction:(record:Saved<Transaction>)=>Promise<Saved<Transaction>>;onImported:(result:ImportResult)=>void;onClose:()=>void;onDirty:DirtyReporter};
const kinds=[{value:'expense',label:'Expense'},{value:'income',label:'Income'},{value:'transfer',label:'Card payment / transfer'}];
function buildFailure(build:Build){
 if(build.errorCode==='input_preflight_rejected')return 'The file could not be read. Try a supported file or a smaller statement section.';
 if(build.errorCode==='provider_request_rejected')return 'The AI service rejected this request before generation. Nothing was added.';
 if(build.errorCode==='budget_output_truncated')return 'The statement was too long. Try a smaller section, up to 50 transactions at a time.';
 return 'AI could not produce a valid transaction draft. Nothing was added. Try a clearer image or a smaller statement section.';
}

export default function TransactionWindow({plan,today,annualFundEnabled,onSaveTransaction,onImported,onClose,onDirty}:Props){
 const [mode,setMode]=useState<'manual'|'ai'>('manual'),[manual]=useState(()=>blankTransaction(plan.id===today.slice(0,7)?today:plan.id+'-01')),[manualLocked,setManualLocked]=useState(false),[manualDirty,setManualDirty]=useState(false);
 const [text,setText]=useState(''),[attachment,setAttachment]=useState<BudgetAttachment>(),[preparing,setPreparing]=useState(false),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[saving,setSaving]=useState(false);
 const [builds,setBuilds]=useState<Build[]>([]),[loaded,setLoaded]=useState(false),[available,setAvailable]=useState(false),[blockedReason,setBlockedReason]=useState(''),[pending,setPending]=useState<BuildInput|null>(null),[pendingImport,setPendingImport]=useState<ImportInput|null>(null),[error,setError]=useState('');
 const [draft,setDraft]=useState<TransactionReview|null>(null),[newCategory,setNewCategory]=useState<{rowId:string;name:string;amount:string}|null>(null),[removing,setRemoving]=useState(false),[pendingRemoval,setPendingRemoval]=useState<string|null>(null);
 const mounted=useRef(true),generation=useRef<object|null>(null),reviewGeneration=useRef<object|null>(null),pendingRef=useRef<BuildInput|null>(null),reviewed=useRef<string|null>(null),plans=useRef<Saved<Budget>[]>([]),camera=useRef<HTMLInputElement>(null),files=useRef<HTMLInputElement>(null),writeLock=useRef(false);
 const locked=busy||preparing||reading||saving||removing||!!pending||!!pendingImport||!!pendingRemoval,closeLocked=manualLocked||saving||removing||!!pendingImport||!!pendingRemoval;
 const childDirty:DirtyReporter=useCallback((_id,value)=>setManualDirty(value),[]);
 useBudgetDirty('transaction-window',manualDirty||locked||!!text||!!attachment||!!draft,onDirty);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current=null;reviewGeneration.current=null;};},[]);
 const status=useAIStatus<{builds:Build[];available:boolean;blockedReason?:string}>({
  scope:'transactions:'+plan.id,load:()=>request('?budget-builds&summary=1'),active:!!pending,
  shouldPoll:data=>data.builds.some(build=>build.status==='generating'&&!build.resolvedBlocker),
  onData:data=>{
   setBuilds(data.builds);setAvailable(data.available);setBlockedReason(data.blockedReason||'');setLoaded(true);
   const build=data.builds.find(build=>build.id===pendingRef.current?.requestId&&build.intent==='transactions');
   if(build&&build.status!=='generating'){
    generation.current=null;pendingRef.current=null;setPending(null);setBusy(false);
    if(build.result&&reviewed.current!==build.id){reviewed.current=build.id;void review(build);}else if(build.status==='failed')setError(buildFailure(build));
   }
  },
 });
 function close(){if(closeLocked)return;mounted.current=false;generation.current=null;reviewGeneration.current=null;status.stop();onClose();}
 async function attach(file:File){
  setMode('ai');setPreparing(true);setError('');
  try{const prepared=await prepareBudgetFile(file);if(mounted.current)setAttachment(prepared);}
  catch(e){if(mounted.current)setError((e as Error).message);}
  finally{if(mounted.current)setPreparing(false);}
 }
 async function review(build:Build){
  if(!build.result)return;
  const ticket={};reviewGeneration.current=ticket;setReading(true);setError('');setMode('ai');
  try{
   const history=await request('?kind=budget');if(!mounted.current||ticket!==reviewGeneration.current)return;
   plans.current=history.records;
   const monthIds=[...new Set(build.result.transactions.flatMap(row=>row.date?[row.date.slice(0,7)]:[]))];
   const entries=await Promise.all(monthIds.map(async month=>{
    const [saved,transactions]=await Promise.all([request('?kind=budget&month='+month),request('?kind=transaction&month='+month)]);
    const savedPlan=saved.records[0] as Saved<Budget>|undefined;
    if(savedPlan)plans.current=[...plans.current.filter(item=>item.id!==month),savedPlan];
    return [month,{plan:reviewMonthPlan(month,plans.current,plan),transactions:transactions.records,categories:[]}] as [string,TransactionReviewMonth];
   }));
   if(!mounted.current||ticket!==reviewGeneration.current)return;
   setDraft(beginTransactionReview(build.id,build.result,Object.fromEntries(entries)));setNewCategory(null);
  }catch(e){if(mounted.current&&ticket===reviewGeneration.current){reviewed.current=null;setError((e as Error).message);}}
  finally{if(mounted.current&&ticket===reviewGeneration.current)setReading(false);}
 }
 async function generate(){
  if(writeLock.current)return;
  const retrying=!!pending;
  let input:BuildInput;
  try{input=pending||{requestId:crypto.randomUUID(),text:budgetAttachmentText(text,attachment),month:plan.id,intent:'transactions',consent:true,...(attachment?.image?{image:attachment.image}:{}),...(attachment?.document?{document:attachment.document}:{})};}
  catch(e){setError((e as Error).message);return;}
  const ticket={};generation.current=ticket;writeLock.current=true;pendingRef.current=input;setPending(input);setBusy(true);setError('');
  try{
   const result=await request('?budget-build',{action:'budget-build',build:input});
   if(!mounted.current||ticket!==generation.current)return;
   const build=result.build as Build;setBuilds(old=>[build,...old.filter(item=>item.id!==build.id)]);
   if(build.status!=='generating'){pendingRef.current=null;setPending(null);}
   if(build.result&&reviewed.current!==build.id){reviewed.current=build.id;void review(build);}else if(build.status==='failed')setError(buildFailure(build));
  }catch(e){if(mounted.current&&ticket===generation.current){setError((e as Error).message);const code=(e as {status?:number}).status;if(definiteBudgetRejection(code,retrying)){pendingRef.current=null;setPending(null);}}}
  finally{writeLock.current=false;if(mounted.current&&ticket===generation.current){setBusy(false);void status.check();}}
 }
 function editRow(id:string,patch:Partial<TransactionReviewRow>){
  setDraft(current=>current?editTransactionReviewRow(current,id,patch):current);setError('');
 }
 async function changeDate(row:TransactionReviewRow,date:string){
  if(!draft||!isCalendarDate(date)||date<'1900-01-01'||date>today)return;const monthId=date.slice(0,7),ticket={};reviewGeneration.current=ticket;
  editRow(row.id,{date,categoryId:''});setNewCategory(null);
  if(draft.months[monthId]){setReading(false);return;}
  setReading(true);
  try{
   const [saved,transactions]=await Promise.all([request('?kind=budget&month='+monthId),request('?kind=transaction&month='+monthId)]);
   if(!mounted.current||ticket!==reviewGeneration.current)return;
   if(saved.records[0])plans.current=[...plans.current.filter(item=>item.id!==monthId),saved.records[0]];
   const month:TransactionReviewMonth={plan:reviewMonthPlan(monthId,plans.current,plan),transactions:transactions.records,categories:[]};
   setDraft(current=>current?editTransactionReviewRow({...current,months:{...current.months,[monthId]:month}},row.id,{}):current);
  }catch(e){if(mounted.current&&ticket===reviewGeneration.current)setError((e as Error).message);}
  finally{if(mounted.current&&ticket===reviewGeneration.current)setReading(false);}
 }
 function addCategory(){if(!draft||!newCategory)return;try{setDraft(addTransactionReviewCategory(draft,newCategory.rowId,newCategory.name,newCategory.amount));setNewCategory(null);setError('');}catch(e){setError((e as Error).message);}}
 async function removeBuild(buildId:string){
  if(writeLock.current)return;
  const retrying=!!pendingRemoval,id=pendingRemoval||buildId;
  if(!pendingRemoval&&!builds.some(build=>build.id===id&&['complete','failed'].includes(build.status)))return;
  writeLock.current=true;setPendingRemoval(id);setRemoving(true);setError('');
  try{
   await request('',{action:'record-deletion',change:{kind:'build',id:'budget:'+id,deleted:true}});
   if(!mounted.current)return;
   setPendingRemoval(null);setBuilds(current=>current.map(build=>build.id===id?{...build,deleted:true}:build));void status.check();
  }catch(e){if(mounted.current){setError((e as Error).message);const code=(e as {status?:number}).status;if(definiteBudgetRejection(code,retrying))setPendingRemoval(null);}}
  finally{writeLock.current=false;if(mounted.current)setRemoving(false);}
 }
 async function save(){
  if(!draft||writeLock.current)return;
  const retrying=!!pendingImport;
  let input:ImportInput;
  try{
   if(pendingImport)input=pendingImport;
   else{
    const transactions=transactionReviewRecords(draft,today);if(!transactions.length)throw Error('Select at least one transaction to add.');
    const months=[...new Set(transactions.map(record=>record.data.date.slice(0,7)))].map(month=>({month,initial:{currency:'USD' as const,categories:draft.months[month].plan.data.categories.map(category=>({...category,limitCents:0})),recurring:[],goals:{spending:'',saving:'',investing:''}},categories:draft.months[month].categories}));
    input={requestId:crypto.randomUUID(),buildId:draft.buildId,months,transactions};
   }
  }catch(e){setError((e as Error).message);return;}
  writeLock.current=true;setPendingImport(input);setSaving(true);setError('');
  try{const result=await request('?transaction-import',{action:'transaction-import',import:input}) as ImportResult;if(!mounted.current)return;setPendingImport(null);onImported(result);onClose();}
  catch(e){if(mounted.current){setError((e as Error).message);const code=(e as {status?:number}).status;if(definiteBudgetRejection(code,retrying))setPendingImport(null);}}
  finally{writeLock.current=false;if(mounted.current)setSaving(false);}
 }
 const visibleBuilds=builds.filter(build=>build.intent==='transactions'&&!build.deleted),unconfirmed=builds.some(build=>['generating','uncertain'].includes(build.status)&&!build.resolvedBlocker),selected=draft?.rows.filter(row=>row.selected&&!row.alreadyAdded)||[];
 const unassigned=selected.filter(row=>row.kind==='expense'&&(!draft?.months[row.date.slice(0,7)]||!transactionReviewCategories(draft.months[row.date.slice(0,7)]).some(category=>category.id===row.categoryId)));
 const alreadyImported=!!draft&&(!!builds.find(build=>build.id===draft.buildId)?.adopted||draft.rows.some(row=>row.alreadyAdded));
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="transaction-window" showCloseButton={!closeLocked} onInteractOutside={event=>event.preventDefault()}>
  <DialogHeader><DialogTitle>{draft?'Review transactions':'Log transactions'}</DialogTitle><DialogDescription>{draft?'Check the dates, amounts and categories before saving.':'Add a transaction, scan a receipt or attach a statement.'}</DialogDescription></DialogHeader>
  {!draft&&<div className="transaction-window-tools"><div className="transaction-entry-modes" aria-label="Entry method"><Button variant={mode==='manual'?'secondary':'ghost'} aria-pressed={mode==='manual'} disabled={locked||manualLocked} onClick={()=>setMode('manual')}>Manual</Button><Button variant={mode==='ai'?'secondary':'ghost'} aria-pressed={mode==='ai'} disabled={locked||manualLocked} onClick={()=>setMode('ai')}>With AI</Button></div><div className="transaction-attachment-actions"><Button variant="ghost" size="icon" aria-label="Take receipt photo" title="Take receipt photo" disabled={locked||manualLocked} onClick={()=>camera.current?.click()}><Camera aria-hidden="true"/></Button><Button variant="ghost" size="icon" aria-label="Attach transaction file" title="Attach file" disabled={locked||manualLocked} onClick={()=>files.current?.click()}><Paperclip aria-hidden="true"/></Button></div></div>}
  <input ref={camera} className="transaction-hidden-file" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={event=>{const file=event.target.files?.[0];if(file)void attach(file);event.target.value='';}}/>
  <input ref={files} className="transaction-hidden-file" type="file" accept={BUDGET_FILE_ACCEPT} tabIndex={-1} aria-hidden="true" onChange={event=>{const file=event.target.files?.[0];if(file)void attach(file);event.target.value='';}}/>
  <div className="transaction-window-manual" hidden={mode!=='manual'||!!draft}><TransactionEditor initial={manual} scope={'window:'+manual.id} plan={plan} today={today} annualFundEnabled={annualFundEnabled} onSave={onSaveTransaction} onDirty={childDirty} onLockChange={setManualLocked} onCancel={close} onSaved={onClose}/></div>
  <div className="transaction-window-body" hidden={mode!=='ai'&&!draft}>
   {draft?<>
    {draft.notes&&<p className="transaction-review-notes">{draft.notes}</p>}
    {Object.values(draft.months).some(month=>month.plan.version===0)&&<p className="transaction-field-hint">New months start with category names and no planned allowances or bills.</p>}
    {alreadyImported&&<p className="transaction-review-notice" role="status">This draft has already been added. Open transaction history to edit its saved entries.</p>}
    <fieldset disabled={locked||alreadyImported}>{draft.rows.map((row,index)=>{const month=draft.months[row.date.slice(0,7)],categories=month?transactionReviewCategories(month):[];return <article className={`transaction-review-row${!row.selected?' transaction-review-unselected':''}`} key={row.id}>
     <div className="transaction-review-heading"><label className="transaction-review-check"><input type="checkbox" aria-label={`Include transaction ${index+1}`} checked={row.selected} disabled={row.alreadyAdded} onChange={event=>editRow(row.id,{selected:event.target.checked})}/><strong>Transaction {index+1}</strong></label>{row.date&&<span>{formatMonth(row.date.slice(0,7))}</span>}</div>
     {row.alreadyAdded?<p className="transaction-row-warning">Already added</p>:row.duplicate&&<p className="transaction-row-warning">Possible duplicate</p>}
     {row.warning&&<p className="transaction-row-warning">{row.warning}</p>}
     <div className="transaction-review-fields"><label className="compact-field transaction-review-description">Description<input aria-label={`Transaction ${index+1} description`} maxLength={300} value={row.note} onChange={event=>editRow(row.id,{note:event.target.value})}/></label>
      <div className="compact-field"><DateInput label="Date" aria-label={`Transaction ${index+1} date`} required min="1900-01-01" max={today} value={row.date} onValueChange={date=>void changeDate(row,date)}/></div>
      <CurrencyInput label="Amount" ariaLabel={`Transaction ${index+1} amount`} value={row.amount} onChange={amount=>editRow(row.id,{amount})}/>
      <label className="compact-field">Type<Choice label={`Transaction ${index+1} type`} value={row.kind} options={kinds} onChange={kind=>editRow(row.id,{kind:kind as TransactionReviewRow['kind'],categoryId:''})}/></label>
      {row.kind==='expense'&&<label className="compact-field">Category<Choice label={`Transaction ${index+1} category`} value={row.categoryId||'unassigned'} options={[{value:'unassigned',label:'Choose category'},...categories.map(category=>({value:category.id,label:category.name}))]} onChange={categoryId=>editRow(row.id,{categoryId:categoryId==='unassigned'?'':categoryId})}/></label>}
     </div>
     {row.kind==='expense'&&<Button className="transaction-new-category" variant="ghost" disabled={!month||!!newCategory} onClick={()=>setNewCategory({rowId:row.id,name:'',amount:'0.00'})}>+ New category</Button>}
     {newCategory?.rowId===row.id&&<div className="transaction-category-editor"><label className="compact-field">Category name<input aria-label="New category name" maxLength={100} value={newCategory.name} onChange={event=>setNewCategory({...newCategory,name:event.target.value})}/></label><CurrencyInput label="Monthly allowance" value={newCategory.amount} onChange={amount=>setNewCategory({...newCategory,amount})}/><div className="transaction-category-actions"><Button variant="ghost" onClick={()=>setNewCategory(null)}>Cancel</Button><Button variant="secondary" onClick={addCategory}>Add category</Button></div></div>}
    </article>;})}</fieldset>
    {!draft.rows.length&&<p>No transactions were found. Try a clearer receipt or a smaller statement section.</p>}
    {unassigned.length>0&&!alreadyImported&&<p className="transaction-row-warning">Choose a category for {unassigned.length===1?'the selected expense':`${unassigned.length} selected expenses`}.</p>}
   </>:<>
    <label className="compact-field">{attachment?'Additional notes (optional)':'Transaction details'}<textarea rows={attachment?3:5} maxLength={BUDGET_TEXT_LIMIT} disabled={locked} value={text} onChange={event=>{setText(event.target.value);setError('');}} onPaste={event=>{if(locked)return;const file=Array.from(event.clipboardData.items).find(item=>item.type.startsWith('image/'))?.getAsFile();if(file){event.preventDefault();void attach(file);}}} placeholder={attachment?'Anything to clarify about this receipt or statement…':'Paste transactions here, or use the camera or paperclip above.'}/></label>
    {preparing&&<p role="status">Reading file…</p>}
    {attachment&&<div className="transaction-source-preview"><div><span><strong>{attachment.name}</strong><small>{attachment.kind} · {Math.ceil(attachment.size/1024).toLocaleString()} KB</small></span><Button variant="ghost" size="icon" aria-label="Remove attached file" disabled={locked} onClick={()=>setAttachment(undefined)}><X aria-hidden="true"/></Button></div>{attachment.image&&<Image unoptimized width={160} height={160} style={{width:'auto',height:'auto'}} src={`data:${attachment.image.mimeType};base64,${attachment.image.data}`} alt="Receipt or transaction image attached for review"/>}{attachment.warnings.map(warning=><p key={warning} className="transaction-field-hint">{warning}</p>)}</div>}
    <p className="transaction-field-hint">Receipts, screenshots, PDF statements, text, CSV, Excel or Word files. Up to 50 transactions per draft.</p>
    <p className="transaction-ai-consent">Extract with AI sends your text, attached content and saved category names to Google Gemini. Review everything before it is saved. LifeApp keeps the extracted text and draft, not the original file.</p>
    {loaded&&!available&&<p className="transaction-field-hint">AI extraction is currently unavailable. You can still log a transaction manually.</p>}
    {blockedReason&&<p className="transaction-field-hint">{blockedReason}</p>}
    {visibleBuilds.length>0&&<section className="transaction-saved-drafts"><h3>Saved drafts</h3>{visibleBuilds.map(build=><div key={build.id}><span><strong>{build.month?formatMonth(build.month):'Transactions'}</strong><small>{build.result?`${build.result.transactions.length} transactions`:build.status==='failed'?buildFailure(build):build.resolvedBlocker?'Previous outcome unconfirmed; reviewed.':build.status==='uncertain'?'Outcome unconfirmed. New AI requests are paused.':'Extracting…'}</small></span><div className="transaction-draft-actions">{build.result&&<Button variant="secondary" disabled={locked} onClick={()=>void review(build)}>Review</Button>}{['complete','failed'].includes(build.status)&&<Button variant="ghost" disabled={locked} onClick={()=>void removeBuild(build.id)}>Delete</Button>}</div></div>)}</section>}
   </>}
   {pending&&<p className="transaction-field-hint" role="status">Extracting your transactions… You can close this window; a submitted request may finish in Saved drafts.</p>}
   {reading&&<p className="transaction-field-hint" role="status">Loading categories and checking for duplicates…</p>}
   {status.delayed&&<p className="transaction-field-hint" role="status">This is taking longer than expected. You can close this window and return to Saved drafts later.</p>}
   {status.error&&<p className="error" role="alert">Could not check saved drafts. {status.delayed?'Check your connection and reopen this window.':'Trying again automatically…'}</p>}
   {error&&<p className="error" role="alert">{error}</p>}
  </div>
  {(mode==='ai'||draft)&&<DialogFooter><Button variant="ghost" disabled={closeLocked} onClick={close}>Cancel</Button>{pendingRemoval?<Button disabled={removing} onClick={()=>void removeBuild(pendingRemoval)}>{removing?'Deleting…':'Retry delete'}</Button>:draft?<><Button variant="ghost" disabled={locked} onClick={()=>{reviewGeneration.current=null;setDraft(null);setNewCategory(null);setError('');}}>Back</Button><Button disabled={saving||busy||reading||!pendingImport&&(alreadyImported||!!newCategory||!!unassigned.length||!selected.length)} onClick={()=>void save()}>{saving?'Saving…':pendingImport?'Retry save':`Save ${selected.length===1?'transaction':'transactions'}`}</Button></>:<Button disabled={busy||preparing||reading||manualLocked||!loaded||!available||!!pending&&!status.delayed||!pending&&(!!blockedReason||unconfirmed||text.trim().length<10&&!attachment)} onClick={()=>void generate()}>{busy?'Extracting…':pending?'Retry extraction':'Extract with AI'}</Button>}</DialogFooter>}
 </DialogContent></Dialog>;
}
