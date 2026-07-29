import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const viralExemplar = pgTable('viral_exemplar', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => import('./org.js').org.id),
  platform: text('platform').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  viralLabel: text('viral_label').notNull(),
  metrics: jsonb('metrics').$type<{ views: number; likes: number; shares: number; comments: number }>().default({ views: 0, likes: 0, shares: 0, comments: 0 }),
  aiNotes: text('ai_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const viralExemplarRelations = relations(viralExemplar, ({ one }) => ({
  org: one(import('./org.js').org, {
    fields: [viralExemplar.orgId],
    references: [import('./org.js').org.id],
  }),
}));
