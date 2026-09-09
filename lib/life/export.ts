import type {Database} from './service.ts';
// A private, account-scoped backup. Auth sessions, OAuth credentials and another
// account's rows are intentionally never part of this portable data format.
export async function exportAccount(db:Database,userId:string,now:Date){
 const profile=await db.prepare('SELECT payload,version,updated_at FROM life_profiles WHERE user_id=?1').bind(userId).first();
 const tables=[['entries','life_entries'],['resources','life_resources'],['reviews','life_ai_reviews']] as const;
 const data:Record<string,unknown>={profile};
 let estimatedBytes=65536;
 for(const [name,table] of tables){
  const content=table==='life_ai_reviews'?"COALESCE(input_snapshot,'')||COALESCE(report_text,'')":"payload";
  const size=await db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(LENGTH(CAST(${content} AS BLOB))),0) AS bytes FROM ${table} WHERE user_id=?1`).bind(userId).first<{n:number;bytes:number}>();
  estimatedBytes+=(size?.bytes||0)*2+(size?.n||0)*1024;
  if(estimatedBytes>8*1024*1024)return Response.json({error:'Your history needs a paginated export. No partial backup was produced.'},{status:413});
  const rows=await db.prepare(`SELECT * FROM ${table} WHERE user_id=?1 LIMIT 10001`).bind(userId).all<Record<string,unknown>>();
  if(rows.results.length>10000)return Response.json({error:'Your history needs a paginated export. No partial backup was produced.'},{status:413});
  data[name]=rows.results.map(({user_id,...row})=>row);
 }
 const consent=await db.prepare('SELECT enabled,version,policy_version,recipient,enabled_at,updated_at FROM life_email_consent WHERE user_id=?1').bind(userId).first();
 const count=await db.prepare('SELECT COUNT(*) AS n FROM life_email_outbox WHERE user_id=?1').bind(userId).first<{n:number}>();
 if((count?.n||0)>10000||estimatedBytes+(count?.n||0)*2048>8*1024*1024)return Response.json({error:'Your history needs a paginated export. No partial backup was produced.'},{status:413});
 const deliveries=await db.prepare('SELECT request_id,consent_version,state,attempts,created_at,next_attempt_at,last_attempt_at,finished_at,message_id,error_code FROM life_email_outbox WHERE user_id=?1 LIMIT 10001').bind(userId).all();
 if(deliveries.results.length>10000)return Response.json({error:'Your history needs a paginated export. No partial backup was produced.'},{status:413});
 const periodicConsent=await db.prepare('SELECT enabled,version,policy_version,start_date,accepted_at,updated_at FROM life_period_consent WHERE user_id=?1').bind(userId).first();
 const text=JSON.stringify({format:'lifeapp-portable-v1',exportedAt:now.toISOString(),...data,email:{consent,deliveries:deliveries.results},periodicConsent},null,2);
 if(new TextEncoder().encode(text).length>8*1024*1024)return Response.json({error:'Your history needs a paginated export. No partial backup was produced.'},{status:413});
 return new Response(text,{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="LifeApp-private-backup.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
