// ─── Connector Registry — Vitest Suite ───
// Covers: register (incl. duplicate rejection), connectorFor (incl. missing platform),
// hasConnector, allConnectors, registeredPlatforms, resolveCapabilities, validateForPlatform.
// The registry is module-level state, so each test gets a fresh module via vi.resetModules().

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

let mod: typeof import('./registry.js');

beforeEach(async () => {
  vi.resetModules();
  mod = await import('./registry.js');
});

function fakeConnector(platform: Platform, displayName = platform): SocialConnector {
  return {
    platform,
    displayName,
    publishMode: 'api' as PublishMode,
    auth: { accessToken: 'tok' } as ConnectorAuth,
    capability(): ConnectorCapability {
      return {
        publish: true,
        media: ['image'],
        maxMediaBytes: 1000,
        maxMediaCount: 1,
        caption: true,
        maxCaptionLength: 100,
        scheduling: 'internal',
        metrics: ['likes'],
        refreshMetrics: true,
      };
    },
    async validate(_input: ConnectorPublishInput): Promise<ValidationReport> {
      return { valid: true, errors: [], warnings: [], infos: [], tosVerdict: 'pass' };
    },
    async publish(_input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
      return { remoteId: `${platform}-1`, state: 'published' };
    },
    async fetchMetrics(remoteId: string): Promise<ConnectorMetrics> {
      return { postId: remoteId, platform, collectedAt: new Date().toISOString(), metrics: {} };
    },
    async revoke(): Promise<void> {},
  };
}

describe('register', () => {
  it('registers a connector and makes it available via connectorFor', () => {
    const c = fakeConnector('instagram');
    mod.register(c);
    expect(mod.connectorFor('instagram')).toBe(c);
    expect(mod.hasConnector('instagram')).toBe(true);
  });

  it('throws when a platform is already registered', () => {
    mod.register(fakeConnector('x'));
    expect(() => mod.register(fakeConnector('x'))).toThrow(
      "Connector for platform 'x' already registered",
    );
  });

  it('allows registering every platform', () => {
    const platforms: Platform[] = [
      'instagram', 'tiktok', 'x', 'youtube', 'facebook', 'reddit',
      'threads', 'snapchat', 'discord', 'telegram', 'fanvue',
    ];
    for (const p of platforms) {
      mod.register(fakeConnector(p));
    }
    expect(mod.allConnectors()).toHaveLength(11);
    expect(mod.registeredPlatforms().sort()).toEqual([...platforms].sort());
  });
});

describe('connectorFor', () => {
  it('throws for an unregistered platform', () => {
    expect(() => mod.connectorFor('telegram')).toThrow(
      "No connector registered for platform 'telegram'",
    );
  });

  it('returns the same instance on repeated lookups', () => {
    mod.register(fakeConnector('fanvue'));
    expect(mod.connectorFor('fanvue')).toBe(mod.connectorFor('fanvue'));
  });
});

describe('hasConnector', () => {
  it('returns false for unregistered platforms', () => {
    expect(mod.hasConnector('youtube')).toBe(false);
  });

  it('returns true after registration', () => {
    mod.register(fakeConnector('youtube'));
    expect(mod.hasConnector('youtube')).toBe(true);
  });
});

describe('allConnectors / registeredPlatforms', () => {
  it('returns empty collections before any registration', () => {
    expect(mod.allConnectors()).toEqual([]);
    expect(mod.registeredPlatforms()).toEqual([]);
  });

  it('returns registered connectors and platform ids in insertion order', () => {
    const a = fakeConnector('reddit');
    const b = fakeConnector('threads');
    mod.register(a);
    mod.register(b);
    expect(mod.allConnectors()).toEqual([a, b]);
    expect(mod.registeredPlatforms()).toEqual(['reddit', 'threads']);
  });
});

describe('resolveCapabilities', () => {
  it('delegates to the registered connector capability()', () => {
    const c = fakeConnector('snapchat');
    mod.register(c);
    const cap = mod.resolveCapabilities('snapchat');
    expect(cap).toEqual(c.capability());
    expect(cap.publish).toBe(true);
  });

  it('throws for an unregistered platform', () => {
    expect(() => mod.resolveCapabilities('discord')).toThrow(
      "No connector registered for platform 'discord'",
    );
  });
});

describe('validateForPlatform', () => {
  it('delegates validation to the platform connector', async () => {
    const validateSpy = vi.fn().mockResolvedValue({
      valid: false,
      errors: [{ field: 'mediaUrls', message: 'no media', severity: 'error' }],
      warnings: [],
      infos: [],
      tosVerdict: 'block',
    } satisfies ValidationReport);
    const c: SocialConnector = {
      ...fakeConnector('tiktok'),
      validate: validateSpy,
    };
    mod.register(c);

    const input: ConnectorPublishInput = {
      idempotencyKey: 'k',
      caption: 'c',
      mediaUrls: [],
    };
    const report = await mod.validateForPlatform('tiktok', input);

    expect(validateSpy).toHaveBeenCalledWith(input);
    expect(report.valid).toBe(false);
    expect(report.tosVerdict).toBe('block');
  });

  it('throws for an unregistered platform', async () => {
    const input: ConnectorPublishInput = { idempotencyKey: 'k', caption: 'c', mediaUrls: ['https://a.jpg'] };
    await expect(mod.validateForPlatform('facebook', input)).rejects.toThrow(
      "No connector registered for platform 'facebook'",
    );
  });
});
