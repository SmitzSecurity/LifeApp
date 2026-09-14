import {trashState,retentionMs} from './trash.ts';
import {z} from 'zod/v3';
import {dateSchema} from './domain.ts';
import type {Database} from './service.ts';
const input=z.object({kind:z.enum(['entry','analysis','build']),id:z.string().min(1).max(80),version:z.number().int().positive().optional(),deleted:z.boolean()}).strict();
export const visibleAnalysisSQL=(table='life_ai_reviews')=>`NOT EXISTS(SELECT 1 FROM life_trash purged WHERE purged.user_id=${table}.user_id AND purged.kind='analysis' AND purged.record_id=${table}.request_id AND purged.purged_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM life_resources hidden WHERE hidden.user_id=${table}.user_id AND hidden.kind='visibility' AND hidden.resource_id='analysis:'||${table}.request_id AND json_extract(hidden.payload,'$.deleted')=1)`;
export const visibleBuildSQL=(table='life_routine_builds')=>`NOT EXISTS(SELECT 1 FROM life_trash purged WHERE purged.user_id=${table}.user_id AND purged.kind='build' AND purged.record_id=${table}.request_id AND purged.purged_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM life_resources hidden WHERE hidden.user_id=${table}.user_id AND hidden.kind='visibility' AND hidden.resource_id='build:'||${table}.request_id AND json_extract(hidden.payload,'$.deleted')=1)`;
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
export async function setRecordDeleted(db:Database,userId:string,body:unknown,now:Date){
 const parsed=input.safeParse(body);if(!parsed.success)return json({error:'Choose a saved record.'},400);
 const p=parsed.data;
 const trash=await trashState(db,userId,p.kind,p.id);
 if(trash?.purged_at||!p.deleted&&trash&&Date.parse(trash.deleted_at)+retentionMs<=now.valueOf())return json({error:'This item can no longer be restored.'},410);
 if(p.kind==='entry'){
  if(!dateSchema.safeParse(p.id).success||!p.version)return json({error:'Choose a saved journal entry.'},400);
  const row=await db.prepare('SELECT payload,version FROM life_entries WHERE user_id=?1 AND entry_date=?2').bind(userId,p.id).first<{payload:string;version:number}>();
  if(!row)return json({error:'Entry not found.'},404);
  const old=JSON.parse(row.payload);if(!!old.deleted===p.deleted)return json({saved:true});
  if(row.version!==p.version)return json({error:'This entry changed. Refresh before deleting or restoring it.'},409);
  const data={...old,deleted:p.deleted,complete:p.deleted?false:!!old.deletedComplete,deletedComplete:p.deleted?!!old.complete:undefined};
  const saved=await db.prepare('UPDATE life_entries SET payload=?3,version=version+1,updated_at=?4 WHERE user_id=?1 AND entry_date=?2 AND version=?5 RETURNING version').bind(userId,p.id,JSON.stringify(data),now.toISOString(),p.version).first();
  return saved?json({saved:true}):json({error:'This entry changed. Refresh before trying again.'},409);
 }
 const table=p.kind==='analysis'?'life_ai_reviews':'life_routine_builds';
 const exists=await db.prepare(`SELECT request_id FROM ${table} WHERE user_id=?1 AND request_id=?2`).bind(userId,p.id).first();
 if(!exists)return json({error:'Record not found.'},404);
 // Visibility is separate from the immutable output and accounting record. A
 // hidden generating/uncertain job continues to hold usage and block duplicates.
 await db.prepare(`INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at,active_slot) VALUES(?1,'visibility',?2,'',?3,1,?4,NULL)
 ON CONFLICT(user_id,kind,resource_id) DO UPDATE SET payload=excluded.payload,version=life_resources.version+1,updated_at=excluded.updated_at RETURNING resource_id`).bind(userId,p.kind+':'+p.id,JSON.stringify({target:p.kind,id:p.id,deleted:p.deleted}),now.toISOString()).first();
 if(p.kind==='analysis'&&p.deleted)await db.prepare("UPDATE life_email_outbox SET state='cancelled',finished_at=?3,error_code='analysis_deleted' WHERE user_id=?1 AND request_id=?2 AND state IN ('pending','retry') RETURNING request_id").bind(userId,p.id,now.toISOString()).first();
 return json({saved:true});
}
