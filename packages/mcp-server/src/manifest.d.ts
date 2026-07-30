import { Tier } from './auth.js';
import { AnalyticsTool } from './tools/analytics.js';
import { InboxTool } from './tools/inbox.js';
import { GenerationTool } from './tools/generation.js';
import { PublishingTool } from './tools/publishing.js';
import { NetworkTool } from './tools/network.js';
/** All known tools indexed by name. */
declare const allTools: Record<string, AnalyticsTool | InboxTool | GenerationTool | PublishingTool | NetworkTool>;
export { allTools };
/**
 * Tool descriptor — the metadata returned in a manifest.
 */
export interface ToolDescriptor {
    name: string;
    description: string;
    inputSchema: unknown;
    requiresApproval: boolean;
    tier: string;
}
/**
 * Build a manifest of available tools for a given (tier, modelId) pair.
 * Returns only those tools the agent is permitted to call.
 */
export declare function getManifest(tier: Tier, _modelId: string): ToolDescriptor[];
//# sourceMappingURL=manifest.d.ts.map