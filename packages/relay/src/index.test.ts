// ─── Public barrel exports — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import * as relay from './index.js';
import * as channels from './channels/index.js';
import * as viral from './viral/index.js';
import * as observability from './observability/index.js';
import * as metrics from './metrics/index.js';

describe('@axiom/relay index exports', () => {
  it('exports every public class and function', () => {
    const classes = [
      'CardRenderer',
      'TelegramAdapter',
      'DiscordAdapter',
      'ThreadsAdapter',
      'IMessageAdapter',
      'SignalAdapter',
      'CommandRouter',
      'ViralLoop',
      'Bandit',
      'Logger',
      'MetricsRegistry',
      'IncidentManager',
      'HealthCheckRegistry',
      'MetricPoller',
    ];
    for (const name of classes) {
      expect(typeof (relay as Record<string, unknown>)[name]).toBe('function');
    }
    expect(typeof relay.createRelayRoutes).toBe('function');
    expect(typeof (relay as Record<string, unknown>).metricsRegistry).toBe('undefined'); // not exported from root
  });

  it('exports type-only re-exports without runtime collisions', () => {
    // Type-only names must NOT be runtime exports
    expect('BundleContent' in relay).toBe(false);
    expect('PlatformVerdict' in relay).toBe(false);
    expect('RelayCard' in relay).toBe(false);
    expect('CardAction' in relay).toBe(false);
    expect('CommandResult' in relay).toBe(false);
    expect('Exemplar' in relay).toBe(false);
  });
});

describe('sub-barrel exports', () => {
  it('channels/index re-exports all adapters', () => {
    expect(channels.DiscordAdapter).toBe(relay.DiscordAdapter);
    expect(channels.TelegramAdapter).toBe(relay.TelegramAdapter);
    expect(channels.SignalAdapter).toBe(relay.SignalAdapter);
    expect(channels.IMessageAdapter).toBe(relay.IMessageAdapter);
    expect(channels.ThreadsAdapter).toBe(relay.ThreadsAdapter);
  });

  it('viral/index re-exports ViralLoop and Bandit', () => {
    expect(viral.ViralLoop).toBe(relay.ViralLoop);
    expect(viral.Bandit).toBe(relay.Bandit);
  });

  it('observability/index re-exports the observability stack', () => {
    expect(observability.Logger).toBe(relay.Logger);
    expect(observability.MetricsRegistry).toBe(relay.MetricsRegistry);
    expect(observability.IncidentManager).toBe(relay.IncidentManager);
    expect(observability.HealthCheckRegistry).toBe(relay.HealthCheckRegistry);
    expect(typeof observability.metricsRegistry).toBe('object');
    expect(typeof observability.getCorrelationId).toBe('function');
    expect(typeof observability.runWithCorrelationId).toBe('function');
  });

  it('metrics/index re-exports MetricPoller', () => {
    expect(metrics.MetricPoller).toBe(relay.MetricPoller);
  });
});

describe('constructed instances work through the barrel', () => {
  it('builds a working card renderer + command router', () => {
    const renderer = new relay.CardRenderer();
    const router = new relay.CommandRouter('secret');
    const card = renderer.renderBundleCard({
      id: 'b1',
      mediaUrls: [],
      caption: 'c',
      captionVariants: {},
      hashtagSets: {},
      tosScores: {},
      targetPlatforms: [],
    });
    expect(card.bundleId).toBe('b1');
    const nonce = router.generateNonce();
    const sig = router.signCommand(nonce, 'approve', 'b1');
    expect(router.verifyCommand(sig, nonce, 'approve', 'b1')).toBe(true);
  });

  it('creates relay routes from the barrel export', () => {
    const app = relay.createRelayRoutes({
      cardRenderer: new relay.CardRenderer(),
      commandRouter: new relay.CommandRouter('s'),
      viralLoop: new relay.ViralLoop(),
      bandit: new relay.Bandit(),
      incidentManager: new relay.IncidentManager(),
      healthRegistry: new relay.HealthCheckRegistry(),
    });
    expect(typeof app.request).toBe('function');
  });
});
