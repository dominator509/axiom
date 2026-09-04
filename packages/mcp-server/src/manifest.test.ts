// ─── MCP manifest: getManifest / allTools — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import { getManifest, allTools, type ToolDescriptor } from './manifest.js';
import { Tier } from './auth.js';

const MODEL = '11111111-1111-4111-8111-111111111111';

const ALL_TOOL_NAMES = [
  'analytics_query',
  'generation_photoshoot',
  'inbox_manage',
  'network_configure',
  'publishing_post',
];

function names(manifest: ToolDescriptor[]): string[] {
  return manifest.map((t) => t.name).sort();
}

describe('allTools registry', () => {
  it('registers exactly the five CRM tools', () => {
    expect(Object.keys(allTools).sort()).toEqual(ALL_TOOL_NAMES);
  });

  it('exposes stable metadata on each tool', () => {
    for (const [name, tool] of Object.entries(allTools)) {
      expect(tool.name).toBe(name);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.tier).toBe('string');
      expect(typeof tool.requiresApproval).toBe('boolean');
    }
  });
});

describe('getManifest — tier gating', () => {
  it('Viewer sees only analytics_query', () => {
    expect(names(getManifest(Tier.Viewer, MODEL))).toEqual(['analytics_query']);
  });

  it('Operator sees analytics, inbox and generation', () => {
    expect(names(getManifest(Tier.Operator, MODEL))).toEqual([
      'analytics_query',
      'generation_photoshoot',
      'inbox_manage',
    ]);
  });

  it('Manager additionally sees publishing_post but not network_configure', () => {
    expect(names(getManifest(Tier.Manager, MODEL))).toEqual([
      'analytics_query',
      'generation_photoshoot',
      'inbox_manage',
      'publishing_post',
    ]);
  });

  it('Autonomous sees all five tools', () => {
    expect(names(getManifest(Tier.Autonomous, MODEL))).toEqual(ALL_TOOL_NAMES);
  });
});

describe('getManifest — descriptors', () => {
  it('builds well-formed ToolDescriptor objects', () => {
    for (const tool of getManifest(Tier.Autonomous, MODEL)) {
      expect(tool).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        inputSchema: expect.any(Object),
        requiresApproval: expect.any(Boolean),
        tier: expect.any(String),
      });
    }
  });

  it('exposes the raw zod _def as inputSchema', () => {
    const analytics = getManifest(Tier.Viewer, MODEL).find((t) => t.name === 'analytics_query')!;
    expect(analytics.inputSchema).toBe(allTools.analytics_query.inputSchema._def);
  });

  it('flags generation as requiring approval at Operator tier', () => {
    const gen = getManifest(Tier.Operator, MODEL).find((t) => t.name === 'generation_photoshoot')!;
    expect(gen.requiresApproval).toBe(true);
    expect(gen.tier).toBe(Tier.Operator);
  });

  it('describes generation as a text brief until media generation is configured', () => {
    const gen = getManifest(Tier.Operator, MODEL).find((t) => t.name === 'generation_photoshoot')!;
    expect(gen.description).toContain('prompts and captions');
    expect(gen.description).toContain('does not generate media assets');
  });

  it('does not flag analytics or inbox as requiring approval', () => {
    const manifest = getManifest(Tier.Autonomous, MODEL);
    expect(manifest.find((t) => t.name === 'analytics_query')!.requiresApproval).toBe(false);
    expect(manifest.find((t) => t.name === 'inbox_manage')!.requiresApproval).toBe(false);
  });

  it('publishing requires approval for Manager but not Autonomous', () => {
    const manager = getManifest(Tier.Manager, MODEL).find((t) => t.name === 'publishing_post')!;
    expect(manager.requiresApproval).toBe(true);
    const autonomous = getManifest(Tier.Autonomous, MODEL).find(
      (t) => t.name === 'publishing_post',
    )!;
    expect(autonomous.requiresApproval).toBe(false);
  });

  it('network_configure always requires approval and is autonomous-tier only', () => {
    const net = getManifest(Tier.Autonomous, MODEL).find((t) => t.name === 'network_configure')!;
    expect(net.requiresApproval).toBe(true);
    expect(net.tier).toBe(Tier.Autonomous);
  });

  it('reports the correct minimum tier on each descriptor', () => {
    const manifest = getManifest(Tier.Autonomous, MODEL);
    const byName = Object.fromEntries(manifest.map((t) => [t.name, t]));
    expect(byName.analytics_query.tier).toBe(Tier.Viewer);
    expect(byName.inbox_manage.tier).toBe(Tier.Operator);
    expect(byName.generation_photoshoot.tier).toBe(Tier.Operator);
    expect(byName.publishing_post.tier).toBe(Tier.Manager);
    expect(byName.network_configure.tier).toBe(Tier.Autonomous);
  });

  it('ignores the modelId parameter when filtering', () => {
    const m1 = getManifest(Tier.Autonomous, 'model-a');
    const m2 = getManifest(Tier.Autonomous, 'model-b');
    expect(names(m1)).toEqual(names(m2));
  });
});
