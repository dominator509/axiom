import { pgTable, uuid, text, timestamp, integer, jsonb, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const shortLink = pgTable(
  'short_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => modelProfile.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    targetUrl: text('target_url').notNull(),
    utm: jsonb('utm').$type<Record<string, string>>().default({}),
    clicks: integer('clicks').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.slug)],
);

export const shortLinkRelations = relations(shortLink, ({ one }) => ({
  org: one(org, {
    fields: [shortLink.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [shortLink.modelId],
    references: [modelProfile.id],
  }),
}));
