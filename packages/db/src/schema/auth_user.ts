import { pgTable, text, timestamp, boolean, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';

export const authUser = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  orgId: uuid('org_id').references(() => org.id, { onDelete: 'set null' }),
  role: text('role').notNull().default('operator'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authUserRelations = relations(authUser, ({ one }) => ({
  org: one(org, {
    fields: [authUser.orgId],
    references: [org.id],
  }),
}));
