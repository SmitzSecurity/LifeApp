import {budgetBuildInput,budgetBuildResult,budgetInstruction,BUDGET_INPUT_BYTES,parseBudgetDraft} from './budget-build-schema.ts';
import {limitsForAI} from './ai-limits.ts';
import {availableBudgetRecovery,budgetRecoverySQL,settledBudgetRecoverySQL} from './budget-recovery.ts';
import {z} from 'zod/v3';
import {availableWorkoutRecovery,recoverySQL} from './workout-recovery.ts';
import {visibleBuildSQL} from './record-deletion.ts';
import {parseWorkoutDraft,workoutBuildResult,trainingResult,workoutInstruction,trainingInstruction} from './workout-ai-schema.ts';
import type {Database} from './service.ts';
import type {AISettings} from './ai-service.ts';
import {AI_MODEL,PRICE_VERSION,PRICE_EXPIRES,RESERVATION_MICROS,MAX_INPUT_BYTES,AIInputRejected} from './ai-provider.ts';
import {routineBuildInput,suggestedRoutines,routineBuildResult,routineInstruction} from './routine-build-schema.ts';
import {exercisePresets} from './exercise-presets.ts';
type BuildRow={deleted?:boolean;resolvedBlocker?:boolean;request_id:string;status:string;input_snapshot:string;result_json:string|null;created_at:string;error_code:string|null};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
const publicBuild=(row:BuildRow)=>({description:JSON.parse(row.input_snapshot).description,...(row.request_id.startsWith('budget:')?{month:JSON.parse(row.input_snapshot).month,resolvedBlocker:!!row.resolvedBlocker}:{}),deleted:!!row.deleted,id:row.request_id.slice(row.request_id.indexOf(':')+1),status:row.status,errorCode:row.error_code,createdAt:row.created_at,result:row.result_json?(row.request_id.startsWith('budget:')?budgetBuildResult:row.request_id.startsWith('workout:')?workoutBuildResult:row.request_id.startsWith('training:')?trainingResult:routineBuildResult).parse(JSON.parse(row.result_json)):null});
const read=(db:Database,userId:string,id:string)=>db.prepare('SELECT request_id,status,input_snapshot,result_json,created_at,error_code FROM life_routine_builds WHERE user_id=?1 AND request_id=?2').bind(userId,id).first<BuildRow>();
export async function listRoutineBuilds(db:Database,userId:string,settings:AISettings,now:Date,purpose:'routine'|'workout'|'training'|'budget'='routine'){
 const rows=await db.prepare(`SELECT request_id,status,input_snapshot,result_json,created_at,error_code, NOT (${visibleBuildSQL('b')}) AS deleted, (b.request_id LIKE 'budget:%' AND ${settledBudgetRecoverySQL('?1','substr(b.request_id,8)')}) AS resolvedBlocker FROM life_routine_builds b WHERE user_id=?1 AND request_id LIKE ?2 ORDER BY created_at DESC LIMIT 30`).bind(userId,purpose+':%').all<BuildRow>();
 const recovery=purpose==='budget'?await availableBudgetRecovery(db,userId,now):purpose==='workout'?await availableWorkoutRecovery(db,userId,now):null;
 const blocked=purpose==='budget'?await db.prepare(`SELECT request_id FROM life_routine_builds b WHERE user_id=?1 AND status IN ('generating','uncertain') AND NOT (b.request_id LIKE 'budget:%' AND ${settledBudgetRecoverySQL('?1','substr(b.request_id,8)')}) AND b.request_id<>?2 LIMIT 1`).bind(userId,recovery?'budget:'+recovery.sourceId:'').first():null;
 return json({available:purpose!=='workout'&&settings.enabled&&!!settings.provider&&now.valueOf()<Date.parse(PRICE_EXPIRES),builds:rows.results.map(publicBuild),...(['workout','budget'].includes(purpose)?{recovery}:{}),...(purpose==='budget'?{blockedReason:blocked?'An earlier AI build has an unconfirmed outcome. Refresh status; it cannot be sent again.':null}:{})});
}
export async function buildRoutines(db:Database,userId:string,body:unknown,settings:AISettings,now:Date,purpose:'routine'|'workout'|'training'|'budget'='routine',evidence?:unknown){
 const limits=limitsForAI(settings,userId,now);
 const parsed=(purpose==='budget'?budgetBuildInput:routineBuildInput.extend({recoveryOf:z.string().uuid().optional()})).safeParse(body);if(!parsed.success)return json({error:'Check the description and attachment, then choose Build with AI.'},400);
 if('recoveryOf' in parsed.data&&parsed.data.recoveryOf&&!['workout','budget'].includes(purpose))return json({error:'Recovery is not available for this tool.'},400);
 const input={...parsed.data,recoveryOf:'recoveryOf' in parsed.data?parsed.data.recoveryOf:undefined},budget=purpose==='budget'?budgetBuildInput.parse(body):null,id=purpose+':'+input.requestId,existing=await read(db,userId,id);
 const image=budget?.image?{mimeType:budget.image.mimeType,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(budget.image.data)))).map(x=>x.toString(16).padStart(2,'0')).join('')}:undefined;
 const document=budget?.document?{mimeType:budget.document.mimeType,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(budget.document.data)))).map(x=>x.toString(16).padStart(2,'0')).join('')}:undefined;
 if(existing&&JSON.parse(existing.input_snapshot).purged)return json({error:'This generated content was permanently deleted.'},410);
 const matches=(row:BuildRow)=>{const saved=JSON.parse(row.input_snapshot);return saved.description===input.text&&saved.recoveryOf===input.recoveryOf&&(!budget||saved.month===budget.month&&JSON.stringify(saved.image)===JSON.stringify(image)&&JSON.stringify(saved.document)===JSON.stringify(document));};
 if(existing)return matches(existing)?json({build:publicBuild(existing)},existing.status==='generating'?202:200):json({error:'This request already belongs to another description. Start a new draft.'},409);
 if(!settings.enabled||!settings.provider||now.valueOf()>=Date.parse(PRICE_EXPIRES))return json({error:'This AI tool is currently unavailable. Your saved items remain available.'},503);
 const profile=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{payload:string;version:number}>();if(!profile)return json({error:'Complete your settings first.'},400);
 const snapshot=JSON.stringify(budget?{description:input.text,month:budget.month,...(input.recoveryOf?{recoveryOf:input.recoveryOf}:{}),...(image?{image}:{}),...(document?{document}:{}),moneyGoals:{goal:JSON.parse(profile.payload).moduleGoals?.money||'',budget:JSON.parse(profile.payload).budgetGoals||null}}:{description:input.text,...(input.recoveryOf?{recoveryOf:input.recoveryOf}:{}),...(purpose==='training'?{training:evidence}:{}),movementGoal:JSON.parse(profile.payload).moduleGoals?.fitness||'',defaultGoal:'Muscle growth with strength secondary',exerciseGuidance:purpose==='training'?[]:exercisePresets});
 if(new TextEncoder().encode(snapshot+(purpose==='budget'?budgetInstruction:purpose==='routine'?routineInstruction:purpose==='workout'?workoutInstruction:trainingInstruction)).length>(budget?BUDGET_INPUT_BYTES:MAX_INPUT_BYTES))return json({error:'Use a smaller file or shorten the description before building.'},413);
 const stamp=now.toISOString(),month=stamp.slice(0,7)+'-01T00:00:00.000Z',day=stamp.slice(0,10)+'T00:00:00.000Z';
 const admitted=await db.prepare(`INSERT INTO life_routine_builds(user_id,request_id,status,input_snapshot,model,price_version,reserved_micros,created_at)
 SELECT ?1,?2,'generating',?3,?4,?5,?6,?7
 WHERE (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_usage WHERE user_id=?1 AND created_at>=?8)+?6<=?9
 AND (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_usage WHERE created_at>=?8)+?6<=?10
 AND (SELECT COUNT(*) FROM life_ai_usage WHERE user_id=?1 AND created_at>=?11)<(${limits.dailyAttempts}+${purpose==='workout'?'?14':'0'})
 AND (SELECT COUNT(*) FROM life_ai_usage WHERE user_id=?1 AND request_id LIKE ?13 AND created_at>=?11)<(${limits.builderAttempts}+${purpose==='workout'?'?14':'0'})
 AND (?14=0 OR ${purpose==='budget'?budgetRecoverySQL('?1','?15','?7'):recoverySQL('?1','?15','?7','?16')})
 AND NOT EXISTS(SELECT 1 FROM life_ai_usage WHERE error_code='cost_bound_exceeded')
 AND NOT EXISTS(SELECT 1 FROM life_routine_builds pending WHERE user_id=?1 AND status IN ('generating','uncertain') AND NOT (pending.request_id LIKE 'budget:%' AND (${settledBudgetRecoverySQL('?1','substr(pending.request_id,8)')} OR (${purpose==='budget'?'1':'0'}=1 AND ?14=1 AND pending.request_id='budget:'||?15 AND ${budgetRecoverySQL('?1','?15','?7')}))))
 AND EXISTS(SELECT 1 FROM life_profiles WHERE user_id=?1 AND version=?12)
 AND NOT EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=?1)
 ON CONFLICT DO NOTHING RETURNING request_id`).bind(userId,id,snapshot,AI_MODEL,PRICE_VERSION,RESERVATION_MICROS,stamp,month,limits.userCapMicros,settings.globalCapMicros,day,profile.version,purpose+':%',input.recoveryOf?1:0,input.recoveryOf||'',...(purpose==='budget'?[]:[input.text])).first();
 if(!admitted){const duplicate=await read(db,userId,id);if(duplicate)return matches(duplicate)?json({build:publicBuild(duplicate)},duplicate.status==='generating'?202:200):json({error:'This request belongs to another description.'},409);return json({error:'The AI limit was reached, another build is unconfirmed, or your settings changed. Refresh the builder before trying again.'},429);}
 try{
  const result=await settings.provider.generate(snapshot,purpose,budget?.image||budget?.document),exceeded=result.costMicros>RESERVATION_MICROS;
  let draft=null,formatError=purpose==='workout'?(result.finishReason==='STOP'?'invalid_workout_schema':'workout_output_truncated'):purpose==='budget'?(result.finishReason==='STOP'?'invalid_budget_output':'budget_output_truncated'):'invalid_routine_output';if(result.finishReason==='STOP'&&!exceeded){try{if(purpose==='budget')draft=parseBudgetDraft(result.text);else if(purpose==='workout')draft=parseWorkoutDraft(result.text,stamp);else if(purpose==='training')draft=trainingResult.parse({text:result.text});else {const parsed=suggestedRoutines.parse(JSON.parse(result.text));draft=routineBuildResult.parse({notes:parsed.notes,routines:parsed.routines.map(r=>({id:crypto.randomUUID(),version:0,data:{...r,archived:false,exercises:r.exercises.map(e=>({...e,id:crypto.randomUUID()}))}}))});}}catch(e){if(purpose==='workout'&&e instanceof SyntaxError)formatError='invalid_workout_json';}}
  const status=draft?'complete':'failed',error=exceeded?'cost_bound_exceeded':draft?null:formatError,finished=new Date().toISOString();
  const row=await db.prepare(`UPDATE life_routine_builds SET status=?3,result_json=CASE WHEN json_extract(input_snapshot,'$.purged')=1 THEN NULL ELSE ?4 END,provider_id=CASE WHEN json_extract(input_snapshot,'$.purged')=1 THEN NULL ELSE ?5 END,input_tokens=?6,output_tokens=?7,thought_tokens=?8,cost_micros=?9,finished_at=?10,error_code=?11,model=?12 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING *`).bind(userId,id,status,draft?JSON.stringify(draft):null,result.providerId,result.inputTokens,result.outputTokens,result.thoughtTokens,result.costMicros,finished,error,result.modelVersion).first<BuildRow>();
  if(row)return json({build:publicBuild(row)});
  const archived=await db.prepare(`UPDATE life_deleted_ai_usage SET status=?3,input_tokens=?4,output_tokens=?5,thought_tokens=?6,cost_micros=?7,finished_at=?8,error_code=?9,model=?10 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id`).bind(userId,id,status,result.inputTokens,result.outputTokens,result.thoughtTokens,result.costMicros,finished,error,result.modelVersion).first();
  if(archived)return json({error:'The account was deleted; the routine draft was discarded.'},410);throw Error('Result not saved');
 }catch(error){
  const finished=new Date().toISOString();
  if(error instanceof AIInputRejected){
   const row=await db.prepare("UPDATE life_routine_builds SET status='failed',error_code='input_preflight_rejected',cost_micros=0,input_tokens=0,output_tokens=0,thought_tokens=0,finished_at=?3 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id").bind(userId,id,finished).first();
   if(!row)await db.prepare("UPDATE life_deleted_ai_usage SET status='failed',error_code='input_preflight_rejected',cost_micros=0,input_tokens=0,output_tokens=0,thought_tokens=0,finished_at=?3 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id").bind(userId,id,finished).first();
   return json({error:error.message},422);
  }
  const row=await db.prepare("UPDATE life_routine_builds SET status='uncertain',error_code='provider_or_storage_unconfirmed',finished_at=?3 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id").bind(userId,id,finished).first();
  if(!row)await db.prepare("UPDATE life_deleted_ai_usage SET status='uncertain',error_code='provider_or_storage_unconfirmed',finished_at=?3 WHERE user_id=?1 AND request_id=?2 AND status='generating' RETURNING request_id").bind(userId,id,finished).first();
  return json({error:'The build could not be confirmed. Refresh status; this request will not be sent again.'},502);
 }
}
