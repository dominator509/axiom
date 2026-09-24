import { pgTable, uuid, text, boolean, integer, timestamp, unique, index, foreignKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';

/** Placement presets the media plane implements. */
export const WATERMARK_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const WATERMARK_POSITION_DEFAULT: WatermarkPosition = 'bottom-right';
export const WATERMARK_OPACITY_MIN = 0;
export const WATERMARK_OPACITY_MAX = 100;
export const WATERMARK_SCALE_MIN = 5;
export const WATERMARK_SCALE_MAX = 100;

/** Canonical tenant/model asset-key shape; scope equality is checked at the boundary. */
export const WATERMARK_KEY_PATTERN = /^generated\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/i;

/**
 * Model-scoped dynamic watermark policy.
 *
 * An absent row and a disabled row both preserve the existing media behaviour:
 * no watermark is composited. Provider credentials, CDN tokens, signed URLs,
 * and transformed media bytes never belong in this table — only the bounded
 * presentation settings and the object key of the model's own asset.
 */
export const watermarkPolicy = pgTable('watermark_policy', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  watermarkKey: text('watermark_key'),
  position: text('position').$type<WatermarkPosition>().notNull().default(WATERMARK_POSITION_DEFAULT),
  opacity: integer('opacity').notNull().default(60),
  scale: integer('scale').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('watermark_policy_identity').on(table.orgId, table.modelId),
  index('idx_watermark_policy_org_model').on(table.orgId, table.modelId),
  foreignKey({
    name: 'watermark_policy_model_fk',
    columns: [table.orgId, table.modelId],
    foreignColumns: [modelProfile.orgId, modelProfile.id],
  }).onDelete('cascade'),
]);

export const watermarkPolicyRelations = relations(watermarkPolicy, ({ one }) => ({
  org: one(org, {
    fields: [watermarkPolicy.orgId],
    references: [org.id],
  }),
  model: one(modelProfile, {
    fields: [watermarkPolicy.orgId, watermarkPolicy.modelId],
    references: [modelProfile.orgId, modelProfile.id],
  }),
}));
