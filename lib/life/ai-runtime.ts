import { env } from 'cloudflare:workers';
import { settingsForAI } from './ai-configuration';
import type { AISettings } from './ai-service';
export function aiSettings():AISettings{
 // Initial private beta caps: $1/account/month, $5/site/month; no customer charge.
 // A paid-project confirmation keeps private journals off Gemini's unpaid data-use tier.
 return settingsForAI(env);
}
