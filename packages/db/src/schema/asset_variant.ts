import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { asset } from './asset.js';

export const assetVariant = pgTable('asset_variant', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => asset.id, { onDelete: 'cascade' }),
  variantType: text('variant_type').notNull().default('crop'),
  width: integer('width'),
  height: integer('height'),
  storageKey: text('storage_key').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  perfScore: doublePrecision('perf_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assetVariantRelations = relations(assetVariant, ({ one }) => ({
  org: one(org, {
    fields: [assetVariant.orgId],
    references: [org.id],
  }),
  asset: one(asset, {
    fields: [assetVariant.assetId],
    references: [asset.id],
  }),
}));
