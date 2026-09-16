import type {AISettings} from './ai-service.ts';

// Server configuration names one existing opaque account, never an email or a
// client-supplied role. Expiry also applies to scheduled generation.
function prototypeOwner(settings:AISettings,now:Date){
 const owner=settings.ownerPrototype;
 return owner&&Number.isFinite(Date.parse(owner.expiresAt))&&now.valueOf()<Date.parse(owner.expiresAt)?owner:null;
}
const ownerDailyMicros=1_000_000;
const ownerMonthMicros=(now:Date)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).getUTCDate()*ownerDailyMicros;
export function limitsForAI(settings:AISettings,userId:string,now:Date){
 const prototype=prototypeOwner(settings,now)?.userId===userId;
 return {userCapMicros:prototype?ownerMonthMicros(now):settings.userCapMicros,dailyAttempts:prototype?25:5,builderAttempts:prototype?10:2,regenerations:prototype?5:2};
}

// Both admission paths use the complete ledger, including archived attempts and
// unknown reservations. Values (especially the private owner ID) are bound by
// callers; the SQL expressions passed here are internal parameter references.
export function spendingAdmission(settings:AISettings,userId:string,now:Date,p:{user:string;month:string;day:string;reserve:string;accountCap:string;globalCap:string;owner:string}){
 const owner=prototypeOwner(settings,now),allowance=owner?ownerMonthMicros(now):0;
 return {ownerUserId:owner?.userId||null,globalCapMicros:settings.globalCapMicros+allowance,sql:`
 (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_usage WHERE user_id=${p.user} AND created_at>=${p.month})+${p.reserve}<=${p.accountCap}
 AND (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_usage WHERE created_at>=${p.month})+${p.reserve}<=${p.globalCap}
 AND ((${p.owner} IS NOT NULL AND ${p.user}=${p.owner}) OR
  (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_usage WHERE created_at>=${p.month} AND (${p.owner} IS NULL OR user_id<>${p.owner}))+${p.reserve}<=${p.globalCap}-${allowance})
 ${owner?.userId===userId?`AND (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM life_ai_usage WHERE user_id=${p.user} AND created_at>=${p.day})+${p.reserve}<=${ownerDailyMicros}`:''}`};
}
