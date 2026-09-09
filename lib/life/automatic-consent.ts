import { z } from 'zod/v3';
import { profileSchema, todayIn } from './domain.ts';
import type { Database } from './service.ts';
import type { AISettings } from './ai-service.ts';
import { PRICE_EXPIRES } from './ai-provider.ts';

export const AUTOMATIC_POLICY = 'daily-v1';
export type AutomaticConsent = { enabled: boolean; version: number; policyVersion: string; startDate: string | null; acceptedAt: string | null };
type ConsentRow = { enabled: number; version: number; policy_version: string; start_date: string; accepted_at: string };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
export const automaticAvailable = (settings: AISettings, now: Date) => !!settings.automaticEnabled && settings.enabled && !!settings.provider && now.valueOf() < Date.parse(PRICE_EXPIRES);

export async function readAutomaticConsent(db: Database, userId: string): Promise<AutomaticConsent> {
  const row = await db.prepare('SELECT enabled,version,policy_version,start_date,accepted_at FROM life_automatic_consent WHERE user_id=?1').bind(userId).first<ConsentRow>();
  return { enabled: !!row?.enabled && row.policy_version === AUTOMATIC_POLICY, version: row?.version || 0, policyVersion: AUTOMATIC_POLICY, startDate: row?.start_date || null, acceptedAt: row?.accepted_at || null };
}

export async function automaticConsentStatus(db: Database, userId: string, settings: AISettings, now: Date) {
  const pr = await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{ payload: string; version: number }>();
  const profile = pr ? profileSchema.parse({ ...JSON.parse(pr.payload), version: pr.version }) : null;
  return json({ consent: await readAutomaticConsent(db, userId), available: automaticAvailable(settings, now), schedule: profile ? { enabled: profile.reviewPreferences.daily.enabled, time: profile.reviewPreferences.daily.time, timezone: profile.timezone } : null });
}

const inputSchema = z.object({ enabled: z.boolean(), version: z.number().int().nonnegative(), policyVersion: z.literal(AUTOMATIC_POLICY) }).strict();
export async function saveAutomaticConsent(db: Database, userId: string, body: unknown, settings: AISettings, now: Date) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Review the automatic-analysis choice and try again.' }, 400);
  const input = parsed.data;
  if (input.enabled && !automaticAvailable(settings, now)) return json({ error: 'Automatic daily reviews are awaiting activation. Manual reviews remain available.' }, 503);
  const pr = await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{ payload: string; version: number }>();
  if (!pr) return json({ error: 'Save your setup first.' }, 409);
  const profile = profileSchema.parse({ ...JSON.parse(pr.payload), version: pr.version });
  if (input.enabled && !profile.reviewPreferences.daily.enabled) return json({ error: 'Enable daily reviews and save your setup first.' }, 409);
  // Optimistic consent revisions prevent an old tab or replayed enable from
  // restoring authorization after a later opt-out. Disabling works while AI is off.
  const row = await db.prepare(`INSERT INTO life_automatic_consent(user_id,enabled,version,policy_version,start_date,accepted_at,updated_at)
    SELECT ?1,?2,1,?3,?4,?5,?5 WHERE EXISTS(SELECT 1 FROM life_profiles WHERE user_id=?1 AND version=?7)
    AND (?6=0 OR EXISTS(SELECT 1 FROM life_automatic_consent WHERE user_id=?1))
    ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,version=life_automatic_consent.version+1,
    policy_version=excluded.policy_version,start_date=CASE WHEN excluded.enabled=1 THEN excluded.start_date ELSE life_automatic_consent.start_date END,
    accepted_at=CASE WHEN excluded.enabled=1 THEN excluded.accepted_at ELSE life_automatic_consent.accepted_at END,updated_at=excluded.updated_at
    WHERE life_automatic_consent.version=?6 RETURNING version`).bind(userId, input.enabled ? 1 : 0, AUTOMATIC_POLICY, todayIn(profile.timezone, now), now.toISOString(), input.version, pr.version).first();
  if (!row) return json({ error: 'Your choice or setup changed in another session. Refresh before choosing again.' }, 409);
  return automaticConsentStatus(db, userId, settings, now);
}
