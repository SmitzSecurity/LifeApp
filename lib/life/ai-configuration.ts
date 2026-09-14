import { geminiProvider } from './ai-provider.ts';
import type { AISettings } from './ai-service.ts';
export type AIEnvironment = { GEMINI_API_KEY?: string; LIFEAPP_AI_ENABLED?: string; LIFEAPP_AI_PAID_PROJECT?: string; LIFEAPP_AUTH_MODE?: string; LIFEAPP_REVIEW_PLANNER_ENABLED?: string; LIFEAPP_AUTOMATIC_REVIEWS_ENABLED?: string; LIFEAPP_AI_OWNER_USER_ID?:string; LIFEAPP_AI_OWNER_LIMITS_UNTIL?:string };
export function settingsForAI(env: AIEnvironment): AISettings {
  const enabled = env.LIFEAPP_AI_ENABLED === 'true' && env.LIFEAPP_AI_PAID_PROJECT === 'true';
  const ownerId=env.LIFEAPP_AI_OWNER_USER_ID,until=env.LIFEAPP_AI_OWNER_LIMITS_UNTIL;
  const ownerPrototype=env.LIFEAPP_AUTH_MODE==='google'&&ownerId?.startsWith('google:')&&ownerId.length<=200&&until&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(until)&&Number.isFinite(Date.parse(until))?{userId:ownerId,expiresAt:until}:undefined;
  return { enabled, provider: enabled && env.GEMINI_API_KEY ? geminiProvider(env.GEMINI_API_KEY) : null, userCapMicros: 1000000, globalCapMicros: 5000000,
    ownerPrototype,automaticEnabled: env.LIFEAPP_AUTH_MODE === 'google' && env.LIFEAPP_REVIEW_PLANNER_ENABLED === 'true' && env.LIFEAPP_AUTOMATIC_REVIEWS_ENABLED === 'true' };
}
