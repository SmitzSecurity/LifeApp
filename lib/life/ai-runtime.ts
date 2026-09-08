import { env } from 'cloudflare:workers';
import { geminiProvider } from './ai-provider';
import type { AISettings } from './ai-service';
export function aiSettings():AISettings{
 // Initial private beta caps: $1/account/month, $5/site/month; no customer charge.
 // A paid-project confirmation keeps private journals off Gemini's unpaid data-use tier.
 const enabled=env.LIFEAPP_AI_ENABLED==='true'&&env.LIFEAPP_AI_PAID_PROJECT==='true';
 return {enabled,provider:enabled&&env.GEMINI_API_KEY?geminiProvider(env.GEMINI_API_KEY):null,userCapMicros:1000000,globalCapMicros:5000000};
}
