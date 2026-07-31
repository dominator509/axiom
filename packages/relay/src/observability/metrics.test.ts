// ─── MetricsRegistry — Vitest Suite ───
import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsRegistry } from './metrics.js';

let registry: MetricsRegistry;

beforeEach(() => {
  registry = new MetricsRegistry();
});

describe('registerCounter / incrementCounter', () => {
  it('registers a counter idempotently', () => {
    registry.registerCounter('requests', 'Total requests');
    registry.incrementCounter('requests');
    registry.registerCounter('requests', 'Total requests');
    // No getter for counters — verify via getMetrics output (one TYPE line)
    const out = registry.getMetrics();
    expect(out.match(/# TYPE requests counter/g)).toHaveLength(1);
    expect(out).toContain('# HELP requests Total requests');
  });

  it('incrementCounter auto-registers missing counters', () => {
    registry.incrementCounter('new_counter');
    const out = registry.getMetrics();
    expect(out).toContain('# TYPE new_counter counter');
    expect(out).toContain('new_counter 1');
  });

  it('increments with default value 1 and custom values', () => {
    registry.incrementCounter('hits');
    registry.incrementCounter('hits');
    registry.incrementCounter('hits', {}, 3);
    const out = registry.getMetrics();
    expect(out).toContain('hits 5');
  });

  it('tracks counters separately per label set', () => {
    registry.incrementCounter('relay_cards_sent', { platform: 'tiktok' });
    registry.incrementCounter('relay_cards_sent', { platform: 'instagram' });
    registry.incrementCounter('relay_cards_sent', { platform: 'tiktok' });
    const out = registry.getMetrics();
    expect(out).toContain('relay_cards_sent{platform="tiktok"} 2');
    expect(out).toContain('relay_cards_sent{platform="instagram"} 1');
  });

  it('sorts and escapes label values', () => {
    registry.incrementCounter('m', { b: '2', a: '1' });
    registry.incrementCounter('m', { c: 'va"lue' });
    const out = registry.getMetrics();
    expect(out).toContain('m{a="1",b="2"} 1');
    expect(out).toContain('m{c="va\\"lue"} 1');
  });

  it('emits unlabelled counters without braces', () => {
    registry.incrementCounter('plain');
    const out = registry.getMetrics();
    expect(out).toContain('plain 1');
    expect(out).not.toContain('plain{');
  });
});

describe('registerHistogram / observeHistogram', () => {
  it('registers histogram and outputs standard prometheus lines', () => {
    registry.registerHistogram('latency', 'Request latency', [0.1, 0.5, 1]);
    registry.observeHistogram('latency', 0.2);
    const out = registry.getMetrics();
    expect(out).toContain('# HELP latency Request latency');
    expect(out).toContain('# TYPE latency histogram');
    expect(out).toContain('latency_bucket{le="0.1"} 0');
    expect(out).toContain('latency_bucket{le="0.5"} 1');
    expect(out).toContain('latency_bucket{le="1"} 0');
    expect(out).toContain('latency_bucket{le="+Inf"} 0');
    expect(out).toContain('latency_sum 0.2');
    expect(out).toContain('latency_count 1');
  });

  it('buckets values and tracks overflow in +Inf', () => {
    registry.registerHistogram('h', 'help', [1, 2, 3]);
    registry.observeHistogram('h', 0.5); // bucket 1
    registry.observeHistogram('h', 2.5); // bucket 3
    registry.observeHistogram('h', 99);  // +Inf overflow
    const out = registry.getMetrics();
    expect(out).toContain('h_bucket{le="1"} 1');
    expect(out).toContain('h_bucket{le="2"} 0');
    expect(out).toContain('h_bucket{le="3"} 1');
    expect(out).toContain('h_bucket{le="+Inf"} 1');
    expect(out).toContain('h_sum 102');
    expect(out).toContain('h_count 3');
  });

  it('observeHistogram on unregistered histogram is a no-op', () => {
    expect(() => registry.observeHistogram('missing', 1)).not.toThrow();
    const out = registry.getMetrics();
    expect(out).not.toContain('missing');
  });

  it('uses default buckets when none provided', () => {
    registry.registerHistogram('default_buckets', 'help');
    registry.observeHistogram('default_buckets', 0.001);
    const out = registry.getMetrics();
    expect(out).toContain('default_buckets_bucket{le="0.005"} 1');
    expect(out).toContain('default_buckets_bucket{le="10"} 0');
  });

  it('registerHistogram is idempotent', () => {
    registry.registerHistogram('h', 'first', [1]);
    registry.registerHistogram('h', 'second', [2]);
    registry.observeHistogram('h', 0.5);
    const out = registry.getMetrics();
    expect(out).toContain('# HELP h first');
    expect(out).not.toContain('# HELP h second');
    expect(out).toContain('h_bucket{le="1"} 1');
  });
});

describe('getMetrics format', () => {
  it('returns empty string for empty registry', () => {
    expect(registry.getMetrics()).toBe('');
  });

  it('joins multiple metric families with newlines', () => {
    registry.incrementCounter('a');
    registry.registerHistogram('b', 'hb');
    const out = registry.getMetrics();
    expect(out).toContain('# TYPE a counter\n');
    expect(out).toContain('\n# TYPE b histogram');
  });
});

describe('singleton metricsRegistry', () => {
  it('exports a singleton with default counters pre-registered', async () => {
    const { metricsRegistry } = await import('./metrics.js');
    // Counters only emit after at least one increment; histograms emit immediately
    metricsRegistry.incrementCounter('posts_published');
    metricsRegistry.incrementCounter('posts_failed');
    metricsRegistry.incrementCounter('generation_count');
    metricsRegistry.incrementCounter('tos_blocked');
    metricsRegistry.incrementCounter('relay_cards_sent');
    const out = metricsRegistry.getMetrics();
    expect(out).toContain('# TYPE posts_published counter');
    expect(out).toContain('# HELP posts_published Total posts published');
    expect(out).toContain('# TYPE posts_failed counter');
    expect(out).toContain('# TYPE generation_count counter');
    expect(out).toContain('# TYPE tos_blocked counter');
    expect(out).toContain('# TYPE relay_cards_sent counter');
    expect(out).toContain('# TYPE publish_latency histogram');
    expect(out).toContain('# TYPE generation_latency histogram');
  });
});
