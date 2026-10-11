import { customType, pgTable, uuid, text, boolean, timestamp, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { org } from './org.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const organizationDataKey = pgTable('organization_data_key', {
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  dekId: uuid('dek_id').notNull(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  wrapNonce: bytea('wrap_nonce').notNull(),
  kekId: text('kek_id').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.orgId, table.dekId] }),
  uniqueIndex('organization_data_key_one_active_per_org')
    .on(table.orgId)
    .where(sql`${table.isActive}`),
]);
