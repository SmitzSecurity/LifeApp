import { z } from 'zod/v3';
import { profileSchema,dateSchema,todayIn,type Entry } from './domain.ts';
import { completionIssues } from './reviews.ts';
import { buildReviewContext } from './review-context.ts';
import { readResource } from './resource-service.ts';
import type { Database } from './service.ts';
import { AI_MODEL,PRICE_VERSION,PRICE_EXPIRES,RESERVATION_MICROS,MAX_INPUT_BYTES,systemInstruction,type AIProvider } from './ai-provider.ts';
export type AISettings={provider:AIProvider|null;enabled:boolean;userCapMicros:number;globalCapMicros:number};
export type ReportRow={user_id:string;request_id:string;entry_date:string;revision:number;source_version:number;predecessor_id:string|null;critique:string;status:string;input_snapshot:string;report_text:string|null;model:string;price_version:string;provider_id:string|null;input_tokens:number|null;output_tokens:number|null;thought_tokens:number|null;reserved_micros:number;cost_micros:number|null;created_at:string;finished_at:string|null;error_code:string|null};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const publicReport=(r:ReportRow)=>({id:r.request_id,date:r.entry_date,revision:r.revision,sourceVersion:r.source_version,predecessorId:r.predecessor_id,critique:r.critique,status:r.status,text:r.report_text,inputTokens:r.input_tokens,outputTokens:r.output_tokens,thoughtTokens:r.thought_tokens,costMicros:r.cost_micros,reservedMicros:r.reserved_micros,model:r.model,createdAt:r.created_at,errorCode:r.error_code});
const requestSchema=z.object({date:dateSchema,requestId:z.string().uuid(),sourceVersion:z.number().int().positive(),predecessorId:z.string().max(80).nullable(),critique:z.string().trim().max(1000),consent:z.literal(true)}).strict();
async function getReport(db:Database,userId:string,id:string){return db.prepare('SELECT * FROM life_ai_reviews WHERE user_id=?1 AND request_id=?2').bind(userId,id).first<ReportRow>();}
const inMonth=(now:Date)=>now.toISOString().slice(0,7)+'-01T00:00:00.000Z';
export async function listAI(db:Database,userId:string,date:string|null,settings:AISettings,now:Date){
 if(date&&!dateSchema.safeParse(date).success)return json({error:'Choose a valid review date.'},400);
 const result=await db.prepare(`SELECT * FROM life_ai_reviews WHERE user_id=?1${date?' AND entry_date=?2':''} ORDER BY created_at DESC LIMIT 100`).bind(...(date?[userId,date]:[userId])).all<ReportRow>();
 const usage=await db.prepare("SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) AS allocated, COALESCE(SUM(cost_micros),0) AS measured FROM life_ai_reviews WHERE user_id=?1 AND created_at>=?2").bind(userId,inMonth(now)).first<{allocated:number;measured:number}>();
 return json({available:!!settings.provider&&settings.enabled&&now.valueOf()<Date.parse(PRICE_EXPIRES),model:AI_MODEL,reports:result.results.map(publicReport),usage:{allocatedMicros:usage?.allocated||0,measuredMicros:usage?.measured||0,capMicros:settings.userCapMicros},customerBilling:false});
}
export async function generateAI(db:Database,userId:string,body:unknown,settings:AISettings,now:Date){
 const parsed=requestSchema.safeParse(body);if(!parsed.success)return json({error:'Choose a saved day and confirm using its data for AI analysis.'},400);
 const input=parsed.data;
 const requestId=input.predecessorId?input.requestId:`daily:${input.date}`;
 const existing=await getReport(db,userId,requestId);
 if(existing)return json({report:publicReport(existing)},existing.status==='generating'?202:200);
 if(!settings.enabled||!settings.provider)return json({error:'LifeApp’s AI connection needs to be activated by the app owner.'},503);
 if(now.valueOf()>=Date.parse(PRICE_EXPIRES))return json({error:'AI pricing needs a server-side update before more reviews can run.'},503);
 const pr=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{payload:string;version:number}>();
 if(!pr)return json({error:'Complete your setup first.'},400);
 const profile=profileSchema.parse({...JSON.parse(pr.payload),version:pr.version});
 const er=await db.prepare('SELECT payload,version FROM life_entries WHERE user_id=?1 AND entry_date=?2').bind(userId,input.date).first<{payload:string;version:number}>();
 if(!er)return json({error:'This day has no check-in. Finish it before requesting analysis.'},409);
 const entry={...JSON.parse(er.payload),version:er.version} as Entry;
 if(input.date>todayIn(profile.timezone,now)||!entry.complete||completionIssues(entry).length||entry.version!==input.sourceVersion)return json({error:'Finish and sync this day before requesting its review.'},409);
 const latest=await db.prepare('SELECT * FROM life_ai_reviews WHERE user_id=?1 AND entry_date=?2 ORDER BY revision DESC LIMIT 1').bind(userId,input.date).first<ReportRow>();
 if(input.predecessorId&&(!latest||latest.request_id!==input.predecessorId||latest.status!=='complete'||!input.critique))return json({error:'Choose the latest completed review and describe what you want changed.'},409);
 const previous=input.predecessorId?latest:null;
 const month=input.date.slice(0,7),budget=profile.modules.includes('money')?await readResource(db,userId,'budget',month):null;
 const tx=budget?await db.prepare("SELECT resource_id,payload,version FROM life_resources WHERE user_id=?1 AND kind='transaction' AND period=?2 LIMIT 501").bind(userId,month).all<{resource_id:string;payload:string;version:number}>():{results:[]};
 if(tx.results.length>500)return json({error:'This budget needs a larger-context review path before AI can summarize it.'},413);
 const workouts=profile.modules.includes('fitness')?await db.prepare("SELECT resource_id,payload,version FROM life_resources WHERE user_id=?1 AND kind='workout' AND period=?2 LIMIT 101").bind(userId,month).all<{resource_id:string;payload:string;version:number}>():{results:[]};
 if(workouts.results.length>100)return json({error:'This workout history exceeds the initial review context limit.'},413);
 const context=buildReviewContext({profile,from:input.date,through:input.date,entries:[entry],budget:budget||undefined,transactions:tx.results.map(r=>({id:r.resource_id,data:JSON.parse(r.payload),version:r.version})),workouts:workouts.results.map(r=>({id:r.resource_id,data:JSON.parse(r.payload),version:r.version}))});
 const snapshot=JSON.stringify({context,previousReview:previous?.report_text||null,revisionRequest:input.critique||null});
 if(new TextEncoder().encode(snapshot+systemInstruction).length>MAX_INPUT_BYTES)return json({error:'This day’s context exceeds the initial AI limit. It needs a larger-context review path.'},413);
 const revision=previous?previous.revision+1:1;
 // Atomic admission: duplicate keys, monthly reservations, unresolved attempts and
 // daily rate limits are checked in the same serialized SQLite insert.
 const admitted=await db.prepare(`INSERT INTO life_ai_reviews(user_id,request_id,entry_date,revision,source_version,predecessor_id,critique,status,input_snapshot,model,price_version,reserved_micros,created_at)
 SELECT ?1,?2,?3,?4,?5,?6,?7,'generating',?8,?9,?10,?11,?12
 WHERE (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_reviews WHERE user_id=?1 AND created_at>=?13)+?11<=?14
 AND (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_reviews WHERE created_at>=?13)+?11<=?15
 AND (SELECT COUNT(*) FROM life_ai_reviews WHERE user_id=?1 AND created_at>=?16)<5
 AND NOT EXISTS(SELECT 1 FROM life_ai_reviews WHERE error_code='cost_bound_exceeded')
 ON CONFLICT DO NOTHING RETURNING request_id`).bind(userId,requestId,input.date,revision,entry.version,previous?.request_id||null,input.critique,snapshot,AI_MODEL,PRICE_VERSION,RESERVATION_MICROS,now.toISOString(),inMonth(now),settings.userCapMicros,settings.globalCapMicros,now.toISOString().slice(0,10)+'T00:00:00.000Z').first<{request_id:string}>();
 if(!admitted){const duplicate=await getReport(db,userId,requestId);if(duplicate)return json({report:publicReport(duplicate)},202);return json({error:'AI usage is at its current limit, or a newer review already exists. Refresh the review history.'},429);}
 try{
  const result=await settings.provider.generate(snapshot);
  const exceeded=result.costMicros>RESERVATION_MICROS,valid=result.text.trim().length>0&&result.finishReason==='STOP'&&!exceeded;
  const row=await db.prepare(`UPDATE life_ai_reviews SET status=?3,report_text=?4,provider_id=?5,input_tokens=?6,output_tokens=?7,thought_tokens=?8,cost_micros=?9,finished_at=?10,error_code=?11,model=?12 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING *`).bind(userId,requestId,valid?'complete':'failed',result.text||null,result.providerId,result.inputTokens,result.outputTokens,result.thoughtTokens,result.costMicros,new Date().toISOString(),exceeded?'cost_bound_exceeded':valid?null:'incomplete_output',result.modelVersion).first<ReportRow>();
  if(!row)throw new Error('AI result could not be committed.');return json({report:publicReport(row)});
 }catch{
  // A timeout may have consumed provider tokens. Keep the reservation and NEVER
  // silently reissue an ambiguous request. No raw provider error or journal is logged.
  await db.prepare("UPDATE life_ai_reviews SET status='uncertain',error_code='provider_or_storage_unconfirmed',finished_at=?3 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id").bind(userId,requestId,new Date().toISOString()).first();
  return json({error:'AI completion could not be confirmed. This request will not be repeated automatically. Your entry is safe; its usage reservation is held for review.'},502);
 }
}
