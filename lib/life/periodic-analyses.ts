import {profileSchema} from './domain.ts';
import {periodCadences,duePeriod} from './analysis-periods.ts';
import {PERIOD_POLICY} from './period-consent.ts';
import {automaticAvailable} from './automatic-consent.ts';
import {generateAI,type AISettings} from './ai-service.ts';
import type {Database} from './service.ts';
// One eligible account and at most one provider admission per periodic tick.
// The durable cursor rotates accounts even when a period has no complete entries.
export async function consumePeriodicAnalyses(db:Database,settings:AISettings,clock=()=>new Date()){
 const stats={considered:0,completed:0,deferred:0,attention:0};if(!automaticAvailable(settings,clock()))return stats;
 const rows=await db.prepare(`SELECT p.user_id,p.payload,p.version,c.version consent_version,c.start_date FROM life_profiles p JOIN life_period_consent c ON c.user_id=p.user_id
 WHERE c.enabled=1 AND c.policy_version=?1 ORDER BY c.last_considered_at IS NOT NULL,c.last_considered_at,p.user_id LIMIT 501`).bind(PERIOD_POLICY).all<{user_id:string;payload:string;version:number;consent_version:number;start_date:string}>();
 if(rows.results.length>500)throw Error('Periodic analysis capacity requires partitioning');
 for(const row of rows.results){
  const now=clock(),profile=profileSchema.parse({...JSON.parse(row.payload),version:row.version});
  const due=periodCadences.map(cadence=>({cadence,window:duePeriod(profile,cadence,now)})).filter(item=>item.window&&item.window.through>=row.start_date);
  if(!due.length)continue;
  await db.prepare('UPDATE life_period_consent SET last_considered_at=?2 WHERE user_id=?1 RETURNING user_id').bind(row.user_id,now.toISOString()).first();
  const known=await db.prepare("SELECT request_id FROM life_ai_reviews WHERE user_id=?1 AND cadence<>'daily' AND revision=1 AND entry_date>=?2 LIMIT 500").bind(row.user_id,due.map(x=>x.window!.through).sort()[0]).all<{request_id:string}>();
  const candidates=due.filter(item=>!known.results.some(r=>r.request_id===`${item.cadence}:${item.window!.through}`));
  if(!candidates.length)return stats;
  const selected=candidates[Math.floor(now.valueOf()/600000)%candidates.length];
  stats.considered++;
  const response=await generateAI(db,row.user_id,{cadence:selected.cadence,date:selected.window!.through,requestId:crypto.randomUUID(),sourceVersion:profile.version,predecessorId:null,critique:'',consent:true},settings,now,{consentVersion:row.consent_version,cadence:selected.cadence});
  const result=await response.json() as {report?:{status:string}};
  if(result.report?.status==='complete')stats.completed++;else if(response.status===502||result.report)stats.attention++;else stats.deferred++;
  return stats;
 }
 return stats;
}
