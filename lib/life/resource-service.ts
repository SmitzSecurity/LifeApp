import {scheduledInMonth} from './budget-schedule.ts';
import {incomeAllocationId,allocationIdPattern} from './income-planning.ts';
import {trashState,retentionMs} from './trash.ts';
import { z } from 'zod/v3';
import { todayIn, type Profile } from './domain.ts';
import { resourceKind, resourceSchemas, monthSchema, occurrenceId, type ResourceKind, type Budget, type Transaction, type Routine, type Workout, type Cardio } from './modules.ts';
import type { Database } from './service.ts';
type Row={resource_id:string;payload:string;version:number;updated_at:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const unpack=(r:Row)=>({id:r.resource_id,data:JSON.parse(r.payload),version:r.version,updatedAt:r.updated_at});
export async function readResource(db:Database,userId:string,kind:ResourceKind,id:string){const row=await db.prepare('SELECT resource_id, payload, version, updated_at FROM life_resources WHERE user_id=?1 AND kind=?2 AND resource_id=?3').bind(userId,kind,id).first<Row>();return row?unpack(row):null;}
export async function listResources(request:Request,db:Database,userId:string){
 const params=new URL(request.url).searchParams,kind=resourceKind.safeParse(params.get('kind'));
 if(!kind.success||kind.data==='ai-recovery')return json({error:'Unknown section.'},400);
 const month=params.get('month');
 if(month&&!monthSchema.safeParse(month).success)return json({error:'Choose a valid month.'},400);
 if(kind.data==='transaction'&&!month)return json({error:'Choose a month to read transactions.'},400);
 // Never silently compute a balance from a partial transaction list.
 const limit=kind.data==='transaction'?5001:kind.data==='workout'?101:121;
 const result=await db.prepare(`SELECT resource_id,payload,version,updated_at FROM life_resources WHERE user_id=?1 AND kind=?2${month?' AND period=?3':''} ORDER BY active_slot DESC, updated_at DESC LIMIT ${limit}`).bind(...(month?[userId,kind.data,month]:[userId,kind.data])).all<Row>();
 if(kind.data==='transaction'&&result.results.length===limit)return json({error:'This month exceeds the beta transaction limit. No partial budget totals are shown.'},413);
 const suppressedAllocations=kind.data==='transaction'?(await db.prepare("SELECT record_id FROM life_trash WHERE user_id=?1 AND kind='transaction' AND purged_at IS NOT NULL AND record_id LIKE ?2").bind(userId,'allocation:'+month+':%').all<{record_id:string}>()).results.map(row=>row.record_id):undefined;
 return json({records:result.results.slice(0,limit-1).map(unpack),hasMore:result.results.length===limit,...(suppressedAllocations?{suppressedAllocations}:{})});
}
const envelope=z.object({kind:resourceKind,id:z.string().max(90),version:z.number().int().min(0),data:z.unknown()}).strict();
export async function saveResource(body:unknown,db:Database,userId:string,profile:Profile|null,now:Date){
 if(!profile)return json({error:'Complete your setup first.'},400);
 const parsed=envelope.safeParse(body);if(!parsed.success)return json({error:'Invalid section record.'},400);
 const {kind,id,version}=parsed.data;if(kind==='ai-recovery')return json({error:'Recovery grants cannot be edited.'},400);if(kind==='visibility')return json({error:'Use the record Delete or Restore action.'},400);
 if(!profile.modules.includes(kind==='budget'||kind==='transaction'?'money':'fitness'))return json({error:'Enable this section in Settings first.'},400);
 const validation=resourceSchemas[kind].safeParse(parsed.data.data);
 if(!validation.success)return json({error:validation.error.issues[0]?.message||'Check this form.'},400);
 let data=validation.data;
 const validId=kind==='budget'?monthSchema.safeParse(id).success:z.string().uuid().safeParse(id).success||(kind==='transaction'&&(/^due:\d{4}-(0[1-9]|1[0-2]):[0-9a-f-]{36}$/i.test(id)||allocationIdPattern.test(id)));
 if(!validId)return json({error:'Invalid record ID.'},400);
 const previous=await readResource(db,userId,kind,id);
 const trash=await trashState(db,userId,kind,id);
 if(trash?.purged_at||trash&&!(data as {deleted?:boolean}).deleted&&Date.parse(trash.deleted_at)+retentionMs<=now.valueOf())return json({error:'This item was permanently deleted or its restore period ended.'},410);
 const conflict=()=>json({error:'This record changed in another session. Your changes are still here. Reload the section before trying again.'},409);
 let period=kind==='budget'?id:'',allocationSourceVersion:number|undefined,incomePolicyGuard:{recurringId:string;policy:string|null}|undefined;
 if(kind==='workout-note'){
  const note=data as {date:string};period=note.date.slice(0,7);
  if(note.date>todayIn(profile.timezone,now))return json({error:'Choose today or an earlier workout date.'},400);
 }
 if(kind==='cardio'){
  const c=data as Cardio;period=c.date.slice(0,7);
  if(c.date>todayIn(profile.timezone,now))return json({error:'Choose today or an earlier cardio date.'},400);
 }
 if(kind==='transaction'){
  const t=data as Transaction;period=t.date.slice(0,7);
  if(previous&&previous.data.incomeSourceId!==t.incomeSourceId)return json({error:'Keep this transfer linked to its original income.'},400);
  if(t.incomeSourceId){
   if((t.kind!=='saving'&&t.kind!=='investing')||id!==incomeAllocationId(t.incomeSourceId,t.kind)||t.incomeSourceId.slice(4,11)!==period)return json({error:'Invalid income allocation.'},400);
   if(!previous){
    const source=await readResource(db,userId,'transaction',t.incomeSourceId);
    if(!source||source.data.kind!=='income'||source.data.deleted||source.data.voided||source.data.planned||!source.data.incomeDetails?.plan[t.kind])return json({error:'This income allocation is no longer available. Reopen the budget.'},409);
    allocationSourceVersion=source.version;
   }
  }else if(id.startsWith('allocation:'))return json({error:'Missing source income.'},400);
  if(previous?.data.incomeDetails&&JSON.stringify(previous.data.incomeDetails.plan)!==JSON.stringify(t.incomeDetails?.plan))return json({error:'Saved income keeps its original withholding and transfer rules.'},400);
  if(!t.planned&&t.date>todayIn(profile.timezone,now))return json({error:'Actual payments need today or an earlier date. Save a future one-off payment as planned.'},400);
  if(previous?.data.planned&&t.planned!==true&&t.planned!==false)return json({error:'Confirm this planned payment before counting it as recorded.'},400);
  if(previous?.data.expectedDate&&!t.planned&&t.expectedDate!==previous.data.expectedDate)return json({error:'Keep the original expected date when confirming or correcting this payment.'},400);
  if(previous&&(previous.data.date.slice(0,7)!==period||previous.data.recurringId!==t.recurringId))return json({error:'Keep this transaction in its original month. Void it and add a corrected transaction if needed.'},400);
  const plan=(await readResource(db,userId,'budget',period))?.data as Budget|undefined;
  const category=plan?.categories.find(c=>c.id===t.categoryId);
  if(t.kind==='expense'&&!category)return json({error:'Save this month’s plan and select an expense category first.'},400);
  if(t.recurringId){
   if(id!==occurrenceId(period,t.recurringId))return json({error:'Invalid scheduled occurrence.'},400);
   const recurring=plan?.recurring.find(r=>r.id===t.recurringId);
   if(!recurring||recurring.kind!==t.kind||recurring.categoryId!==t.categoryId)return json({error:'This scheduled payment changed. Reload the monthly plan.'},409);
   if(!previous&&!scheduledInMonth(period,recurring))return json({error:'This payment is outside the saved schedule. Edit its schedule first.'},409);
   if(recurring.deleted&&!previous)return json({error:'This monthly item was deleted. Restore it in the monthly plan first.'},409);
   if(t.incomeDetails&&!previous&&JSON.stringify(recurring.incomePlan)!==JSON.stringify(t.incomeDetails.plan))return json({error:'Income rules changed. Reopen the payment before confirming.'},409);
   if(t.incomeDetails&&previous&&!previous.data.incomeDetails)return json({error:'Income rules apply when a new payment is confirmed.'},400);
   if(!previous&&recurring.incomePlan&&!t.incomeDetails)return json({error:'Confirm the take-home amount and income rules before saving.'},400);
   // Guard the policy itself, including its absence, rather than the whole
   // monthly plan. Unrelated category edits must not invalidate confirmation.
   if(!previous&&t.kind==='income')incomePolicyGuard={recurringId:t.recurringId,policy:recurring.incomePlan?JSON.stringify(recurring.incomePlan):null};
  }else if(id.startsWith('due:'))return json({error:'Missing scheduled occurrence.'},400);
  data={...t,...(t.planned?{expectedDate:t.expectedDate||t.date}:{}),categoryId:t.kind==='expense'?t.categoryId:'',categoryName:t.kind==='expense'?category!.name:''};
 }
 if(kind==='budget'&&(data as Budget).recurring.some(r=>r.debt&&(r.debt.balanceDate>todayIn(profile.timezone,now)||r.debt.balanceDate<'1900-01-01')))return json({error:'Use a statement balance date between 1900 and today.'},400);
 if(kind==='budget'&&previous){
  const p=data as Budget,old=previous.data as Budget;
  if(old.recurring.some(r=>r.purged&&JSON.stringify(r)!==JSON.stringify(p.recurring.find(n=>n.id===r.id))))return json({error:'Permanently deleted monthly items cannot be changed.'},410);
  if(p.recurring.some(r=>r.purged&&!old.recurring.find(n=>n.id===r.id)?.purged))return json({error:'Use Trash to permanently delete a monthly item.'},400);
  if(old.categories.some(c=>!p.categories.some(n=>n.id===c.id))||old.recurring.some(r=>!p.recurring.some(n=>n.id===r.id)))return json({error:'Keep saved categories and scheduled items to preserve transaction references.'},400);
 }
 if(kind==='workout'){
  const w=data as Workout;period=w.date.slice(0,7);
  if(w.date>todayIn(profile.timezone,now))return json({error:'Choose today or an earlier workout date.'},400);
  if(w.restUntil&&Date.parse(w.restUntil)>now.valueOf()+901000)return json({error:'Rest timers can be up to 15 minutes.'},400);
  if(previous){
   const old=previous.data as Workout;
   if(old.date!==w.date||old.routineId!==w.routineId||old.name!==w.name||JSON.stringify(old.exercises)!==JSON.stringify(w.exercises))return json({error:'Saved workouts keep their original routine.'},400);
   if(old.finishedAt&&!w.finishedAt)return json({error:'A finished workout cannot be reopened.'},400);
  }else{
   const routine=(await readResource(db,userId,'routine',w.routineId))?.data as Routine|undefined;
   if(!routine||routine.archived||routine.name!==w.name||JSON.stringify(routine.exercises)!==JSON.stringify(w.exercises)||w.sets.length||w.finishedAt||w.restUntil)return json({error:'Start from a saved routine.'},400);
  }
  if(!w.finishedAt&&!w.deleted){const active=await db.prepare("SELECT resource_id FROM life_resources WHERE user_id=?1 AND kind='workout' AND active_slot='active'").bind(userId).first<{resource_id:string}>();if(active&&active.resource_id!==id)return json({error:'Finish your current workout before starting another.'},409);}
 }
 // Retry of the exact saved result is successful without creating another row/version.
 if(previous&&JSON.stringify(previous.data)===JSON.stringify(data))return json({record:previous});
 if((previous?.version||0)!==version)return conflict();
 const activeSlot=kind==='workout'&&!(data as Workout).finishedAt&&!(data as Workout).deleted?'active':null;
 const insertGuard=allocationSourceVersion!==undefined?"EXISTS(SELECT 1 FROM life_resources WHERE user_id=?1 AND kind='transaction' AND resource_id=?9 AND version=?10)":incomePolicyGuard?"EXISTS(SELECT 1 FROM life_resources budget,json_each(budget.payload,'$.recurring') item WHERE budget.user_id=?1 AND budget.kind='budget' AND budget.resource_id=?4 AND json_extract(item.value,'$.id')=?9 AND json_extract(item.value,'$.kind')='income' AND COALESCE(json_extract(item.value,'$.deleted'),0)=0 AND json_extract(item.value,'$.incomePlan') IS ?10)":'true';
 const guardParams=allocationSourceVersion!==undefined?[(data as Transaction).incomeSourceId,allocationSourceVersion]:incomePolicyGuard?[incomePolicyGuard.recurringId,incomePolicyGuard.policy]:[];
 try{
 const row=await db.prepare(`INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at,active_slot) SELECT ?1,?2,?3,?4,?5,1,?6,?7 WHERE ${insertGuard}
 ON CONFLICT(user_id,kind,resource_id) DO UPDATE SET period=excluded.period,payload=excluded.payload,version=life_resources.version+1,updated_at=excluded.updated_at,active_slot=excluded.active_slot WHERE life_resources.version=?8 RETURNING version`).bind(userId,kind,id,period,JSON.stringify(data),now.toISOString(),activeSlot,version,...guardParams).first<{version:number}>();
 if(!row)return conflict();return json({record:{id,data,version:row.version,updatedAt:now.toISOString()}});
 }catch(e){if(String(e).includes('UNIQUE constraint'))return conflict();throw e;}
}
