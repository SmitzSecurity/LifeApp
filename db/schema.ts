import { sql } from 'drizzle-orm';
import { integer, text, sqliteTable, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const profiles=sqliteTable('life_profiles',{userId:text('user_id').primaryKey(),payload:text('payload').notNull(),version:integer('version').notNull(),updatedAt:text('updated_at').notNull()});
export const entries=sqliteTable('life_entries',{userId:text('user_id').notNull(),entryDate:text('entry_date').notNull(),payload:text('payload').notNull(),version:integer('version').notNull(),updatedAt:text('updated_at').notNull()},t=>[primaryKey({columns:[t.userId,t.entryDate]})]);

export const resources=sqliteTable('life_resources',{
userId:text('user_id').notNull(),kind:text('kind').notNull(),resourceId:text('resource_id').notNull(),period:text('period').notNull(),payload:text('payload').notNull(),version:integer('version').notNull(),updatedAt:text('updated_at').notNull(),activeSlot:text('active_slot')
},t=>[primaryKey({columns:[t.userId,t.kind,t.resourceId]}),index('idx_life_resources_period').on(t.userId,t.kind,t.period),uniqueIndex('idx_life_one_active_workout').on(t.userId,t.kind,t.activeSlot).where(sql`${t.activeSlot} IS NOT NULL`)]);
export const aiReviews=sqliteTable('life_ai_reviews',{
 userId:text('user_id').notNull(),requestId:text('request_id').notNull(),entryDate:text('entry_date').notNull(),revision:integer('revision').notNull(),sourceVersion:integer('source_version').notNull(),predecessorId:text('predecessor_id'),critique:text('critique').notNull(),status:text('status').notNull(),inputSnapshot:text('input_snapshot').notNull(),reportText:text('report_text'),model:text('model').notNull(),priceVersion:text('price_version').notNull(),providerId:text('provider_id'),inputTokens:integer('input_tokens'),outputTokens:integer('output_tokens'),thoughtTokens:integer('thought_tokens'),reservedMicros:integer('reserved_micros').notNull(),costMicros:integer('cost_micros'),createdAt:text('created_at').notNull(),finishedAt:text('finished_at'),errorCode:text('error_code')
},t=>[primaryKey({columns:[t.userId,t.requestId]}),uniqueIndex('idx_life_ai_revision').on(t.userId,t.entryDate,t.revision),index('idx_life_ai_account_time').on(t.userId,t.createdAt),index('idx_life_ai_time').on(t.createdAt)]);

// Eligibility is a live SQL view, not a stale copy of a journal's completion state.
// These are scheduling intents only; no provider or delivery worker consumes them yet.
export const reviewJobs=sqliteTable('life_review_jobs',{
 userId:text('user_id').notNull(),entryDate:text('entry_date').notNull(),
 detectedAt:text('detected_at').notNull(),timezone:text('timezone').notNull(),
 localTime:text('local_time').notNull(),profileVersion:integer('profile_version').notNull()
},t=>[primaryKey({columns:[t.userId,t.entryDate]})]);
export const reminderOutbox=sqliteTable('life_reminder_outbox',{
 userId:text('user_id').notNull(),entryDate:text('entry_date').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.userId,t.entryDate]})]);
