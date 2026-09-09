import { sql } from 'drizzle-orm';
import { integer, text, sqliteTable, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
export const profiles=sqliteTable('life_profiles',{userId:text('user_id').primaryKey(),payload:text('payload').notNull(),version:integer('version').notNull(),updatedAt:text('updated_at').notNull()});
export const entries=sqliteTable('life_entries',{userId:text('user_id').notNull(),entryDate:text('entry_date').notNull(),payload:text('payload').notNull(),version:integer('version').notNull(),updatedAt:text('updated_at').notNull()},t=>[primaryKey({columns:[t.userId,t.entryDate]})]);

export const resources=sqliteTable('life_resources',{
userId:text('user_id').notNull(),kind:text('kind').notNull(),resourceId:text('resource_id').notNull(),period:text('period').notNull(),payload:text('payload').notNull(),version:integer('version').notNull(),updatedAt:text('updated_at').notNull(),activeSlot:text('active_slot')
},t=>[primaryKey({columns:[t.userId,t.kind,t.resourceId]}),index('idx_life_resources_period').on(t.userId,t.kind,t.period),uniqueIndex('idx_life_one_active_workout').on(t.userId,t.kind,t.activeSlot).where(sql`${t.activeSlot} IS NOT NULL`)]);
export const aiReviews=sqliteTable('life_ai_reviews',{
 userId:text('user_id').notNull(),requestId:text('request_id').notNull(),entryDate:text('entry_date').notNull(),cadence:text('cadence').notNull().default('daily'),windowStart:text('window_start'),revision:integer('revision').notNull(),sourceVersion:integer('source_version').notNull(),predecessorId:text('predecessor_id'),critique:text('critique').notNull(),status:text('status').notNull(),inputSnapshot:text('input_snapshot').notNull(),reportText:text('report_text'),model:text('model').notNull(),priceVersion:text('price_version').notNull(),providerId:text('provider_id'),inputTokens:integer('input_tokens'),outputTokens:integer('output_tokens'),thoughtTokens:integer('thought_tokens'),reservedMicros:integer('reserved_micros').notNull(),costMicros:integer('cost_micros'),createdAt:text('created_at').notNull(),finishedAt:text('finished_at'),errorCode:text('error_code')
},t=>[primaryKey({columns:[t.userId,t.requestId]}),uniqueIndex('idx_life_ai_cadence_revision').on(t.userId,t.cadence,t.entryDate,t.revision),index('idx_life_ai_account_time').on(t.userId,t.createdAt),index('idx_life_ai_time').on(t.createdAt)]);

// Eligibility is a live SQL view, not a stale copy of a journal's completion state.
// Automatic execution requires separate consent; reminder delivery remains inactive.
export const reviewJobs=sqliteTable('life_review_jobs',{
 userId:text('user_id').notNull(),entryDate:text('entry_date').notNull(),
 detectedAt:text('detected_at').notNull(),timezone:text('timezone').notNull(),
 localTime:text('local_time').notNull(),profileVersion:integer('profile_version').notNull(),lastConsideredAt:text('last_considered_at')
},t=>[primaryKey({columns:[t.userId,t.entryDate]}),index('idx_life_review_job_date').on(t.entryDate)]);
export const reminderOutbox=sqliteTable('life_reminder_outbox',{
 userId:text('user_id').notNull(),entryDate:text('entry_date').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.userId,t.entryDate]})]);

export const automaticConsent=sqliteTable('life_automatic_consent',{
 userId:text('user_id').primaryKey(),enabled:integer('enabled').notNull(),version:integer('version').notNull(),
 policyVersion:text('policy_version').notNull(),startDate:text('start_date').notNull(),acceptedAt:text('accepted_at').notNull(),updatedAt:text('updated_at').notNull()
});

// Opaque retired account IDs stop stale requests from recreating deleted data.
export const accountDeletions=sqliteTable('life_account_deletions',{
 userId:text('user_id').primaryKey(),deletedAt:text('deleted_at').notNull()
});
// No journal, report, email, OAuth identity/token or provider response is retained.
export const deletedAIUsage=sqliteTable('life_deleted_ai_usage',{
 userId:text('user_id').notNull(),requestId:text('request_id').notNull(),status:text('status').notNull(),
 model:text('model').notNull(),priceVersion:text('price_version').notNull(),
 inputTokens:integer('input_tokens'),outputTokens:integer('output_tokens'),thoughtTokens:integer('thought_tokens'),
 reservedMicros:integer('reserved_micros').notNull(),costMicros:integer('cost_micros'),
 createdAt:text('created_at').notNull(),finishedAt:text('finished_at'),errorCode:text('error_code')
},t=>[primaryKey({columns:[t.userId,t.requestId]}),index('idx_life_deleted_usage_time').on(t.createdAt)]);

// Separate explicit consent; the legacy review preference cannot enable delivery.
export const emailConsent=sqliteTable('life_email_consent',{
 userId:text('user_id').primaryKey().notNull(),enabled:integer('enabled').notNull(),version:integer('version').notNull(),
 policyVersion:text('policy_version').notNull(),recipient:text('recipient').notNull(),enabledAt:text('enabled_at').notNull(),
 updatedAt:text('updated_at').notNull(),unsubscribeToken:text('unsubscribe_token').notNull().unique()
},t=>[check('email_consent_enabled',sql`${t.enabled} IN (0,1)`)]);
export const emailOutbox=sqliteTable('life_email_outbox',{
 userId:text('user_id').notNull(),requestId:text('request_id').notNull(),consentVersion:integer('consent_version').notNull(),
 state:text('state').notNull(),attempts:integer('attempts').notNull().default(0),createdAt:text('created_at').notNull(),
 nextAttemptAt:text('next_attempt_at').notNull(),lastAttemptAt:text('last_attempt_at'),finishedAt:text('finished_at'),
 messageId:text('message_id'),errorCode:text('error_code')
},t=>[primaryKey({columns:[t.userId,t.requestId]}),index('idx_life_email_due').on(t.state,t.nextAttemptAt),
 check('email_outbox_state',sql`${t.state} IN ('pending','sending','sent','retry','failed','uncertain','cancelled')`)]);

export const periodConsent=sqliteTable('life_period_consent',{userId:text('user_id').primaryKey(),enabled:integer('enabled').notNull(),version:integer('version').notNull(),policyVersion:text('policy_version').notNull(),startDate:text('start_date').notNull(),acceptedAt:text('accepted_at').notNull(),updatedAt:text('updated_at').notNull(),lastConsideredAt:text('last_considered_at')});
