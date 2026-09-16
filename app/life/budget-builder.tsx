"use client";
import {formatDate,formatMonth} from '@/lib/life/date-display';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {money,type Budget,type Saved} from '@/lib/life/modules';
import {BUDGET_TEXT_LIMIT,type BudgetBuildResult} from '@/lib/life/budget-build-schema';
import {beginBudgetReview,budgetReviewCategories,addBudgetReviewCategory,applyBudgetReviewAllowance,budgetReviewUnassigned,budgetReviewImport,type BudgetReview} from '@/lib/life/budget-build-review';
import {BUDGET_FILE_ACCEPT,budgetAttachmentText,prepareBudgetFile,type BudgetAttachment} from './budget-file';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import {Choice,request} from './shared';
import RecurringDialog,{recurringDescription} from './budget-recurring';
import LoanDialog from './loan-builder';
import {useAIStatus} from './use-ai-status';
import {CurrencyInput,useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';

type Build={id:string;month?:string;intent?:'loans';status:string;deleted?:boolean;errorCode?:string|null;resolvedBlocker?:boolean;result:BudgetBuildResult|null};
type Recovery={sourceId:string;expiresAt:string};
type Input={requestId:string;text:string;month:string;intent?:'loans';consent:true;image?:BudgetAttachment['image'];document?:BudgetAttachment['document'];recoveryOf?:string};
type NewCategory={name:string;amount:string;assignTo?:string};

function LoanSummary({item}:{item:Budget['recurring'][number]}){
 const debt=item.debt!;
 return <><small>{money(debt.balanceCents)} {debt.loanType==='credit-card'?'statement balance':'principal'} · {formatDate(debt.balanceDate)}</small><small>{debt.annualRatePercent===undefined?'Rate unknown':debt.annualRatePercent+'% '+(debt.loanType==='credit-card'?'APR':'interest')}{debt.loanType!=='credit-card'?' · '+(debt.accruedInterestCents===undefined?'Existing unpaid interest not supplied':money(debt.accruedInterestCents)+' existing unpaid interest'):''}</small></>;
}

function failedBuild(build:Build){
 if(build.errorCode==='provider_request_rejected')return 'The AI service rejected the request before generation. Nothing was added. You can try again.';
 if(build.errorCode==='input_preflight_rejected')return 'This input was rejected before generation. Use a supported file or a smaller budget section, then try again.';
 if(build.errorCode==='cost_bound_exceeded')return 'This build exceeded its spending allowance. AI building is paused for review.';
 if(build.errorCode==='budget_output_truncated')return 'The generated draft was too long. Try importing fewer budget sections at once.';
 return 'AI could not produce a valid budget draft. Review the source or try a smaller section; nothing was added.';
}
export default function BudgetBuilder({plan,onSave,onClose,onDirty,intent}:{intent?:'loans';plan:Saved<Budget>;onSave:(change:BudgetItemChange)=>Promise<Saved<Budget>>;onClose:()=>void;onDirty:DirtyReporter}){
 const loanMode=intent==='loans';
 const [text,setText]=useState(''),[attachment,setAttachment]=useState<BudgetAttachment>(),[preparing,setPreparing]=useState(false),[busy,setBusy]=useState(false),[available,setAvailable]=useState(false),[loaded,setLoaded]=useState(false),[builds,setBuilds]=useState<Build[]>([]),[recovery,setRecovery]=useState<Recovery|null>(null),[blockedReason,setBlockedReason]=useState(''),[pending,setPending]=useState<Input|null>(null),[error,setError]=useState(''),[draft,setDraft]=useState<BudgetReview|null>(null),[editing,setEditing]=useState<Budget['recurring'][number]|null>(null),[nestedDirty,setNestedDirty]=useState(false),[newCategory,setNewCategory]=useState<NewCategory|null>(null),[allowanceTargets,setAllowanceTargets]=useState<Record<string,string>>({});
 const operation=useItemSave(onSave),locked=busy||preparing||operation.busy||!!pending||!!operation.pending;
 const mounted=useRef(true),generation=useRef(0),pendingRef=useRef<Input|null>(null),reviewed=useRef<string|null>(null);
 const closeLocked=operation.busy||!!operation.pending||busy&&!pending;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useBudgetDirty('budget-builder',locked||!!text||!!attachment||!!draft||nestedDirty,onDirty);
 const childDirty=useCallback((_id:string,value:boolean)=>setNestedDirty(value),[]);
 const status=useAIStatus<{builds:Build[];available:boolean;recovery?:Recovery;blockedReason?:string}>({
  scope:`budget:${plan.id}:${intent||'budget'}`,load:()=>request('?budget-builds&summary=1'),active:!!pending,
  shouldPoll:data=>data.builds.some(b=>b.status==='generating'&&!b.resolvedBlocker),
  onData:data=>{setBuilds(data.builds);setAvailable(data.available);setRecovery(data.recovery||null);setBlockedReason(data.blockedReason||'');setLoaded(true);
   const build=data.builds.find(b=>b.id===pendingRef.current?.requestId);
   if(build&&!['generating'].includes(build.status)){generation.current++;pendingRef.current=null;setPending(null);setBusy(false);if(build.result)setError('');if(build.result&&reviewed.current!==build.id){reviewed.current=build.id;review(build);}else if(build.status==='failed')setError(old=>old||failedBuild(build));}
  },
 });
 function close(){if(closeLocked)return;mounted.current=false;generation.current++;status.stop();onClose();}
 async function attach(file:File){setPreparing(true);setError('');try{const next=await prepareBudgetFile(file);if(mounted.current)setAttachment(next);}catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setPreparing(false);}}
 async function pasteImage(){setPreparing(true);setError('');try{if(!navigator.clipboard?.read)throw Error('Paste the copied image into the text box, or attach the image file.');const items=await navigator.clipboard.read();const item=items.find(item=>item.types.some(type=>['image/png','image/jpeg','image/webp'].includes(type)));const type=item?.types.find(type=>['image/png','image/jpeg','image/webp'].includes(type));if(!item||!type)throw Error('Copy an image first, then paste again. You can also attach a file.');const blob=await item.getType(type);const next=await prepareBudgetFile(new File([blob],'Pasted image.'+(type==='image/jpeg'?'jpg':type.split('/')[1]),{type}));if(mounted.current)setAttachment(next);}catch(e){if(mounted.current)setError(e instanceof Error&&e.name==='NotAllowedError'?'Clipboard access was not available. Paste the copied image into the text box or attach a file.':(e as Error).message);}finally{if(mounted.current)setPreparing(false);}}
 function review(build:Build){
  if(!build.result)return;
  setDraft(beginBudgetReview(build.result,plan.data));setNewCategory(null);setAllowanceTargets({});setError('');operation.setError('');
 }
 async function generate(){
  let input:Input;try{input=pending||{requestId:crypto.randomUUID(),text:budgetAttachmentText(text,attachment),month:plan.id,...(intent?{intent}:{}),consent:true as const,...(attachment?.image?{image:attachment.image}:{}),...(attachment?.document?{document:attachment.document}:{}),...(recovery?{recoveryOf:recovery.sourceId}:{})};}catch(e){setError((e as Error).message);return;}
  const ticket=++generation.current;pendingRef.current=input;setPending(input);setBusy(true);setError('');
  try{const result=await request('?budget-build',{action:'budget-build',build:input});if(!mounted.current||ticket!==generation.current)return;setBuilds(old=>[result.build,...old.filter(b=>b.id!==result.build.id).map(b=>input.recoveryOf===b.id?{...b,resolvedBlocker:true}:b)]);if(result.build.status!=='generating'){pendingRef.current=null;setPending(null);}if(input.recoveryOf)setRecovery(null);if(result.build.result&&reviewed.current!==result.build.id){reviewed.current=result.build.id;review(result.build);}else if(result.build.status==='failed')setError(failedBuild(result.build));}
  catch(e){if(!mounted.current||ticket!==generation.current)return;setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500)){pendingRef.current=null;setPending(null);}}
  finally{if(mounted.current&&ticket===generation.current){setBusy(false);void status.check();}}

 }
 async function save(){
  if(!draft)return;
  try{
   const change:BudgetItemChange=operation.pending||budgetReviewImport(draft,plan.id);
   if(await operation.submit(change))onClose();
  }catch(e){operation.setError((e as Error).message);}
 }
 async function remove(build:Build){setBusy(true);try{await request('',{action:'record-deletion',change:{kind:'build',id:'budget:'+build.id,deleted:true}});await status.check();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const categories=draft?budgetReviewCategories(draft).filter(c=>!c.archived):[],unassigned=draft?budgetReviewUnassigned(draft):[];
 function addCategory(){if(!draft||!newCategory)return;try{setDraft(addBudgetReviewCategory(draft,newCategory.name,newCategory.amount,newCategory.assignTo));setNewCategory(null);operation.setError('');}catch(e){operation.setError((e as Error).message);}}
 function applyAllowance(id:string,cents:number){if(!draft)return;try{setDraft(applyBudgetReviewAllowance(draft,allowanceTargets[id]||'',cents));operation.setError('');}catch(e){operation.setError((e as Error).message);}}
 function categoryForm(){return newCategory&&<div className="budget-review-new-category"><label className="compact-field">New category name<input value={newCategory.name} maxLength={100} placeholder="e.g. Household" onChange={e=>setNewCategory({...newCategory,name:e.target.value})}/></label><CurrencyInput label="Monthly allowance" value={newCategory.amount} onChange={amount=>setNewCategory({...newCategory,amount})}/><div className="budget-review-inline-actions"><Button variant="secondary" onClick={addCategory}>Add category</Button><Button variant="ghost" onClick={()=>setNewCategory(null)}>Cancel</Button></div></div>;}
 const unconfirmed=builds.some(b=>['generating','uncertain'].includes(b.status)&&!b.resolvedBlocker&&b.id!==recovery?.sourceId);
 const visibleBuilds=builds.filter(b=>!b.deleted&&(loanMode?b.intent==='loans':b.intent!=='loans'));
 const ItemDialog=editing?.debt?LoanDialog:RecurringDialog;
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="budget-builder-dialog" showCloseButton={!closeLocked} onInteractOutside={e=>e.preventDefault()}>
 <DialogHeader><DialogTitle>{draft?(loanMode?'Review your loans':'Review your budget'):(loanMode?'Build loans with AI':'Build budget with AI')}</DialogTitle><DialogDescription>{draft?`Review the items for ${formatMonth(plan.id)}. Choose a category for each expense. Nothing changes until you add this draft.`:loanMode?'Paste loan details, attach a statement, or paste a screenshot. Review the balances and terms before saving.':'Paste your budget or attach a file. You’ll review everything before it is added.'}</DialogDescription></DialogHeader>
 <div className="budget-builder-body">{draft?<>
 {draft.notes&&<p className="builder-notes">{draft.notes}</p>}
 <fieldset disabled={locked}><div className="section-heading"><h3>Categories</h3><Button variant="ghost" disabled={!!newCategory} onClick={()=>setNewCategory({name:'',amount:'0.00'})}>+ New category</Button></div>
 <p className="field-hint">Your saved categories and allowances stay unchanged unless you choose to edit an allowance here.</p>
 {newCategory&&!newCategory.assignTo&&categoryForm()}
 {draft.categories.length>0&&<div className="budget-draft-categories">{draft.categories.map((c,i)=><div key={c.item.id}><label className="compact-field">{c.previous?'Category':'New category name'}<input aria-label={`Category ${i+1} name`} value={c.item.name} disabled={!!c.previous} maxLength={100} onChange={e=>setDraft({...draft,categories:draft.categories.map((n,j)=>i===j?{...n,item:{...n.item,name:e.target.value}}:n)})}/></label><CurrencyInput label="Monthly allowance" ariaLabel={`${c.item.name} allowance`} value={c.amount} onChange={amount=>setDraft({...draft,categories:draft.categories.map((n,j)=>i===j?{...n,amount}:n)})}/><Button className="exclude-draft-category" variant="ghost" onClick={()=>setDraft({...draft,categories:draft.categories.filter(n=>n.item.id!==c.item.id),recurring:draft.recurring.map(r=>!c.previous&&r.categoryId===c.item.id?{...r,categoryId:''}:r)})}>{c.previous?'Undo allowance change':'Remove new category'}</Button></div>)}</div>}
 {draft.suggestions.length>0&&<details className="budget-allowance-suggestions"><summary>Optional allowance suggestions ({draft.suggestions.length})</summary><p className="field-hint">These amounts came from your file. Select a category and apply only the allowances you want.</p>{draft.suggestions.map(s=><div className="budget-allowance-suggestion" key={s.id}><span><strong>{s.name}</strong><small>{money(s.limitCents)} / month</small></span><Choice label={`Allowance category for ${s.name}`} value={allowanceTargets[s.id]||'unassigned'} options={[{value:'unassigned',label:'Choose category'},...categories.map(c=>({value:c.id,label:c.name}))]} onChange={id=>setAllowanceTargets({...allowanceTargets,[s.id]:id==='unassigned'?'':id})}/><Button variant="ghost" disabled={!allowanceTargets[s.id]} onClick={()=>applyAllowance(s.id,s.limitCents)}>Apply</Button></div>)}</details>}
 <h3>{loanMode?'Loans & payment plans':'Recurring items & payments'}</h3><p className="field-hint">Uncheck anything you don’t want to add. Matching saved items start unchecked. Card payments are transfers, so purchases aren’t counted twice.</p>
 {draft.recurring.map(r=>{const exists=plan.data.recurring.some(saved=>saved.id===r.id),selected=draft.selected.includes(r.id);return <div className="budget-draft-recurring" key={r.id}><div className="budget-draft-recurring-heading"><label className="inline-check"><input type="checkbox" checked={selected} disabled={exists} onChange={e=>setDraft({...draft,selected:e.target.checked?[...draft.selected,r.id]:draft.selected.filter(id=>id!==r.id)})}/><span><strong>{r.title}</strong><small>{r.debt?.paymentStatus==='balance-only'?'Balance tracking':r.kind==='transfer'&&r.amountCents===0?'Amount needed':money(r.amountCents)} · {r.debt?'Loan':r.kind==='transfer'?'Card payment':r.kind==='income'?'Income':'Expense'}{r.variable&&r.amountCents>0?' · estimate':''}{exists?' · already added':''}</small><small>{r.debt?.paymentStatus==='balance-only'?'Balance only · no scheduled payment':recurringDescription(r)}{r.frequency==='annual'?' · charged in that month only':''}</small>{r.debt&&<LoanSummary item={r}/>}</span></label><Button variant="ghost" disabled={exists} onClick={()=>setEditing(r)}>Edit</Button></div>{r.kind==='expense'&&<div className="budget-review-assignment"><label className="compact-field">Category{selected&&!r.categoryId&&<span className="budget-review-required">Unassigned</span>}<Choice label={`Category for ${r.title}`} value={r.categoryId||'unassigned'} options={[{value:'unassigned',label:'Choose category'},...categories.map(c=>({value:c.id,label:c.name}))]} onChange={categoryId=>setDraft({...draft,recurring:draft.recurring.map(item=>item.id===r.id?{...item,categoryId:categoryId==='unassigned'?'':categoryId}:item)})}/></label><Button variant="ghost" disabled={exists||!!newCategory} onClick={()=>setNewCategory({name:'',amount:'0.00',assignTo:r.id})}>+ New category</Button></div>}{newCategory?.assignTo===r.id&&categoryForm()}</div>;})}
 {unassigned.length>0&&<p className="budget-review-required" role="status">Choose a category for {unassigned.length===1?'1 selected expense':`${unassigned.length} selected expenses`} before adding the draft.</p>}</fieldset>
 </>:<>
 <label className="compact-field">{attachment?'Additional notes (optional)':loanMode?'Loan details':'Your budget'}<textarea rows={attachment?3:6} maxLength={BUDGET_TEXT_LIMIT} disabled={locked} value={text} onChange={e=>{setText(e.target.value);setError('');}} onPaste={e=>{if(locked)return;const file=Array.from(e.clipboardData.items).find(item=>item.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();void attach(file);}}} placeholder={attachment?'Anything to clarify about these details…':loanMode?'Paste the balances, statement dates, rates and payment details for one or more loans. If repayment has not started, say so.':'Monthly take-home pay $4,000 on the last Friday.\nGroceries allowance $400. Electric bill about $80 on the second Monday.\nYearly streaming subscription $120 on 10/15.\nMedical loan: 6 payments of $100, 0% interest, starting October 1…'}/></label>
 <label className="budget-image-picker">{preparing?'Reading file…':loanMode?'Attach a loan file':'Attach a budget file'}<input type="file" accept={BUDGET_FILE_ACCEPT} disabled={locked} onChange={e=>{const file=e.target.files?.[0];if(file)void attach(file);e.target.value='';}}/></label><Button variant="secondary" disabled={locked} onClick={()=>void pasteImage()}>Paste image</Button>
 {attachment&&<div className="budget-file-preview"><div className="section-heading"><span style={{minWidth:0,overflowWrap:'anywhere'}}><strong>{attachment.name}</strong><small style={{display:'block'}}>{attachment.kind} · {Math.ceil(attachment.size/1024).toLocaleString()} KB{attachment.text?` · ${attachment.text.length.toLocaleString()} characters read`:''}</small></span><Button variant="ghost" disabled={locked} onClick={()=>{setAttachment(undefined);setError('');}}>Remove file</Button></div>{attachment.image&&<div className="budget-image-preview"><img src={`data:${attachment.image.mimeType};base64,${attachment.image.data}`} alt="Attached image to send for analysis"/></div>}{attachment.warnings.map(warning=><p key={warning} className="field-hint">{warning}</p>)}</div>}
 <p className="field-hint">Text, CSV, Excel (.xlsx), Word (.docx), PDF or an image. Documents up to 8 MB; PDF up to 4 MB; images up to 10 MB. You can also paste a screenshot.</p>
 <p className="builder-consent muted">Build with AI sends your text, the file’s extracted content or attached PDF/image, and your Money goal to Google Gemini. LifeApp keeps the extracted text and draft, not the original file. Check amounts and dates before saving.</p>
 {loaded&&!available&&<p>AI building is currently unavailable. You can still add budget items manually.</p>}
 {recovery&&<p className="field-hint">A one-time recovery build is available. It starts a fresh request while keeping the previous unconfirmed attempt recorded.</p>}
 {blockedReason&&<p className="field-hint">{blockedReason}</p>}
 {visibleBuilds.length>0&&<div className="budget-build-list"><h3>Saved drafts</h3>{visibleBuilds.map(b=><div className="section-heading" key={b.id}><span>{b.month?formatMonth(b.month):'Budget'} · {b.result?`${b.result.categories.length} categories, ${b.result.recurring.length} recurring items`:b.status==='failed'||b.errorCode==='input_preflight_rejected'?failedBuild(b):b.resolvedBlocker?'Previous outcome unconfirmed; blocker reviewed.':b.status==='uncertain'?(recovery?.sourceId===b.id?'Previous outcome unconfirmed; recovery available.':'Outcome unconfirmed; new builds are paused.'):'Building…'}</span>{b.result&&<Button variant="secondary" disabled={locked||b.month!==plan.id} onClick={()=>review(b)}>Review</Button>}<Button variant="ghost" disabled={locked} onClick={()=>void remove(b)}>Delete</Button></div>)}</div>}
 </>}{pending&&<p className="field-hint" role="status">Building your draft… You can cancel this view; a submitted build may finish and appear in Saved drafts.</p>}{status.delayed&&<p className="field-hint" role="status">This is taking longer than expected. You can close this window and return to your saved drafts later.</p>}{status.error&&<p className="error" role="alert">Could not check saved drafts. {status.delayed?'Check your connection and reopen the builder.':'Trying again automatically…'}</p>}{error&&<p className="error" role="alert">{error}</p>}{operation.error&&<p className="error" role="alert">{operation.error}</p>}</div>
 <DialogFooter><Button variant="ghost" disabled={closeLocked} onClick={close}>Cancel</Button>{draft?<><Button variant="ghost" disabled={locked} onClick={()=>{setDraft(null);setNewCategory(null);operation.setError('');}}>Back</Button><Button disabled={busy||preparing||operation.busy||!!pending||!!editing||!operation.pending&&(!!newCategory||!!unassigned.length||!draft.categories.length&&!draft.selected.length)} onClick={()=>void save()}>{operation.busy?'Saving…':operation.pending?'Retry save':'Add to budget'}</Button></>:<><Button disabled={busy||preparing||!!pending&&!status.delayed||!loaded||!available||(!pending&&(!!blockedReason||unconfirmed||text.trim().length<10&&!attachment))} onClick={()=>void generate()}>{busy?'Working…':pending?'Retry this build':recovery?'Start recovery build':'Build with AI'}</Button></>}</DialogFooter>
 {editing&&draft&&<ItemDialog draftMode item={editing} previous={null} plan={{...plan,data:{...draft.initial,categories:budgetReviewCategories(draft)}}} onDirty={childDirty} onClose={()=>setEditing(null)} onSave={async change=>{if(change.kind!=='recurring')throw Error('Choose a recurring item.');setDraft({...draft,recurring:draft.recurring.map(r=>r.id===change.item.id?change.item:r)});return plan;}}/>}
 </DialogContent></Dialog>;
}
