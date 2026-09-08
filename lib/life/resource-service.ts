import { z } from 'zod/v3';
import { todayIn, type Profile } from './domain.ts';
import { resourceKind, resourceSchemas, monthSchema, occurrenceId, type ResourceKind, type Budget, type Transaction, type Routine, type Workout } from './modules.ts';
import type { Database } from './service.ts';
type Row={resource_id:string;payload:string;version:number;updated_at:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const unpack=(r:Row)=>({id:r.resource_id,data:JSON.parse(r.payload),version:r.version,updatedAt:r.updated_at});
export async function readResource(db:Database,userId:string,kind:ResourceKind,id:string){const row=await db.prepare('SELECT resource_id, payload, version, updated_at FROM life_resources WHERE user_id=?1 AND kind=?2 AND resource_id=?3').bind(userId,kind,id).first<Row>();return row?unpack(row):null;}
export async function listResources(request:Request,db:Database,userId:string){
 const params=new URL(request.url).searchParams,kind=resourceKind.safeParse(params.get('kind'));
 if(!kind.success)return json({error:'Unknown section.'},400);
 const month=params.get('month');
 if(month&&!monthSchema.safeParse(month).success)return json({error:'Choose a valid month.'},400);
 if(kind.data==='transaction'&&!month)return json({error:'Choose a month to read transactions.'},400);
 // Never silently compute a balance from a partial transaction list.
 const limit=kind.data==='transaction'?5001:kind.data==='workout'?101:121;
 const result=await db.prepare(`SELECT resource_id,payload,version,updated_at FROM life_resources WHERE user_id=?1 AND kind=?2${month?' AND period=?3':''} ORDER BY active_slot DESC, updated_at DESC LIMIT ${limit}`).bind(...(month?[userId,kind.data,month]:[userId,kind.data])).all<Row>();
 if(kind.data==='transaction'&&result.results.length===limit)return json({error:'This month exceeds the beta transaction limit. No partial budget totals are shown.'},413);
 return json({records:result.results.slice(0,limit-1).map(unpack),hasMore:result.results.length===limit});
}
const envelope=z.object({kind:resourceKind,id:z.string().max(90),version:z.number().int().min(0),data:z.unknown()}).strict();
export async function saveResource(body:unknown,db:Database,userId:string,profile:Profile|null,now:Date){
 if(!profile)return json({error:'Complete your setup first.'},400);
 const parsed=envelope.safeParse(body);if(!parsed.success)return json({error:'Invalid section record.'},400);
 const {kind,id,version}=parsed.data;
 if(!profile.modules.includes(kind==='budget'||kind==='transaction'?'money':'fitness'))return json({error:'Enable this section in My setup first.'},400);
 const validation=resourceSchemas[kind].safeParse(parsed.data.data);
 if(!validation.success)return json({error:validation.error.issues[0]?.message||'Check this form.'},400);
 let data=validation.data;
 const validId=kind==='budget'?monthSchema.safeParse(id).success:z.string().uuid().safeParse(id).success||(kind==='transaction'&&/^due:\d{4}-(0[1-9]|1[0-2]):[0-9a-f-]{36}$/i.test(id));
 if(!validId)return json({error:'Invalid record ID.'},400);
 const previous=await readResource(db,userId,kind,id);
 const conflict=()=>json({error:'This record changed in another session. Your changes are still here. Reload the section before trying again.'},409);
 let period=kind==='budget'?id:'';
 if(kind==='transaction'){
  const t=data as Transaction;period=t.date.slice(0,7);
  if(t.date>todayIn(profile.timezone,now))return json({error:'Record money on today or an earlier date. Use the monthly plan for future payments.'},400);
  if(previous&&(previous.data.date.slice(0,7)!==period||previous.data.recurringId!==t.recurringId))return json({error:'Keep this transaction in its original month. Void it and add a corrected transaction if needed.'},400);
  const plan=(await readResource(db,userId,'budget',period))?.data as Budget|undefined;
  const category=plan?.categories.find(c=>c.id===t.categoryId);
  if(t.kind==='expense'&&!category)return json({error:'Save this month’s plan and select an expense category first.'},400);
  if(t.recurringId){
   if(id!==occurrenceId(period,t.recurringId))return json({error:'Invalid scheduled occurrence.'},400);
   const recurring=plan?.recurring.find(r=>r.id===t.recurringId);
   if(!recurring||recurring.kind!==t.kind||recurring.categoryId!==t.categoryId)return json({error:'This scheduled payment changed. Reload the monthly plan.'},409);
  }else if(id.startsWith('due:'))return json({error:'Missing scheduled occurrence.'},400);
  data={...t,categoryId:t.kind==='expense'?t.categoryId:'',categoryName:t.kind==='expense'?category!.name:''};
 }
 if(kind==='budget'&&previous){
  const p=data as Budget,old=previous.data as Budget;
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
  if(!w.finishedAt){const active=await db.prepare("SELECT resource_id FROM life_resources WHERE user_id=?1 AND kind='workout' AND active_slot='active'").bind(userId).first<{resource_id:string}>();if(active&&active.resource_id!==id)return json({error:'Finish your current workout before starting another.'},409);}
 }
 // Retry of the exact saved result is successful without creating another row/version.
 if(previous&&JSON.stringify(previous.data)===JSON.stringify(data))return json({record:previous});
 if((previous?.version||0)!==version)return conflict();
 const activeSlot=kind==='workout'&&!(data as Workout).finishedAt?'active':null;
 try{
 const row=await db.prepare(`INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at,active_slot) VALUES(?1,?2,?3,?4,?5,1,?6,?7)
 ON CONFLICT(user_id,kind,resource_id) DO UPDATE SET period=excluded.period,payload=excluded.payload,version=life_resources.version+1,updated_at=excluded.updated_at,active_slot=excluded.active_slot WHERE life_resources.version=?8 RETURNING version`).bind(userId,kind,id,period,JSON.stringify(data),now.toISOString(),activeSlot,version).first<{version:number}>();
 if(!row)return conflict();return json({record:{id,data,version:row.version,updatedAt:now.toISOString()}});
 }catch(e){if(String(e).includes('UNIQUE constraint'))return conflict();throw e;}
}
