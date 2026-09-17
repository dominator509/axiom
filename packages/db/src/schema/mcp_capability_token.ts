import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { org } from './org.js';
import { modelProfile } from './model_profile.js';
import { agentPermission } from './agent_permission.js';

/**
 * Durable, non-secret registry for issued MCP capability identifiers.
 * The bearer token itself is never stored. The API uses this row plus the
 * model-scoped agent_permission row to reject deleted or downgraded grants
 * across process restarts; the raw token is returned only at issuance time.
 */
export const mcpCapabilityToken = pgTable('mcp_capability_token', {
  tokenId: text('token_id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => agentPermission.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => modelProfile.id, { onDelete: 'cascade' }),
  agentRef: text('agent_ref').notNull(),
  tier: text('tier').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
