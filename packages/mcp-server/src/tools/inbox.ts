import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { Tier, type AgentPermission, tierAtLeast } from '../auth.js';
import { withModelOrg, schema } from '../org-context.js';

/**
 * Input schema for inbox operations.
 * - action: 'read' to list recent messages, 'reply' to send a DM reply
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
 * Inbox tool — read incoming messages and send direct message replies.
 * Available at Operator tier and above. Real DB behaviour (H-2):
 *  - read: fan_touchpoint inbound messages for the model (fan timeline, F-07)
 *  - reply: appends an outbound touchpoint (fan_touchpoint) recording the DM;
 *    live platform delivery requires a bound connector credential and fails
 *    honestly if the referenced fan/message is unknown.
 */
export class InboxTool {
  name = 'inbox_manage';
  description = 'Read inbox messages and send direct message replies for a model profile.';
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
          .innerJoin(
            schema.fanCrmContact,
            eq(schema.fanTouchpoint.fanId, schema.fanCrmContact.id),
          )
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
      // The messageId refers to a fan_touchpoint (the inbound message).
      await withModelOrg(args.modelId, async (tx, orgId) => {
        const msg = await tx
          .select({ fanId: schema.fanTouchpoint.fanId, platform: schema.fanTouchpoint.platform })
          .from(schema.fanTouchpoint)
          .innerJoin(
            schema.fanCrmContact,
            eq(schema.fanTouchpoint.fanId, schema.fanCrmContact.id),
          )
          .where(
            and(
              eq(schema.fanTouchpoint.id, args.messageId as string),
              eq(schema.fanTouchpoint.orgId, orgId),
              eq(schema.fanCrmContact.orgId, orgId),
              eq(schema.fanCrmContact.modelId, args.modelId),
            ),
          )
          .limit(1);
        if (msg.length === 0) {
          throw new Error(`Message ${args.messageId} not found`);
        }
        // Record the outbound reply in the fan timeline (F-07). Live platform
        // delivery needs a bound connector + credential; this persists the
        // intent so the worker/relay path can deliver it (fail-closed design).
        await tx.insert(schema.fanTouchpoint).values({
          orgId,
          fanId: msg[0].fanId,
          platform: msg[0].platform,
          kind: 'dm_reply',
          direction: 'outbound',
          content: args.content,
          ts: new Date(),
        });
      });
      return {
        success: true,
        tool: this.name,
        action: 'reply',
        modelId: args.modelId,
        messageId: args.messageId,
        preview: args.content.slice(0, 100),
        message: 'Reply recorded in fan timeline for delivery via relay/worker.',
      };
    }

    throw new Error(`Unknown inbox action: ${args.action}`);
  }
}
