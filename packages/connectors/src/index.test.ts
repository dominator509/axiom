// ─── Connectors Barrel Export — Vitest Suite ───
// Verifies every symbol exported from packages/connectors/src/index.ts resolves.

import { describe, it, expect } from 'vitest';
import * as connectors from './index.js';

describe('@axiom/connectors barrel exports', () => {
  it('exports the BaseConnector class', () => {
    expect(connectors.BaseConnector).toBeTypeOf('function');
  });

  it('exports every platform connector class', () => {
    const classes = [
      'InstagramConnector',
      'TikTokConnector',
      'YouTubeConnector',
      'XConnector',
      'FacebookConnector',
      'RedditConnector',
      'ThreadsConnector',
      'DiscordConnector',
      'TelegramConnector',
      'SnapchatConnector',
      'FanvueConnector',
    ];
    for (const name of classes) {
      expect(connectors[name as keyof typeof connectors]).toBeTypeOf('function');
    }
  });

  it('exports all registry functions', () => {
    const fns = [
      'register',
      'connectorFor',
      'hasConnector',
      'allConnectors',
      'registeredPlatforms',
      'resolveCapabilities',
      'validateForPlatform',
    ];
    for (const name of fns) {
      expect(connectors[name as keyof typeof connectors]).toBeTypeOf('function');
    }
  });

  it('exports the tenant-scoped connector factory and capability serializer', () => {
    expect(connectors.createConnector).toBeTypeOf('function');
    expect(connectors.capabilityNames).toBeTypeOf('function');
  });

  it('exports validatePublish', () => {
    expect(connectors.validatePublish).toBeTypeOf('function');
  });

  it('does not export internal cache helpers unintentionally', () => {
    expect('clearCapabilityCache' in connectors).toBe(false);
  });
});
