import { pgTable, uuid, text, timestamp, boolean, jsonb, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const linkbioProvider = pgTable(
  'linkbio_provider',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => modelProfile.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    isPrimary: boolean('is_primary').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.modelId, t.kind)],
);

export const linkbioProviderRelations = relations(linkbioProvider, ({ one }) => ({
  org: one(org, {
    fields: [linkbioProvider.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [linkbioProvider.modelId],
    references: [modelProfile.id],
  }),
}));
