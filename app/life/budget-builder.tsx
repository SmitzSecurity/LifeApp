"use client";
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {budgetSchema,categorySchema,money,parseMoney,type Budget,type Saved} from '@/lib/life/modules';
import type {BudgetBuildResult,BudgetImage} from '@/lib/life/budget-build-schema';
import type {BudgetItemChange} from '@/lib/life/budget-items';
import {request} from './shared';
import RecurringDialog,{recurringDescription} from './budget-recurring';
import {CurrencyInput,useBudgetDirty,useItemSave,type DirtyReporter} from './budget-fields';

type Build={id:string;month?:string;status:string;deleted?:boolean;result:BudgetBuildResult|null};
type Input={requestId:string;text:string;month:string;consent:true;image?:BudgetImage};
type CategoryDraft={previous:Budget['categories'][number]|null;item:Budget['categories'][number];amount:string;suggested:number};
type Draft={categories:CategoryDraft[];recurring:Budget['recurring'];selected:string[];initial:Budget;notes:string};

async function prepareImage(file:File):Promise<BudgetImage>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10_000_000)throw Error('Choose a JPEG, PNG or WebP image under 10 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width*bitmap.height>25_000_000)throw Error('Crop this image to the budget before attaching it.');
  const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext('2d');if(!context)throw Error('This browser could not prepare the image. Paste its text instead.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for(const quality of [.9,.75,.55]){const data=canvas.toDataURL('image/jpeg',quality).split(',')[1];if(data.length<=1_400_000)return {mimeType:'image/jpeg',data};}
  throw Error('This image is too detailed. Crop it or paste the budget text.');
 }finally{bitmap.close();}
}
export default function BudgetBuilder({plan,onSave,onClose,onDirty}:{plan:Saved<Budget>;onSave:(change:BudgetItemChange)=>Promise<Saved<Budget>>;onClose:()=>void;onDirty:DirtyReporter}){
 const [text,setText]=useState(''),[image,setImage]=useState<BudgetImage>(),[preparing,setPreparing]=useState(false),[busy,setBusy]=useState(false),[available,setAvailable]=useState(false),[loaded,setLoaded]=useState(false),[builds,setBuilds]=useState<Build[]>([]),[pending,setPending]=useState<Input|null>(null),[error,setError]=useState(''),[draft,setDraft]=useState<Draft|null>(null),[editing,setEditing]=useState<Budget['recurring'][number]|null>(null),[nestedDirty,setNestedDirty]=useState(false);
 const operation=useItemSave(onSave),locked=busy||preparing||operation.busy||!!pending||!!operation.pending;
 useBudgetDirty('budget-builder',locked||!!text||!!image||!!draft||nestedDirty,onDirty);
 const childDirty=useCallback((_id:string,value:boolean)=>setNestedDirty(value),[]);
 async function refresh(){setBusy(true);setError('');try{const result=await request('?budget-builds');setBuilds(result.builds);setAvailable(result.available);setLoaded(true);if(pending&&result.builds.some((b:Build)=>b.id===pending.requestId))setPending(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[]);
 async function attach(file:File){setPreparing(true);setError('');try{setImage(await prepareImage(file));}catch(e){setError((e as Error).message);}finally{setPreparing(false);}}
 function review(build:Build){
  if(!build.result)return;const result=build.result,mapping=new Map<string,string>();
  const categories=result.categories.map(c=>{const previous=plan.data.categories.find(saved=>saved.id===c.id||saved.name.toLowerCase()===c.name.toLowerCase())||null,item=previous?{...previous,limitCents:plan.version?previous.limitCents:c.limitCents}:c;mapping.set(c.id,item.id);return {previous,item,amount:(item.limitCents/100).toFixed(2),suggested:c.limitCents};});
  const recurring=result.recurring.map(r=>({...r,categoryId:mapping.get(r.categoryId)||r.categoryId}));
  setDraft({categories,recurring,selected:recurring.filter(r=>!plan.data.recurring.some(saved=>saved.id===r.id||saved.title.toLowerCase()===r.title.toLowerCase())).map(r=>r.id),initial:plan.data,notes:result.notes});setError('');operation.setError('');
 }
 async function generate(){
  const input=pending||{requestId:crypto.randomUUID(),text:text.trim(),month:plan.id,consent:true as const,...(image?{image}:{})};setPending(input);setBusy(true);setError('');
  try{const result=await request('?budget-build',{action:'budget-build',build:input});setBuilds(old=>[result.build,...old.filter(b=>b.id!==result.build.id)]);setPending(null);if(result.build.result)review(result.build);}
  catch(e){setError((e as Error).message);if((e as {status?:number}).status&&((e as {status:number}).status<500))setPending(null);}finally{setBusy(false);}
 }
 async function save(){
  if(!draft)return;
  try{
   const categories=draft.categories.map(c=>({previous:c.previous,item:categorySchema.parse({...c.item,limitCents:parseMoney(c.amount)})})).filter(c=>JSON.stringify(c.previous)!==JSON.stringify(c.item));
   const recurring=draft.recurring.filter(r=>draft.selected.includes(r.id)).map(item=>({previous:null,item}));
   const change:BudgetItemChange=operation.pending||{kind:'import',month:plan.id,initial:draft.initial,categories,recurring};
   const valid=budgetSchema.safeParse({...draft.initial,categories:[...draft.initial.categories.filter(c=>!categories.some(n=>n.item.id===c.id)),...categories.map(c=>c.item)],recurring:[...draft.initial.recurring,...recurring.map(r=>r.item)]});
   if(!operation.pending&&!valid.success)throw Error(valid.error.issues[0]?.message||'Review the draft values.');
   if(await operation.submit(change))onClose();
  }catch(e){operation.setError((e as Error).message);}
 }
 async function remove(build:Build){setBusy(true);try{await request('',{action:'record-deletion',change:{kind:'build',id:'budget:'+build.id,deleted:true}});await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const unconfirmed=builds.some(b=>['generating','uncertain'].includes(b.status));
 return <Dialog open onOpenChange={open=>{if(!open&&!locked)onClose();}}><DialogContent className="budget-builder-dialog" showCloseButton={!locked} onInteractOutside={e=>e.preventDefault()}>
 <DialogHeader><DialogTitle>{draft?'Review your budget':'Build budget with AI'}</DialogTitle><DialogDescription>{draft?`Review the items for ${plan.id}. Existing allowances keep their current amounts unless you edit them here.`:'Paste your budget, or attach a screenshot. You’ll review everything before it is added.'}</DialogDescription></DialogHeader>
 <div className="budget-builder-body">{draft?<>
 {draft.notes&&<p className="builder-notes">{draft.notes}</p>}
 <fieldset disabled={locked}><div className="section-heading"><h3>Category allowances</h3>{draft.categories.some(c=>c.previous&&c.previous.limitCents!==c.suggested)&&<Button variant="ghost" onClick={()=>setDraft({...draft,categories:draft.categories.map(c=>({...c,amount:(c.suggested/100).toFixed(2)}))})}>Use imported allowances</Button>}</div><div className="budget-draft-categories">{draft.categories.map((c,i)=><div key={c.item.id}><label className="compact-field">Category name<input aria-label={`Category ${i+1} name`} value={c.item.name} maxLength={100} onChange={e=>setDraft({...draft,categories:draft.categories.map((n,j)=>i===j?{...n,item:{...n.item,name:e.target.value}}:n)})}/></label><CurrencyInput label={c.previous?'Current allowance':'Monthly allowance'} ariaLabel={`${c.item.name} allowance`} value={c.amount} onChange={amount=>setDraft({...draft,categories:draft.categories.map((n,j)=>i===j?{...n,amount}:n)})}/>{c.previous&&c.previous.limitCents!==c.suggested&&<small className="imported-allowance">Imported: {money(c.suggested)}</small>}<Button className="exclude-draft-category" variant="ghost" aria-label={`Exclude ${c.item.name} and its draft items`} onClick={()=>setDraft({...draft,categories:draft.categories.filter(n=>n.item.id!==c.item.id),recurring:draft.recurring.filter(r=>r.categoryId!==c.item.id),selected:draft.selected.filter(id=>!draft.recurring.some(r=>r.id===id&&r.categoryId===c.item.id))})}>Exclude category & items</Button></div>)}</div>
 <h3>Recurring items & loans</h3><p className="field-hint">Uncheck anything you don’t want to add. Matching saved items start unchecked.</p>
 {draft.recurring.map(r=>{const exists=plan.data.recurring.some(saved=>saved.id===r.id);return <div className="budget-draft-recurring" key={r.id}><label className="inline-check"><input type="checkbox" checked={draft.selected.includes(r.id)} disabled={exists} onChange={e=>setDraft({...draft,selected:e.target.checked?[...draft.selected,r.id]:draft.selected.filter(id=>id!==r.id)})}/><span><strong>{r.title}</strong><small>{money(r.amountCents)} · {r.debt?'Loan':r.kind}{r.variable?' · estimate':''}{exists?' · already added':''}</small><small>{recurringDescription(r)}</small></span></label><Button variant="ghost" disabled={exists} onClick={()=>setEditing(r)}>Edit</Button></div>;})}</fieldset>
 </>:<>
 <label className="compact-field">Your budget<textarea rows={6} maxLength={10000} disabled={locked} value={text} onChange={e=>setText(e.target.value)} onPaste={e=>{if(locked)return;const file=Array.from(e.clipboardData.items).find(item=>item.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();void attach(file);}}} placeholder={'Monthly take-home pay $4,000 on the last Friday.\nGroceries allowance $400. Electric bill about $80 on the second Monday.\nMedical loan: 6 payments of $100, 0% interest, starting October 1…'}/></label>
 <label className="budget-image-picker">{preparing?'Preparing image…':'Attach a budget image'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={e=>{const file=e.target.files?.[0];if(file)void attach(file);e.target.value='';}}/></label>
 {image&&<div className="budget-image-preview"><img src={`data:${image.mimeType};base64,${image.data}`} alt="Budget image to send for analysis"/><Button variant="ghost" disabled={locked} onClick={()=>setImage(undefined)}>Remove image</Button></div>}
 <p className="field-hint">You can paste a screenshot into the text box. JPEG, PNG or WebP, up to 10 MB.</p>
 <p className="builder-consent muted">Build with AI sends this text, any attached image and your Money goal to Google Gemini. LifeApp saves the draft, not the image. Check amounts and dates before saving.</p>
 {loaded&&!available&&<p>AI building is currently unavailable. You can still add budget items manually.</p>}
 {builds.filter(b=>!b.deleted).length>0&&<div className="budget-build-list"><h3>Saved drafts</h3>{builds.filter(b=>!b.deleted).map(b=><div className="section-heading" key={b.id}><span>{b.month||'Budget'} · {b.result?`${b.result.categories.length} categories, ${b.result.recurring.length} recurring items`:b.status==='failed'?'Could not read this budget. Try clearer text or an image.':b.status==='uncertain'?'Outcome unconfirmed; new builds are paused.':'Building…'}</span>{b.result&&<Button variant="secondary" disabled={locked||b.month!==plan.id} onClick={()=>review(b)}>Review</Button>}<Button variant="ghost" disabled={locked} onClick={()=>void remove(b)}>Delete</Button></div>)}</div>}
 </>}{error&&<p className="error" role="alert">{error}</p>}{operation.error&&<p className="error" role="alert">{operation.error}</p>}</div>
 <DialogFooter><Button variant="ghost" disabled={locked} onClick={onClose}>Cancel</Button>{draft?<><Button variant="ghost" disabled={locked} onClick={()=>{setDraft(null);operation.setError('');}}>Back</Button><Button disabled={busy||preparing||operation.busy||!!pending||!!editing||!draft.categories.length&&!draft.selected.length} onClick={()=>void save()}>{operation.busy?'Saving…':operation.pending?'Retry save':'Add to budget'}</Button></>:<><Button variant="ghost" disabled={busy||preparing} onClick={()=>void refresh()}>Refresh status</Button><Button disabled={busy||preparing||!loaded||!available||(!pending&&(unconfirmed||text.trim().length<10&&!image))} onClick={()=>void generate()}>{busy?'Working…':pending?'Check / retry build':'Build with AI'}</Button></>}</DialogFooter>
 {editing&&draft&&<RecurringDialog draftMode item={editing} previous={null} plan={{...plan,data:{...draft.initial,categories:[...draft.initial.categories.filter(c=>!draft.categories.some(n=>n.item.id===c.id)),...draft.categories.map(c=>c.item)]}}} onDirty={childDirty} onClose={()=>setEditing(null)} onSave={async change=>{if(change.kind!=='recurring')throw Error('Choose a recurring item.');setDraft({...draft,recurring:draft.recurring.map(r=>r.id===change.item.id?change.item:r)});return plan;}}/>}
 </DialogContent></Dialog>;
}
