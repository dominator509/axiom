import { Tier } from './auth.js';
import { AnalyticsTool } from './tools/analytics.js';
import { InboxTool } from './tools/inbox.js';
import { GenerationTool } from './tools/generation.js';
import { PublishingTool } from './tools/publishing.js';
import { NetworkTool } from './tools/network.js';
import { tierAtLeast } from './auth.js';

// ─── Tool registry ──────────────────────────────────────────────────────────

/** All known tools indexed by name. */
const allTools: Record<
  string,
  AnalyticsTool | InboxTool | GenerationTool | PublishingTool | NetworkTool
> = {
  analytics_query: new AnalyticsTool(),
  inbox_manage: new InboxTool(),
  generation_photoshoot: new GenerationTool(),
  publishing_post: new PublishingTool(),
  network_configure: new NetworkTool(),
};

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
export function getManifest(tier: Tier, _modelId: string): ToolDescriptor[] {
  const manifest: ToolDescriptor[] = [];

  for (const tool of Object.values(allTools)) {
    if (!tierAtLeast(tier, tool.tier)) continue;

    // For publishing: approval is dynamic based on tier
    let requiresApproval = tool.requiresApproval;
    if (tool.name === 'publishing_post') {
      // PublishingTool: Manager requires approval, Autonomous does not
      requiresApproval = tier !== Tier.Autonomous;
    }

    manifest.push({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema._def ?? {},
      requiresApproval,
      tier: tool.tier,
    });
  }

  return manifest;
}
