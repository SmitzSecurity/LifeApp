import {z} from 'zod/v3';
import {profileSchema,todayIn} from './domain.ts';
import {automaticAvailable} from './automatic-consent.ts';
import type {AISettings} from './ai-service.ts';
import type {Database} from './service.ts';
export const PERIOD_POLICY='periods-v1';
export type PeriodConsent={enabled:boolean;version:number;policyVersion:string;startDate:string|null;acceptedAt:string|null};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
export async function readPeriodConsent(db:Database,id:string):Promise<PeriodConsent>{
 const row=await db.prepare('SELECT enabled,version,policy_version,start_date,accepted_at FROM life_period_consent WHERE user_id=?1').bind(id).first<{enabled:number;version:number;policy_version:string;start_date:string;accepted_at:string}>();
 return {enabled:!!row?.enabled&&row.policy_version===PERIOD_POLICY,version:row?.version||0,policyVersion:PERIOD_POLICY,startDate:row?.start_date||null,acceptedAt:row?.accepted_at||null};
}
export async function periodConsentStatus(db:Database,id:string,settings:AISettings,now:Date){return json({available:automaticAvailable(settings,now),consent:await readPeriodConsent(db,id)});}
const schema=z.object({enabled:z.boolean(),version:z.number().int().nonnegative(),policyVersion:z.literal(PERIOD_POLICY)}).strict();
export async function savePeriodConsent(db:Database,id:string,body:unknown,settings:AISettings,now:Date){
 const parsed=schema.safeParse(body);if(!parsed.success)return json({error:'Review the automatic analysis choice and try again.'},400);
 const c=parsed.data;if(c.enabled&&!automaticAvailable(settings,now))return json({error:'Automatic analysis is unavailable right now.'},503);
 const row=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(id).first<{payload:string;version:number}>();
 if(!row)return json({error:'Save your preferences first.'},400);
 const profile=profileSchema.parse({...JSON.parse(row.payload),version:row.version}),stamp=now.toISOString();
 const result=await db.prepare(`INSERT INTO life_period_consent(user_id,enabled,version,policy_version,start_date,accepted_at,updated_at)
 SELECT ?1,?2,1,?3,?4,?5,?5 WHERE EXISTS(SELECT 1 FROM life_profiles WHERE user_id=?1 AND version=?6)
 AND (?7=0 OR EXISTS(SELECT 1 FROM life_period_consent WHERE user_id=?1))
 ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,version=life_period_consent.version+1,policy_version=excluded.policy_version,
 start_date=CASE WHEN excluded.enabled=1 THEN excluded.start_date ELSE life_period_consent.start_date END,
 accepted_at=CASE WHEN excluded.enabled=1 THEN excluded.accepted_at ELSE life_period_consent.accepted_at END,updated_at=excluded.updated_at
 WHERE life_period_consent.version=?7 RETURNING version`).bind(id,c.enabled?1:0,PERIOD_POLICY,todayIn(profile.timezone,now),stamp,profile.version,c.version).first();
 if(!result)return json({error:'Your choice changed in another session. Refresh and try again.'},409);
 return periodConsentStatus(db,id,settings,now);
}
