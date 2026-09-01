// ─── Capability Resolution & Caching — Vitest Suite ───
// Covers: resolveCapabilities delegation, cacheCapability caching behavior,
// and clearCapabilityCache invalidation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  SocialConnector,
  ConnectorAuth,
  ConnectorCapability,
  ConnectorPublishInput,
  ConnectorPublishResult,
  ConnectorMetrics,
  ValidationReport,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';

let registry: typeof import('./registry.js');
let capabilities: typeof import('./capabilities.js');

beforeEach(async () => {
  vi.resetModules();
  registry = await import('./registry.js');
  capabilities = await import('./capabilities.js');
});

function fakeConnector(
  platform: Platform,
  capOverride?: Partial<ConnectorCapability>,
): SocialConnector {
  const cap: ConnectorCapability = {
    publish: true,
    media: ['image'],
    maxMediaBytes: 1000,
    maxMediaCount: 1,
    caption: true,
    maxCaptionLength: 100,
    scheduling: 'internal',
    metrics: ['likes'],
    refreshMetrics: true,
    ...capOverride,
  };
  return {
    platform,
    displayName: platform,
    publishMode: 'api' as PublishMode,
    auth: { accessToken: 'tok' } as ConnectorAuth,
    capability: () => cap,
    async validate(_input: ConnectorPublishInput): Promise<ValidationReport> {
      return { valid: true, errors: [], warnings: [], infos: [], tosVerdict: 'pass' };
    },
    async publish(_input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
      return { remoteId: 'r', state: 'published' };
    },
    async fetchMetrics(remoteId: string): Promise<ConnectorMetrics> {
      return { postId: remoteId, platform, collectedAt: new Date().toISOString(), metrics: {} };
    },
    async revoke(): Promise<void> {},
  };
}

describe('resolveCapabilities', () => {
  it('delegates to the registered connector capability()', () => {
    const c = fakeConnector('x', { maxCaptionLength: 999 });
    registry.register(c);
    expect(capabilities.resolveCapabilities('x').maxCaptionLength).toBe(999);
  });

  it('throws when no connector is registered', () => {
    expect(() => capabilities.resolveCapabilities('x')).toThrow(
      "No connector registered for platform 'x'",
    );
  });
});

describe('capabilityNames', () => {
  it('serializes only capabilities declared by the connector', () => {
    expect(
      capabilities.capabilityNames({
        publish: true,
        media: ['image', 'carousel'],
        maxMediaBytes: 100,
        maxMediaCount: 2,
        caption: true,
        maxCaptionLength: 100,
        scheduling: 'native',
        metrics: ['likes'],
        refreshMetrics: true,
      }),
    ).toEqual(['publish', 'publish.image', 'publish.carousel', 'schedule.native', 'read.insights']);
  });

  it('does not advertise scheduling or insights when they are unsupported', () => {
    expect(
      capabilities.capabilityNames({
        publish: true,
        media: ['image'],
        maxMediaBytes: 100,
        maxMediaCount: 1,
        caption: false,
        maxCaptionLength: 0,
        scheduling: 'none',
        metrics: [],
        refreshMetrics: false,
      }),
    ).toEqual(['publish', 'publish.image']);
  });
});

describe('cacheCapability', () => {
  it('calls capability() once and serves subsequent calls from cache', () => {
    const c = fakeConnector('instagram');
    const capabilitySpy = vi.spyOn(c, 'capability');
    registry.register(c);

    const first = capabilities.cacheCapability('instagram');
    const second = capabilities.cacheCapability('instagram');

    expect(capabilitySpy).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('throws when no connector is registered', () => {
    expect(() => capabilities.cacheCapability('instagram')).toThrow(
      "No connector registered for platform 'instagram'",
    );
  });
});

describe('clearCapabilityCache', () => {
  it('invalidates cached capabilities so capability() is called again', () => {
    const c = fakeConnector('fanvue');
    const capabilitySpy = vi.spyOn(c, 'capability');
    registry.register(c);

    capabilities.cacheCapability('fanvue');
    capabilities.cacheCapability('fanvue');
    expect(capabilitySpy).toHaveBeenCalledTimes(1);

    capabilities.clearCapabilityCache();
    capabilities.cacheCapability('fanvue');
    expect(capabilitySpy).toHaveBeenCalledTimes(2);
  });
});
