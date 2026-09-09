import { listAI, generateAI, type AISettings } from './ai-service.ts';
import { automaticConsentStatus, saveAutomaticConsent } from './automatic-consent.ts';
import {exportAccount} from './export.ts';
import {readHistory} from './history.ts';
import { completionIssues } from './reviews.ts';
import { listResources, saveResource } from './resource-service.ts';
import { profileSchema, entryInputSchema, dateSchema, emptyEntry, todayIn, score, type Entry, type Profile } from './domain.ts';

// The caller supplies verified server identity, never an id from JSON or query parameters.
export type Database={prepare:(sql:string)=>{bind:(...v:unknown[])=>{first:<T>()=>Promise<T|null>;all:<T>()=>Promise<{results:T[]}>}}};
type Row={payload:string;version:number;updated_at:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const conflict=()=>json({error:'This was changed in another session. Keep a copy of your unsaved text, reload, and apply your changes again.'},409);
async function getProfile(db:Database,id:string):Promise<Profile|null>{const row=await db.prepare('SELECT payload, version FROM life_profiles WHERE user_id = ?1').bind(id).first<Row>();return row?profileSchema.parse({...JSON.parse(row.payload),version:row.version}):null;}
async function getEntry(db:Database,id:string,date:string):Promise<Entry|null>{const row=await db.prepare('SELECT payload, version, updated_at FROM life_entries WHERE user_id = ?1 AND entry_date = ?2').bind(id,date).first<Row>();return row?{...JSON.parse(row.payload),version:row.version,updatedAt:row.updated_at}:null;}

export async function handleLife(request:Request,userId:string|null,db:Database,now=new Date(),ai:AISettings={provider:null,enabled:false,userCapMicros:1000000,globalCapMicros:5000000}):Promise<Response>{
 if(!userId)return json({error:'Sign in to open your journal.'},401);
 try{
  if(request.method==='GET'){
   if(new URL(request.url).searchParams.has('automatic'))return await automaticConsentStatus(db,userId,ai,now);
   if(new URL(request.url).searchParams.has('export'))return await exportAccount(db,userId,now);
   if(new URL(request.url).searchParams.has('ai'))return await listAI(db,userId,new URL(request.url).searchParams.get('date'),ai,now);
   if(new URL(request.url).searchParams.has('kind'))return await listResources(request,db,userId);
   const date=new URL(request.url).searchParams.get('date');
   if(date){if(!dateSchema.safeParse(date).success)return json({error:'Choose a valid date.'},400);return json({entry:await getEntry(db,userId,date)});}
   const profile=await getProfile(db,userId);
   const result=await db.prepare('SELECT payload, version, updated_at FROM life_entries WHERE user_id = ?1 ORDER BY entry_date DESC LIMIT 366').bind(userId).all<Row>();
   return json({profile,entries:result.results.map(r=>({...JSON.parse(r.payload),version:r.version,updatedAt:r.updated_at}))});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const origin=request.headers.get('origin');
  if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==new URL(request.url).origin))return json({error:'Open LifeApp directly to save changes.'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Expected JSON.'},415);
  if(Number(request.headers.get('content-length')||0)>65536)return json({error:'This entry is too large.'},413);
  const bodyText=await request.text();
  if(new TextEncoder().encode(bodyText).length>65536)return json({error:'This entry is too large.'},413);
  let body:unknown;try{body=JSON.parse(bodyText)}catch{return json({error:'Invalid request.'},400);}
  if(!body||typeof body!=='object')return json({error:'Invalid request.'},400);
  const b=body as Record<string,unknown>;
  if(b.action==='history')return await readHistory(db,userId,b.filters);
  const updated=now.toISOString();
  if(b.action==='automatic-consent')return await saveAutomaticConsent(db,userId,b.consent,ai,now);
  if(b.action==='ai')return await generateAI(db,userId,b.review,ai,now);
  if(b.action==='resource')return await saveResource(b.record,db,userId,await getProfile(db,userId),now);
  if(b.action==='profile'){
   const parsed=profileSchema.safeParse(b.profile);
   if(!parsed.success)return json({error:parsed.error.issues[0]?.message||'Check your setup.'},400);
   const p=parsed.data,previous=await getProfile(db,userId);
   if((previous?.version||0)!==p.version)return conflict();
   if(previous?.habits.some(h=>!p.habits.some(n=>n.id===h.id)))return json({error:'Archive habits to preserve their history.'},400);
   const {version,...data}=p;
   const row=await db.prepare(`INSERT INTO life_profiles(user_id,payload,version,updated_at) VALUES(?1,?2,1,?3)
     ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,version=life_profiles.version+1,updated_at=excluded.updated_at
     WHERE life_profiles.version=?4 RETURNING version`).bind(userId,JSON.stringify(data),updated,version).first<{version:number}>();
   if(!row)return conflict();
   return json({profile:{...data,version:row.version}});
  }
  if(b.action==='entry'){
   const parsed=entryInputSchema.safeParse(b.entry);
   if(!parsed.success)return json({error:parsed.error.issues[0]?.message||'Check your entry.'},400);
   const input=parsed.data,profile=await getProfile(db,userId);
   if(!profile)return json({error:'Complete your setup first.'},400);
   if(input.date>todayIn(profile.timezone,now))return json({error:'Choose today or an earlier date.'},400);
   const previous=await getEntry(db,userId,input.date);
   if(previous&&input.mutationId&&previous.mutationId===input.mutationId){
    const same=previous.journal===input.journal&&!!previous.complete===input.complete&&JSON.stringify(previous.context)===JSON.stringify(input.context)&&JSON.stringify(previous.habits.map(h=>({id:h.id,status:h.status})))===JSON.stringify(input.statuses);
    return same?json({entry:previous,summary:score(previous.habits)}):conflict();
   }
   if((previous?.version||0)!==input.version)return conflict();
   const base=previous||emptyEntry(profile,input.date);
   const ids=new Set(input.statuses.map(s=>s.id));
   if(ids.size!==input.statuses.length||ids.size!==base.habits.length||base.habits.some(h=>!ids.has(h.id)))return json({error:'Your habit setup changed. Keep a copy of this entry, reload, and try again.'},409);
   if(Object.keys(input.context).some(k=>!profile.modules.includes(k as Profile['modules'][number])&&!Object.hasOwn(base.context,k)))return json({error:'This module is not enabled.'},400);
   const statuses=new Map(input.statuses.map(s=>[s.id,s.status]));
   const {version,updatedAt,...snapshot}=base;
   const entry={...snapshot,complete:input.complete,mutationId:input.mutationId,journal:input.journal,context:input.context,habits:base.habits.map(h=>({...h,status:statuses.get(h.id)!}))};
   if(input.complete&&completionIssues(entry).length)return json({error:completionIssues(entry).join(" ")},400);
   const row=await db.prepare(`INSERT INTO life_entries(user_id,entry_date,payload,version,updated_at) VALUES(?1,?2,?3,1,?4)
     ON CONFLICT(user_id,entry_date) DO UPDATE SET payload=excluded.payload,version=life_entries.version+1,updated_at=excluded.updated_at
     WHERE life_entries.version=?5 RETURNING version`).bind(userId,input.date,JSON.stringify(entry),updated,input.version).first<{version:number}>();
   if(!row)return conflict();
   return json({entry:{...entry,version:row.version,updatedAt:updated},summary:score(entry.habits)});
  }
  return json({error:'Unknown action.'},400);
 }catch{
  // Never log request bodies or journal contents. The caller receives a recoverable error.
  console.error('LifeApp storage operation failed');
  return json({error:'Your journal is temporarily unavailable. Your unsaved text is still here. Please try again.'},503);
 }
}
