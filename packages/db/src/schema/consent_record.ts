import { pgTable, uuid, text, timestamp, boolean, date } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { bytea } from './types.js';

/**
 * Consent & Records Vault (L0.1 / L3.1 §2). The org-scoped record of performer
 * consent documents (2257 / model_release / id_verify / platform_consent).
 * Columns aligned to the L3.1 DDL spec (subject_ref, doc_kind, blob_ref,
 * sha256, valid_from/valid_to).
 */
export const consentRecord = pgTable('consent_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  consentType: text('consent_type').notNull(),
  granted: boolean('granted').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // L3.1 §2 spec alignment (migration 0010)
  subjectRef: text('subject_ref').notNull().default(''),
  docKind: text('doc_kind')
    .notNull()
    .default('platform_consent')
    .$type<'2257' | 'model_release' | 'id_verify' | 'platform_consent'>(),
  blobRef: text('blob_ref'),
  sha256: bytea('sha256'),
  validFrom: date('valid_from').notNull().defaultNow(),
  validTo: date('valid_to'),
});

export const consentRecordRelations = relations(consentRecord, ({ one }) => ({
  org: one(org, {
    fields: [consentRecord.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [consentRecord.modelId],
    references: [modelProfile.id],
  }),
}));
