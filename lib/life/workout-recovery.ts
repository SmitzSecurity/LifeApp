import {z} from 'zod/v3';
import type {Database} from './service.ts';

const operatorAcknowledgement=z.object({reason:z.literal('invalid_output_mime_enum'),requestIds:z.tuple([z.string().uuid(),z.string().uuid()]),acknowledgedAt:z.string().datetime().refine(value=>{try{return new Date(value).toISOString()===value;}catch{return false;}})}).strict();
export const workoutRecoverySchema=z.object({sourceId:z.string().uuid(),expiresAt:z.string().datetime(),purpose:z.literal('budget').optional(),operatorAcknowledgement:operatorAcknowledgement.optional()}).strict().superRefine((grant,context)=>{
 const acknowledgement=grant.operatorAcknowledgement;
 if(acknowledgement&&(grant.purpose!=='budget'||acknowledgement.requestIds[0]!==grant.sourceId||acknowledgement.requestIds[1]===grant.sourceId))context.addIssue({code:'custom',message:'An operator acknowledgment must identify the budget source and its distinct consumed recovery.'});
});
// Grants are operator-issued, account-scoped resources. Admission consumes a
// grant by recording recoveryOf on the new job in the same atomic INSERT.
// Failed, hidden and uncertain recovery jobs all count as consumption.
export function recoverySQL(user:string,source:string,stamp:string,description?:string){return `EXISTS(
 SELECT 1 FROM life_resources g JOIN life_routine_builds source
 ON source.user_id=g.user_id AND source.request_id='workout:' || g.resource_id
 WHERE g.user_id=${user} AND g.kind='ai-recovery' AND g.resource_id=${source}
 AND json_extract(g.payload,'$.purpose') IS NULL
 AND json_extract(g.payload,'$.sourceId')=g.resource_id
 AND json_extract(g.payload,'$.expiresAt')>${stamp} AND g.updated_at<=${stamp}
 AND source.status='failed' AND source.cost_micros IS NOT NULL
 AND source.error_code IN ('invalid_routine_output','invalid_workout_json','invalid_workout_schema','workout_output_truncated')
 ${description?`AND json_extract(source.input_snapshot,'$.description')=${description}`:''}
 AND NOT EXISTS(SELECT 1 FROM life_routine_builds used WHERE used.user_id=g.user_id
 AND json_extract(used.input_snapshot,'$.recoveryOf')=g.resource_id))`;}
export async function availableWorkoutRecovery(db:Database,userId:string,now:Date){
 const row=await db.prepare(`SELECT r.resource_id, r.payload, b.input_snapshot FROM life_resources r
 JOIN life_routine_builds b ON b.user_id=r.user_id AND b.request_id='workout:' || r.resource_id
 WHERE r.user_id=?1 AND r.kind='ai-recovery' AND ${recoverySQL('?1','r.resource_id','?2')}
 ORDER BY r.updated_at DESC LIMIT 1`).bind(userId,now.toISOString()).first<{resource_id:string;payload:string;input_snapshot:string}>();
 if(!row)return null;
 const grant=workoutRecoverySchema.safeParse(JSON.parse(row.payload));
 return grant.success?{...grant.data,description:JSON.parse(row.input_snapshot).description as string}:null;
}
