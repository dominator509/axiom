import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Global denylist for short-lived MCP capability tokens.
 *
 * This table intentionally has no org_id: token IDs are random, non-secret
 * identifiers, and a revoked capability must be rejected by every API
 * instance regardless of which model/org resolver would otherwise run.
 */
export const mcpTokenRevocation = pgTable('mcp_token_revocation', {
  tokenId: text('token_id').primaryKey(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
