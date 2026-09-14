import type {AISettings} from './ai-service.ts';

// Server configuration names one existing opaque account, never an email or a
// client-supplied role. Expiry also applies to scheduled generation.
export function limitsForAI(settings:AISettings,userId:string,now:Date){
 const owner=settings.ownerPrototype;
 const prototype=!!owner&&owner.userId===userId&&Number.isFinite(Date.parse(owner.expiresAt))&&now.valueOf()<Date.parse(owner.expiresAt);
 return {userCapMicros:prototype?Math.max(settings.userCapMicros,5_000_000):settings.userCapMicros,dailyAttempts:prototype?25:5,builderAttempts:prototype?10:2,regenerations:prototype?5:2};
}
