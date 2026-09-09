import { z } from 'zod/v3';
import { profileSchema,dateSchema,todayIn,type Entry } from './domain.ts';
import { completionIssues,cadenceSchema,type Cadence,type ReviewRecord } from './reviews.ts';
import {analysisWindow,duePeriod} from './analysis-periods.ts';
import {readPeriodConsent,PERIOD_POLICY} from './period-consent.ts';
import {readActivity} from './activity.ts';
import {buildPeriodContext} from './period-context.ts';
import { dailyJobStatus, dueDailyDate } from './scheduler.ts';
import { AUTOMATIC_POLICY, automaticAvailable, readAutomaticConsent } from './automatic-consent.ts';
import { buildReviewContext } from './review-context.ts';
import { readResource } from './resource-service.ts';
import type { Database } from './service.ts';
import { AI_MODEL,PRICE_VERSION,PRICE_EXPIRES,RESERVATION_MICROS,MAX_INPUT_BYTES,systemInstruction,type AIProvider } from './ai-provider.ts';
export type AISettings={provider:AIProvider|null;enabled:boolean;userCapMicros:number;globalCapMicros:number;automaticEnabled?:boolean};
export type ReportRow={user_id:string;request_id:string;entry_date:string;cadence:Cadence;window_start:string|null;revision:number;source_version:number;predecessor_id:string|null;critique:string;status:string;input_snapshot:string;report_text:string|null;model:string;price_version:string;provider_id:string|null;input_tokens:number|null;output_tokens:number|null;thought_tokens:number|null;reserved_micros:number;cost_micros:number|null;created_at:string;finished_at:string|null;error_code:string|null};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export const publicReport=(r:ReportRow)=>({id:r.request_id,date:r.entry_date,cadence:r.cadence||'daily',from:r.window_start||r.entry_date,revision:r.revision,sourceVersion:r.source_version,predecessorId:r.predecessor_id,critique:r.critique,status:r.status,text:r.report_text,inputTokens:r.input_tokens,outputTokens:r.output_tokens,thoughtTokens:r.thought_tokens,costMicros:r.cost_micros,reservedMicros:r.reserved_micros,model:r.model,createdAt:r.created_at,errorCode:r.error_code});
const requestSchema=z.object({date:dateSchema,cadence:cadenceSchema.default('daily'),requestId:z.string().uuid(),sourceVersion:z.number().int().positive(),predecessorId:z.string().max(80).nullable(),critique:z.string().trim().max(1000),consent:z.literal(true)}).strict();
async function getReport(db:Database,userId:string,id:string){return db.prepare('SELECT * FROM life_ai_reviews WHERE user_id=?1 AND request_id=?2').bind(userId,id).first<ReportRow>();}
const inMonth=(now:Date)=>now.toISOString().slice(0,7)+'-01T00:00:00.000Z';
export async function listAI(db:Database,userId:string,date:string|null,settings:AISettings,now:Date,cadence:Cadence='daily'){
 if(date&&!dateSchema.safeParse(date).success)return json({error:'Choose a valid review date.'},400);
 const result=await db.prepare(`SELECT * FROM life_ai_reviews WHERE user_id=?1 AND cadence=?2${date?' AND entry_date=?3':''} ORDER BY revision DESC,created_at DESC LIMIT 100`).bind(...(date?[userId,cadence,date]:[userId,cadence])).all<ReportRow>();
 const usage=await db.prepare("SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) AS allocated, COALESCE(SUM(cost_micros),0) AS measured FROM life_ai_usage WHERE user_id=?1 AND created_at>=?2").bind(userId,inMonth(now)).first<{allocated:number;measured:number}>();
 return json({available:!!settings.provider&&settings.enabled&&now.valueOf()<Date.parse(PRICE_EXPIRES),model:AI_MODEL,reports:result.results.map(publicReport),schedule:date&&cadence==='daily'?await dailyJobStatus(db,userId,date):null,automaticExecutionEnabled:automaticAvailable(settings,now),regenerationsRemaining:Math.max(0,2-result.results.filter(r=>r.revision>1&&r.created_at>=now.toISOString().slice(0,10)+'T00:00:00.000Z').length),usage:{allocatedMicros:usage?.allocated||0,measuredMicros:usage?.measured||0,capMicros:settings.userCapMicros},customerBilling:false});
}
// The final argument is server-only. HTTP callers can never supply automatic consent.
export async function generateAI(db:Database,userId:string,body:unknown,settings:AISettings,now:Date,automatic?:{consentVersion:number;cadence?:Cadence}){
 const parsed=requestSchema.safeParse(body);if(!parsed.success)return json({error:'Choose a saved day and confirm using its data for AI analysis.'},400);
 const input=parsed.data;
 const cadence=input.cadence,periodic=cadence!=='daily';
 let window;try{window=analysisWindow(cadence,input.date);}catch(e){return json({error:(e as Error).message},400);}
 const requestId=input.predecessorId?input.requestId:`${cadence}:${input.date}`;
 const existing=await getReport(db,userId,requestId);
 if(existing)return existing.entry_date===input.date&&(existing.cadence||'daily')===cadence?json({report:publicReport(existing)},existing.status==='generating'?202:200):json({error:'This request belongs to a different analysis. Refresh and try again.'},409);
 if(!settings.enabled||!settings.provider)return json({error:'LifeApp’s AI connection needs to be activated by the app owner.'},503);
 if(now.valueOf()>=Date.parse(PRICE_EXPIRES))return json({error:'AI pricing needs a server-side update before more reviews can run.'},503);
 const consent=automatic?(periodic?await readPeriodConsent(db,userId):await readAutomaticConsent(db,userId)):null;
 if(automatic&&((automatic.cadence||'daily')!==cadence||!automaticAvailable(settings,now)||!consent?.enabled||consent.version!==automatic.consentVersion||!consent.startDate||input.date<consent.startDate||input.predecessorId))return json({error:'Automatic analysis is not authorized for this period.'},409);
 const pr=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{payload:string;version:number}>();
 if(!pr)return json({error:'Complete your setup first.'},400);
 const profile=profileSchema.parse({...JSON.parse(pr.payload),version:pr.version});
 const due=automatic?(periodic?duePeriod(profile,cadence,now)?.through:dueDailyDate(profile,now)):null;
 if(automatic&&(!due||input.date>due))return json({error:'This analysis is not due under your saved schedule.'},409);
 if(periodic&&input.date>=todayIn(profile.timezone,now))return json({error:'This period has not ended yet.'},409);
 const source=await db.prepare('SELECT payload,version FROM life_entries WHERE user_id=?1 AND entry_date>=?2 AND entry_date<=?3 ORDER BY entry_date LIMIT 367').bind(userId,window.from,window.through).all<{payload:string;version:number}>();
 const entries=source.results.map(r=>({...JSON.parse(r.payload),version:r.version})) as Entry[],entry=entries[0];
 const eligible=entries.filter(e=>e.complete&&!completionIssues(e).length);
 if(!eligible.length)return json({error:'Save a complete journal entry before generating this analysis.'},409);
 if(!periodic&&(input.date>todayIn(profile.timezone,now)||!entry?.complete||completionIssues(entry).length||entry.version!==input.sourceVersion))return json({error:'Save a complete response before generating its analysis.'},409);
 if(periodic&&profile.version!==input.sourceVersion)return json({error:'Your preferences changed. Refresh before generating this analysis.'},409);
 const latest=await db.prepare('SELECT * FROM life_ai_reviews WHERE user_id=?1 AND entry_date=?2 AND cadence=?3 ORDER BY revision DESC LIMIT 1').bind(userId,input.date,cadence).first<ReportRow>();
 if(input.predecessorId&&(!latest||latest.request_id!==input.predecessorId||latest.status!=='complete'))return json({error:'Refresh to open the latest completed analysis.'},409);
 const previous=input.predecessorId?latest:null;
 const month=input.date.slice(0,7),budget=!periodic?await readResource(db,userId,'budget',month):null;
 if(!profile.budgetGoals){const goalPlan=budget||await db.prepare("SELECT payload FROM life_resources WHERE user_id=?1 AND kind='budget' ORDER BY period DESC LIMIT 1").bind(userId).first<{payload:string}>();if(goalPlan)profile.budgetGoals='data' in goalPlan?goalPlan.data.goals:JSON.parse(goalPlan.payload).goals;}
 const activity=await readActivity(db,userId,periodic?window.from:month+'-01',input.date);
 const prior=periodic?await db.prepare("SELECT request_id,entry_date,window_start,cadence,revision,report_text FROM life_ai_reviews WHERE user_id=?1 AND status='complete' AND entry_date>=?2 AND entry_date<=?3 AND cadence<>?4 ORDER BY CASE cadence WHEN 'monthly' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END,entry_date DESC,revision DESC LIMIT 100").bind(userId,window.from,window.through,cadence).all<{request_id:string;entry_date:string;window_start:string|null;cadence:Cadence;revision:number;report_text:string}>():{results:[]};
 const allowed=cadence==='weekly'?['daily']:cadence==='monthly'?['weekly','daily']:['monthly','weekly','daily'];
 const seen=new Set<string>();
 const evidence:ReviewRecord[]=prior.results.filter(r=>{const key=r.cadence+':'+r.entry_date;if(!allowed.includes(r.cadence)||seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>allowed.indexOf(a.cadence)-allowed.indexOf(b.cadence)).map(r=>({id:r.request_id,cadence:r.cadence,from:r.window_start||r.entry_date,through:r.entry_date,status:'complete',revision:r.revision,content:r.report_text}));
 const context=periodic?buildPeriodContext(profile,cadence,window.from,window.through,entries,activity,evidence):buildReviewContext({profile,from:input.date,through:input.date,entries:[entry],budget:budget||undefined,...activity});
 const critique=input.predecessorId?(input.critique||'Regenerate using the current saved context and guidance.'):'';
 const snapshot=JSON.stringify({context,previousReview:previous?.report_text||null,revisionRequest:critique||null,...(consent?{automaticConsent:{version:consent.version,policyVersion:periodic?PERIOD_POLICY:AUTOMATIC_POLICY,startDate:consent.startDate,acceptedAt:consent.acceptedAt}}:{})});
 if(new TextEncoder().encode(snapshot+systemInstruction).length>MAX_INPUT_BYTES)return json({error:'This day’s context exceeds the initial AI limit. It needs a larger-context review path.'},413);
 const revision=previous?previous.revision+1:1;
 // Atomic admission: duplicate keys, monthly reservations, unresolved attempts and
 // daily rate limits are checked in the same serialized SQLite insert.
 const admitted=await db.prepare(`INSERT INTO life_ai_reviews(user_id,request_id,entry_date,revision,source_version,predecessor_id,critique,status,input_snapshot,model,price_version,reserved_micros,created_at,cadence,window_start)
 SELECT ?1,?2,?3,?4,?5,?6,?7,'generating',?8,?9,?10,?11,?12,?18,?19
 WHERE (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_usage WHERE user_id=?1 AND created_at>=?13)+?11<=?14
 AND (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_usage WHERE created_at>=?13)+?11<=?15
 AND (SELECT COUNT(*) FROM life_ai_usage WHERE user_id=?1 AND created_at>=?16)<5
 AND NOT EXISTS(SELECT 1 FROM life_ai_usage WHERE error_code='cost_bound_exceeded')
 AND EXISTS(SELECT 1 FROM life_profiles WHERE user_id=?1 AND version=?17)
 AND (SELECT COUNT(*) FROM life_ai_reviews WHERE user_id=?1 AND cadence=?18 AND entry_date=?3 AND revision>1 AND created_at>=?16)<2
 AND (SELECT COALESCE(SUM(version),0) FROM life_entries WHERE user_id=?1 AND entry_date>=?19 AND entry_date<=?3)=?20
 AND (SELECT COUNT(*) FROM life_entries WHERE user_id=?1 AND entry_date>=?19 AND entry_date<=?3)=?21
 ${automatic?(periodic?`AND EXISTS(SELECT 1 FROM life_period_consent WHERE user_id=?1 AND enabled=1 AND version=?22 AND policy_version=?23 AND start_date<=?3)`:`AND (
  EXISTS(SELECT 1 FROM life_automatic_consent WHERE user_id=?1 AND enabled=1 AND version=?22 AND policy_version=?23 AND start_date<=?3)
  AND EXISTS(SELECT 1 FROM life_daily_job_status WHERE user_id=?1 AND entry_date=?3 AND state='ready' AND source_version=?5)
 )`):''}
 ON CONFLICT DO NOTHING RETURNING request_id`).bind(userId,requestId,input.date,revision,periodic?profile.version:entry.version,previous?.request_id||null,critique,snapshot,AI_MODEL,PRICE_VERSION,RESERVATION_MICROS,now.toISOString(),inMonth(now),settings.userCapMicros,settings.globalCapMicros,now.toISOString().slice(0,10)+'T00:00:00.000Z',pr.version,cadence,window.from,entries.reduce((n,e)=>n+e.version,0),entries.length,...(automatic?[automatic.consentVersion,periodic?PERIOD_POLICY:AUTOMATIC_POLICY]:[])).first<{request_id:string}>();
 if(!admitted){const duplicate=await getReport(db,userId,requestId);if(duplicate)return json({report:publicReport(duplicate)},202);return json({error:'The analysis limit has been reached, or the saved context changed. Refresh first; if the limit remains, try again tomorrow.'},429);}
 try{
  const result=await settings.provider.generate(snapshot);
  const exceeded=result.costMicros>RESERVATION_MICROS,valid=result.text.trim().length>0&&result.finishReason==='STOP'&&!exceeded;
  const row=await db.prepare(`UPDATE life_ai_reviews SET status=?3,report_text=?4,provider_id=?5,input_tokens=?6,output_tokens=?7,thought_tokens=?8,cost_micros=?9,finished_at=?10,error_code=?11,model=?12 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING *`).bind(userId,requestId,valid?'complete':'failed',result.text||null,result.providerId,result.inputTokens,result.outputTokens,result.thoughtTokens,result.costMicros,new Date().toISOString(),exceeded?'cost_bound_exceeded':valid?null:'incomplete_output',result.modelVersion).first<ReportRow>();
  if(!row){
   // Deletion can win while Gemini is running. Settle only accounting; never
   // restore the input, report, critique or provider response identifier.
   const archived=await db.prepare(`UPDATE life_deleted_ai_usage SET status=?3,input_tokens=?4,output_tokens=?5,thought_tokens=?6,cost_micros=?7,finished_at=?8,error_code=?9,model=?10 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id`).bind(userId,requestId,valid?'complete':'failed',result.inputTokens,result.outputTokens,result.thoughtTokens,result.costMicros,new Date().toISOString(),exceeded?'cost_bound_exceeded':valid?null:'incomplete_output',result.modelVersion).first();
   if(archived)return json({error:'This account was deleted. Its AI report has been discarded.'},410);
   throw new Error('AI result could not be committed.');
  }
  return json({report:publicReport(row)});
 }catch{
  // A timeout may have consumed provider tokens. Keep the reservation and NEVER
  // silently reissue an ambiguous request. No raw provider error or journal is logged.
  const uncertain=await db.prepare("UPDATE life_ai_reviews SET status='uncertain',error_code='provider_or_storage_unconfirmed',finished_at=?3 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id").bind(userId,requestId,new Date().toISOString()).first();
  if(!uncertain){
   const archived=await db.prepare("UPDATE life_deleted_ai_usage SET status='uncertain',error_code='provider_or_storage_unconfirmed',finished_at=?3 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id").bind(userId,requestId,new Date().toISOString()).first();
   if(archived)return json({error:'This account was deleted. An unconfirmed AI cost remains reserved.'},410);
  }
  return json({error:'AI completion could not be confirmed. This request will not be repeated automatically. Your entry is safe; its usage reservation is held for review.'},502);
 }
}
