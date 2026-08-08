import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

export const seoAeoRanking = pgTable('seo_aeo_ranking', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id')
    .notNull()
    .references(() => modelProfile.id, { onDelete: 'cascade' }),
  keyword: text('keyword').notNull(),
  engine: text('engine').notNull(),
  position: integer('position'),
  url: text('url'),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
});

export const seoAeoRankingRelations = relations(seoAeoRanking, ({ one }) => ({
  org: one(org, {
    fields: [seoAeoRanking.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [seoAeoRanking.modelId],
    references: [modelProfile.id],
  }),
}));
