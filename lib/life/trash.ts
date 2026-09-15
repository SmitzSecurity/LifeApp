import {formatDate,formatMonth} from './date-display.ts';
import {z} from 'zod/v3';
import type {Database} from './service.ts';

export const trashKinds=['entry','transaction','recurring','workout','cardio','workout-note','analysis','build'] as const;
export const retentionMs=7*24*60*60*1000;
export const trashRowSchema=z.object({kind:z.enum(trashKinds),record_id:z.string().min(1).max(90),deleted_at:z.string().datetime(),purged_at:z.string().datetime().nullable(),record_version:z.number().int().positive().nullable()}).strict();
type TrashRow=z.infer<typeof trashRowSchema>;
export type TrashItem={kind:TrashRow['kind'];id:string;deletedAt:string;expiresAt:string;title:string;detail:string};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
const cutoff=(now:Date)=>new Date(now.valueOf()-retentionMs).toISOString();
export async function trashState(db:Database,userId:string,kind:string,id:string){return db.prepare('SELECT kind,record_id,deleted_at,purged_at,record_version FROM life_trash WHERE user_id=?1 AND kind=?2 AND record_id=?3').bind(userId,kind,id).first<TrashRow>();}
export async function listTrash(db:Database,userId:string,offset=0){
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return json({error:'Invalid Trash page.'},400);
 const rows=await db.prepare(`SELECT t.*,COALESCE(e.payload,r.payload) payload,a.cadence,a.entry_date FROM life_trash t
 LEFT JOIN life_entries e ON t.kind='entry' AND e.user_id=t.user_id AND e.entry_date=t.record_id
 LEFT JOIN life_resources r ON r.user_id=t.user_id AND r.kind=CASE WHEN t.kind='recurring' THEN 'budget' ELSE t.kind END AND r.resource_id=CASE WHEN t.kind='recurring' THEN substr(t.record_id,1,7) ELSE t.record_id END
 LEFT JOIN life_ai_reviews a ON t.kind='analysis' AND a.user_id=t.user_id AND a.request_id=t.record_id
 WHERE t.user_id=?1 AND t.purged_at IS NULL ORDER BY t.deleted_at,t.kind,t.record_id LIMIT 51 OFFSET ?2`).bind(userId,offset).all<TrashRow&{payload:string|null;cadence:string|null;entry_date:string|null}>();
 const items:TrashItem[]=rows.results.slice(0,50).map(row=>{
  const {kind,record_id:id}=row,data=row.payload?JSON.parse(row.payload):{},item=kind==='recurring'?data.recurring?.find((x:{id:string})=>x.id===id.slice(8)):data;
  let title=item?.title||item?.name||item?.activity||({entry:'Journal','workout-note':'Workout note',transaction:'Transaction',analysis:'Analysis',build:id.startsWith('training:')?'Training analysis':'AI draft'} as Record<string,string>)[kind]||kind;
  let detail=item?.date?formatDate(item.date):'';
  if(kind==='entry'){title+=' · '+formatDate(id);detail=data.journal?.slice(0,140)||'';}
  if(kind==='analysis'){title=(row.cadence||'Daily')+' analysis';detail=row.entry_date?formatDate(row.entry_date):'';}
  if(kind==='recurring')detail=formatMonth(id.slice(0,7));
  if(kind==='transaction')detail+=` · $${(item.amountCents/100).toFixed(2)} · ${item.note}`;
  if(kind==='workout-note')detail+=' · '+(item.text||'').slice(0,100);
  return {kind,id,title,detail,deletedAt:row.deleted_at,expiresAt:new Date(Date.parse(row.deleted_at)+retentionMs).toISOString()};
 });
 return json({items,nextOffset:rows.results.length>50?offset+50:null});
}
const actionSchema=z.object({kind:z.enum(trashKinds),id:z.string().min(1).max(90),deletedAt:z.string().datetime(),operation:z.enum(['restore','purge'])}).strict();
export async function changeTrash(db:Database,userId:string,body:unknown,now:Date){
 const parsed=actionSchema.safeParse(body);if(!parsed.success)return json({error:'Choose an item in Trash.'},400);
 const p=parsed.data,row=await trashState(db,userId,p.kind,p.id);
 if(!row)return json({error:'This item is no longer in Trash. Refresh the list.'},409);
 if(row.purged_at)return p.operation==='purge'?json({saved:true}):json({error:'This item was permanently deleted.'},410);
 if(row.deleted_at!==p.deletedAt)return json({error:'This item changed. Refresh Trash first.'},409);
 if(p.operation==='purge'){
  // The migration trigger removes content in this same atomic statement. Usage
  // and opaque tombstones remain; a failure rolls the complete operation back.
  const done=await db.prepare('UPDATE life_trash SET purged_at=?4 WHERE user_id=?1 AND kind=?2 AND record_id=?3 AND deleted_at=?5 AND purged_at IS NULL RETURNING record_id').bind(userId,p.kind,p.id,now.toISOString(),p.deletedAt).first();
  return done?json({saved:true}):json({error:'This item changed. Refresh Trash first.'},409);
 }
 if(row.deleted_at<=cutoff(now))return json({error:'The seven-day restore period has ended.'},410);
 const guard="EXISTS(SELECT 1 FROM life_trash t WHERE t.user_id=?1 AND t.kind=?4 AND t.record_id=?5 AND t.deleted_at=?6 AND t.purged_at IS NULL AND t.deleted_at>?7)";
 let sql:string,kind:string=p.kind,id=p.id;
 if(p.kind==='entry')sql=`UPDATE life_entries SET payload=json_remove(json_set(payload,'$.deleted',json('false'),'$.complete',json(CASE WHEN json_extract(payload,'$.deletedComplete')=1 THEN 'true' ELSE 'false' END)),'$.deletedComplete'),version=version+1,updated_at=?3 WHERE user_id=?1 AND entry_date=?2 AND ${guard} RETURNING version`;
 else if(p.kind==='analysis'||p.kind==='build'){
  kind='visibility';id=p.kind+':'+p.id;
  sql=`UPDATE life_resources SET payload=json_set(payload,'$.deleted',json('false')),version=version+1,updated_at=?3 WHERE user_id=?1 AND kind='visibility' AND resource_id=?2 AND ${guard} RETURNING version`;
 }else if(p.kind==='recurring'){
  kind='budget';id=p.id.slice(0,7);
  sql=`UPDATE life_resources SET payload=json_set(payload,'$.recurring['||(SELECT key FROM json_each(payload,'$.recurring') WHERE json_extract(value,'$.id')=substr(?5,9))||'].deleted',json('false'),'$.recurring['||(SELECT key FROM json_each(payload,'$.recurring') WHERE json_extract(value,'$.id')=substr(?5,9))||'].active',json('true')),version=version+1,updated_at=?3 WHERE user_id=?1 AND kind='budget' AND resource_id=?2 AND ${guard} RETURNING version`;
 }else sql=`UPDATE life_resources SET payload=json_set(payload,'$.deleted',json('false')),active_slot=CASE WHEN kind='workout' AND json_extract(payload,'$.finishedAt') IS NULL THEN 'active' ELSE NULL END,version=version+1,updated_at=?3 WHERE user_id=?1 AND kind='${kind}' AND resource_id=?2 AND ${guard} RETURNING version`;
 try {const done=await db.prepare(sql).bind(userId,id,now.toISOString(),p.kind,p.id,p.deletedAt,cutoff(now)).first();return done?json({saved:true}):json({error:'This item changed. Refresh Trash first.'},409);}catch{return json({error:p.kind==='workout'?'Finish your current workout before restoring an unfinished session.':'This item changed. Refresh Trash and try again.'},409);}
}
export async function purgeExpiredTrash(db:Database,now:Date){
 // Retire pre-release revisions as well as future revisions handled by triggers.
 // At most twenty candidates enter maintenance per tick; no provider call occurs.
 await db.prepare(`INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at)
 SELECT user_id,kind,record_id,?1,NULL FROM (
 SELECT old.user_id,'analysis' kind,old.request_id record_id FROM life_ai_reviews old
 WHERE old.status='complete' AND old.report_text IS NOT NULL AND EXISTS(SELECT 1 FROM life_ai_reviews newer WHERE newer.user_id=old.user_id AND newer.cadence=old.cadence AND newer.entry_date=old.entry_date AND newer.revision>old.revision AND newer.status='complete' AND newer.report_text IS NOT NULL)
 UNION ALL
 SELECT old.user_id,'build' kind,old.request_id record_id FROM life_routine_builds old
 WHERE old.request_id LIKE 'training:%' AND old.status='complete' AND old.result_json IS NOT NULL AND EXISTS(SELECT 1 FROM life_routine_builds newer WHERE newer.user_id=old.user_id AND newer.request_id LIKE 'training:%' AND newer.created_at>old.created_at AND newer.status='complete' AND newer.result_json IS NOT NULL AND json_extract(newer.input_snapshot,'$.training.from')=json_extract(old.input_snapshot,'$.training.from'))
 ) WHERE true LIMIT 20 ON CONFLICT DO NOTHING`).bind(now.toISOString()).first();
 // The existing five-minute Cron also cleans up when AI/email are disabled.
 return db.prepare(`UPDATE life_trash SET purged_at=?1 WHERE (user_id,kind,record_id) IN (
 SELECT t.user_id,t.kind,t.record_id FROM life_trash t WHERE t.purged_at IS NULL AND (
 t.deleted_at<=?2 OR t.kind='analysis' AND EXISTS(SELECT 1 FROM life_ai_reviews old JOIN life_ai_reviews newer ON newer.user_id=old.user_id AND newer.cadence=old.cadence AND newer.entry_date=old.entry_date AND newer.revision>old.revision AND newer.status='complete' AND newer.report_text IS NOT NULL WHERE old.user_id=t.user_id AND old.request_id=t.record_id AND old.status='complete')
 OR t.kind='build' AND EXISTS(SELECT 1 FROM life_routine_builds old JOIN life_routine_builds newer ON newer.user_id=old.user_id AND newer.request_id LIKE 'training:%' AND newer.created_at>old.created_at AND newer.status='complete' AND newer.result_json IS NOT NULL AND json_extract(newer.input_snapshot,'$.training.from')=json_extract(old.input_snapshot,'$.training.from') WHERE old.user_id=t.user_id AND old.request_id=t.record_id AND old.request_id LIKE 'training:%' AND old.status='complete'))
 ORDER BY t.deleted_at LIMIT 50) RETURNING kind`).bind(now.toISOString(),cutoff(now)).all();
}
