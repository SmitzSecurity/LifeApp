import type {Database} from './service.ts';
import {workoutRecoverySchema} from './workout-recovery.ts';

// Operator-only grants permit one fresh, explicitly requested budget build.
// They do not settle, remove, or reduce the original unknown-cost reservation.
// Passing SQL expressions here is internal only; values remain bound parameters.
// Group predicates so nested admission checks fit D1's expression-depth limit.
function grantSourceSQL(user:string,source:string){return `(
 (g.user_id=${user} AND g.kind='ai-recovery' AND g.resource_id=${source})
 AND (json_extract(g.payload,'$.purpose')='budget'
  AND json_extract(g.payload,'$.sourceId')=g.resource_id
  AND source.request_id='budget:' || g.resource_id AND source.user_id=g.user_id)
 AND (source.status='uncertain' AND source.cost_micros IS NULL
  AND json_extract(source.input_snapshot,'$.recoveryOf') IS NULL
  AND source.created_at<=g.updated_at))`;}

/** Valid unused recovery authorization, evaluated inside the admission INSERT. */
export function budgetRecoverySQL(user:string,source:string,stamp:string){return `EXISTS(
 SELECT 1 FROM life_resources g JOIN life_routine_builds source ON source.user_id=g.user_id
 WHERE ${grantSourceSQL(user,source)}
 AND json_extract(g.payload,'$.expiresAt')>${stamp} AND g.updated_at<=${stamp}
 AND NOT EXISTS(SELECT 1 FROM life_routine_builds used WHERE used.user_id=g.user_id
 AND json_extract(used.input_snapshot,'$.recoveryOf')=g.resource_id))`;}

/** A spent grant only releases its original admission blocker after a known
 * recovery outcome. Expiry is checked at admission time, never against today.
 * Hidden/purged recovery jobs retain recoveryOf and continue to count. */
export function settledBudgetRecoverySQL(user:string,source:string){return `EXISTS(
 SELECT 1 FROM life_resources g JOIN life_routine_builds source ON source.user_id=g.user_id
 JOIN life_routine_builds recovered ON recovered.user_id=g.user_id
 WHERE ${grantSourceSQL(user,source)}
 AND recovered.request_id LIKE 'budget:%'
 AND json_extract(recovered.input_snapshot,'$.recoveryOf')=g.resource_id
 AND recovered.status IN ('complete','failed') AND recovered.cost_micros IS NOT NULL
 AND recovered.created_at>=g.updated_at
 AND recovered.created_at<json_extract(g.payload,'$.expiresAt'))`;}

/** An operator may acknowledge two diagnosed malformed requests without claiming
 * their provider costs are known. This suppresses only their admission blockers;
 * statuses, reservations, exact retries and the consumed grant remain intact. */
export function acknowledgedBudgetBlockerSQL(user:string,request:string){
 const ack="$.operatorAcknowledgement",stamp=`json_extract(g.payload,'${ack}.acknowledgedAt')`;
 const held=(alias:string)=>`(
 (${alias}.status='uncertain' AND ${alias}.error_code='provider_or_storage_unconfirmed'
  AND ${alias}.cost_micros IS NULL AND ${alias}.reserved_micros=200000)
 AND (${alias}.result_json IS NULL AND ${alias}.provider_id IS NULL
  AND ${alias}.input_tokens IS NULL AND ${alias}.output_tokens IS NULL AND ${alias}.thought_tokens IS NULL)
 AND (${alias}.finished_at IS NOT NULL AND ${alias}.created_at<=${alias}.finished_at AND ${alias}.finished_at<=${stamp}))`;
 return `EXISTS(SELECT 1 FROM life_resources g
 JOIN life_routine_builds source ON source.user_id=g.user_id AND source.request_id='budget:'||g.resource_id
 JOIN life_routine_builds recovered ON recovered.user_id=g.user_id AND recovered.request_id='budget:'||json_extract(g.payload,'${ack}.requestIds[1]')
 WHERE ${grantSourceSQL(user,'g.resource_id')}
 AND (json_extract(g.payload,'${ack}.reason')='invalid_output_mime_enum'
  AND json_type(g.payload,'${ack}.requestIds')='array' AND json_array_length(g.payload,'${ack}.requestIds')=2
  AND json_extract(g.payload,'${ack}.requestIds[0]')=g.resource_id
  AND json_extract(g.payload,'${ack}.requestIds[1]')<>g.resource_id)
 AND ((${request}=g.resource_id OR ${request}=json_extract(g.payload,'${ack}.requestIds[1]'))
  AND json_extract(recovered.input_snapshot,'$.recoveryOf')=g.resource_id
  AND NOT EXISTS(SELECT 1 FROM life_routine_builds other WHERE other.user_id=g.user_id
   AND json_extract(other.input_snapshot,'$.recoveryOf')=g.resource_id AND other.request_id<>recovered.request_id))
 AND (${held('source')} AND ${held('recovered')})
 AND (source.finished_at<=recovered.created_at
  AND recovered.created_at<json_extract(g.payload,'$.expiresAt')
  AND ${stamp}<=g.updated_at))`;
}

export async function availableBudgetRecovery(db:Database,userId:string,now:Date):Promise<{sourceId:string;expiresAt:string}|null>{
 const row=await db.prepare(`SELECT r.payload FROM life_resources r
 WHERE r.user_id=?1 AND r.kind='ai-recovery' AND ${budgetRecoverySQL('?1','r.resource_id','?2')}
 ORDER BY r.updated_at DESC LIMIT 1`).bind(userId,now.toISOString()).first<{payload:string}>();
 if(!row)return null;
 try{
  const grant=workoutRecoverySchema.safeParse(JSON.parse(row.payload));
  return grant.success&&grant.data.purpose==='budget'?{sourceId:grant.data.sourceId,expiresAt:grant.data.expiresAt}:null;
 }catch{return null;}
}
