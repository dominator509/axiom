import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { org } from './org.js';
import { authUser } from './auth_user.js';

/** Persisted UI language choice; authored content language is separate. */
export const uiLocalePreference = pgTable('ui_locale_preference', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: text('scope').notNull(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => authUser.id, { onDelete: 'cascade' }),
  locale: text('locale').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('ui_locale_preference_scope_lookup').on(table.orgId, table.scope, table.userId),
]);

export const uiLocalePreferenceRelations = relations(uiLocalePreference, ({ one }) => ({
  org: one(org, { fields: [uiLocalePreference.orgId], references: [org.id] }),
  user: one(authUser, { fields: [uiLocalePreference.userId], references: [authUser.id] }),
}));
