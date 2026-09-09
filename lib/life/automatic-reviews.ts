import { generateAI, type AISettings } from './ai-service.ts';
import { AUTOMATIC_POLICY, automaticAvailable } from './automatic-consent.ts';
import { settingsForAI, type AIEnvironment } from './ai-configuration.ts';
import { scheduledReviewPlanning } from './scheduler.ts';
import type { Database } from './service.ts';
import {settingsForEmail,type EmailEnvironment} from './email-configuration.ts';
import {consumeReportEmails,emailAvailable} from './email-service.ts';

// Planner uses at most 22 D1 queries; two contexts plus settlement fit within
// the free tier's 50-query invocation limit, including enabled module reads.
export const AUTOMATIC_BATCH_SIZE = 2;

export async function consumeDailyReviews(db: Database, settings: AISettings, clock = () => new Date()) {
  const stats = { considered: 0, completed: 0, deferred: 0, attention: 0 };
  if (!automaticAvailable(settings, clock())) return stats;
  // Rotate even blocked contexts/capped accounts so they cannot starve later jobs.
  // This timestamp is fairness metadata, never a lease allowing a paid retry.
  const rows = await db.prepare(`SELECT s.user_id,s.entry_date,s.source_version,c.version AS consent_version
    FROM life_daily_job_status s JOIN life_review_jobs j ON j.user_id=s.user_id AND j.entry_date=s.entry_date
    JOIN life_automatic_consent c ON c.user_id=s.user_id
    WHERE s.state='ready' AND c.enabled=1 AND c.policy_version=?1 AND s.entry_date>=c.start_date
    ORDER BY j.last_considered_at IS NOT NULL,COALESCE(j.last_considered_at,j.detected_at),s.user_id,s.entry_date LIMIT ?2`).bind(AUTOMATIC_POLICY, AUTOMATIC_BATCH_SIZE).all<{ user_id: string; entry_date: string; source_version: number; consent_version: number }>();
  for (const row of rows.results) {
    const now = clock();
    if (!automaticAvailable(settings, now)) break;
    await db.prepare('UPDATE life_review_jobs SET last_considered_at=?3 WHERE user_id=?1 AND entry_date=?2 RETURNING entry_date').bind(row.user_id, row.entry_date, now.toISOString()).first();
    stats.considered++;
    // Admission in generateAI rechecks consent, profile/entry versions, live job
    // eligibility and the shared caps in the original-review reservation INSERT.
    // Crashes after admission leave an attempt that neither path retries.
    const response = await generateAI(db, row.user_id, { date: row.entry_date, requestId: crypto.randomUUID(), sourceVersion: row.source_version, predecessorId: null, critique: '', consent: true }, settings, now, { consentVersion: row.consent_version });
    const body = await response.json() as { report?: { status: string } };
    if (body.report?.status === 'complete') stats.completed++;
    else if (response.status === 502 || body.report) stats.attention++;
    else stats.deferred++;
  }
  return stats;
}

export async function scheduledDailyReviews(env: AIEnvironment & EmailEnvironment & { DB?: Database }, scheduledTime: number) {
  const email=settingsForEmail(env),deliver=emailAvailable(email);
  // Reserve query headroom for two email claims/settlements within the 50-query tier.
  try{
    await scheduledReviewPlanning(env, scheduledTime,deliver?10:20);
    const settings = settingsForAI(env);
    if (automaticAvailable(settings, new Date())) {
      if (!env.DB) throw new Error('Automatic review database unavailable');
      // Bill/pricing checks use execution time, not a delayed Cron timestamp.
      await consumeDailyReviews(env.DB, settings);
    }
  }finally{
    // Saved reports can still be delivered while AI is unavailable or switched off.
    if(deliver){if(!env.DB)throw new Error('Email database unavailable');await consumeReportEmails(env.DB,email);}
  }
}
