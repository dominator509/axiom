import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { Tier, type AgentPermission, tierAtLeast } from '../auth.js';
import { withModelOrg, schema } from '../org-context.js';

/**
 * Input schema for inbox operations.
 * - action: 'read' to list recent messages, 'reply' is rejected because
 *   provider delivery is not currently bound
 * - messageId: required for 'reply', optional for 'read'
 * - content: required for 'reply'
 */
export const InboxInputSchema = z.object({
  modelId: z.string().uuid(),
  action: z.enum(['read', 'reply']),
  messageId: z.string().uuid().optional(),
  content: z.string().optional(),
});

export type InboxInput = z.infer<typeof InboxInputSchema>;

/**
 * Inbox tool — read incoming messages.
 * Available at Operator tier and above. Real DB behaviour (H-2):
 *  - read: fan_touchpoint inbound messages for the model (fan timeline, F-07)
 *  - reply: rejected until a provider delivery path is bound. Recording an
 *    outbound timeline row without a delivery worker would falsely imply that
 *    the provider accepted the message.
 */
export class InboxTool {
  name = 'inbox_manage';
  description =
    'Read inbound inbox messages for a model profile. Direct-message replies are unavailable until provider delivery is bound.';
  inputSchema = InboxInputSchema;
  tier: Tier = Tier.Operator;
  requiresApproval = false;

  async handle(args: InboxInput, permission: AgentPermission): Promise<unknown> {
    if (!tierAtLeast(permission.tier, this.tier)) {
      throw new Error(`Insufficient permissions: requires ${this.tier}, got ${permission.tier}`);
    }
    if (args.modelId !== permission.modelId) {
      throw new Error(
        `Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`,
      );
    }

    if (args.action === 'read') {
      const messages = await withModelOrg(args.modelId, async (tx, orgId) => {
        const rows = await tx
          .select({
            id: schema.fanTouchpoint.id,
            fanId: schema.fanTouchpoint.fanId,
            platform: schema.fanTouchpoint.platform,
            kind: schema.fanTouchpoint.kind,
            direction: schema.fanTouchpoint.direction,
            content: schema.fanTouchpoint.content,
            ts: schema.fanTouchpoint.ts,
          })
          .from(schema.fanTouchpoint)
          .innerJoin(schema.fanCrmContact, eq(schema.fanTouchpoint.fanId, schema.fanCrmContact.id))
          .where(
            and(
              eq(schema.fanTouchpoint.orgId, orgId),
              eq(schema.fanCrmContact.orgId, orgId),
              eq(schema.fanCrmContact.modelId, args.modelId),
              eq(schema.fanTouchpoint.direction, 'inbound'),
            ),
          )
          .orderBy(desc(schema.fanTouchpoint.ts))
          .limit(20);
        return rows.map(
          (r: {
            id: string;
            fanId: string;
            platform: string;
            kind: string;
            content: string | null;
            ts: Date;
          }) => ({
            id: r.id,
            fanId: r.fanId,
            platform: r.platform,
            kind: r.kind,
            content: r.content,
            receivedAt: r.ts,
          }),
        );
      });
      return { success: true, tool: this.name, action: 'read', modelId: args.modelId, messages };
    }

    if (args.action === 'reply') {
      if (!args.messageId || !args.content) {
        throw new Error('messageId and content are required for reply action');
      }
      throw new Error(
        'Direct-message replies are unavailable: no provider delivery worker is configured',
      );
    }

    throw new Error(`Unknown inbox action: ${args.action}`);
  }
}
