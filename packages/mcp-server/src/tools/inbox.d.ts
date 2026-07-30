import { z } from 'zod';
import { Tier, type AgentPermission } from '../auth.js';
/**
 * Input schema for inbox operations.
 * - action: 'read' to list recent messages, 'reply' to send a DM reply
 * - messageId: required for 'reply', optional for 'read'
 * - content: required for 'reply'
 */
export declare const InboxInputSchema: z.ZodObject<{
    modelId: z.ZodString;
    action: z.ZodEnum<["read", "reply"]>;
    messageId: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    modelId: string;
    action: "read" | "reply";
    messageId?: string | undefined;
    content?: string | undefined;
}, {
    modelId: string;
    action: "read" | "reply";
    messageId?: string | undefined;
    content?: string | undefined;
}>;
export type InboxInput = z.infer<typeof InboxInputSchema>;
/**
 * Inbox tool — read incoming messages and reply with direct messages.
 * Available at Operator tier and above.
 */
export declare class InboxTool {
    name: string;
    description: string;
    inputSchema: z.ZodObject<{
        modelId: z.ZodString;
        action: z.ZodEnum<["read", "reply"]>;
        messageId: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        modelId: string;
        action: "read" | "reply";
        messageId?: string | undefined;
        content?: string | undefined;
    }, {
        modelId: string;
        action: "read" | "reply";
        messageId?: string | undefined;
        content?: string | undefined;
    }>;
    tier: Tier;
    requiresApproval: boolean;
    handle(args: InboxInput, permission: AgentPermission): Promise<unknown>;
}
//# sourceMappingURL=inbox.d.ts.map