import { z } from 'zod';
import { Tier, tierAtLeast } from '../auth.js';
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
/**
 * Inbox tool — read incoming messages and reply with direct messages.
 * Available at Operator tier and above.
 */
export class InboxTool {
    name = 'inbox_manage';
    description = 'Read inbox messages and send direct message replies for a model profile.';
    inputSchema = InboxInputSchema;
    tier = Tier.Operator;
    requiresApproval = false;
    async handle(args, permission) {
        if (!tierAtLeast(permission.tier, this.tier)) {
            throw new Error(`Insufficient permissions: requires ${this.tier}, got ${permission.tier}`);
        }
        if (args.modelId !== permission.modelId) {
            throw new Error(`Model mismatch: token scoped to ${permission.modelId}, requested ${args.modelId}`);
        }
        if (args.action === 'read') {
            // Stub: query @axiom/db for recent messages
            // const { db } = await import('@axiom/db');
            // const messages = await db.select().from(someMessagesTable)
            //   .where(eq(someMessagesTable.modelId, args.modelId))
            //   .limit(20).execute();
            return {
                success: true,
                tool: this.name,
                action: 'read',
                modelId: args.modelId,
                messages: [],
                note: 'Stub implementation — connect @axiom/db for live data',
            };
        }
        if (args.action === 'reply') {
            if (!args.messageId || !args.content) {
                throw new Error('messageId and content are required for reply action');
            }
            // Stub: send reply via platform connector
            // const connector = await getConnectorForModel(args.modelId);
            // await connector.sendMessage(args.messageId, args.content);
            return {
                success: true,
                tool: this.name,
                action: 'reply',
                modelId: args.modelId,
                messageId: args.messageId,
                preview: args.content.slice(0, 100),
                note: 'Stub implementation — connect @axiom/connectors for live DM sending',
            };
        }
        throw new Error(`Unknown inbox action: ${args.action}`);
    }
}
//# sourceMappingURL=inbox.js.map