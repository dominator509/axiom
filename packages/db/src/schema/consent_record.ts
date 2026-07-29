import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const consentRecord = pgTable('consent_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelId: uuid('model_id').notNull().references(() => import('./model_profile.js').modelProfile.id),
  platform: text('platform').notNull(),
  consentType: text('consent_type').notNull(),
  granted: boolean('granted').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const consentRecordRelations = relations(consentRecord, ({ one }) => ({
  model: one(import('./model_profile.js').modelProfile, {
    fields: [consentRecord.modelId],
    references: [import('./model_profile.js').modelProfile.id],
  }),
}));
