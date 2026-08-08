// ─── HealthCheckRegistry — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import { HealthCheckRegistry, type HealthCheckResult } from './health.js';

describe('registerCheck / runAll', () => {
  it('returns ok with empty checks for an empty registry', async () => {
    const registry = new HealthCheckRegistry();
    const status = await registry.runAll();
    expect(status.status).toBe('ok');
    expect(status.checks).toEqual([]);
    expect(typeof status.timestamp).toBe('string');
    expect(new Date(status.timestamp).getTime()).not.toBeNaN();
  });

  it('aggregates healthy checks into an ok status', async () => {
    const registry = new HealthCheckRegistry();
    registry.registerCheck('db', async () => ({
      name: 'db',
      status: 'ok' as const,
      message: 'fine',
      latencyMs: 1,
    }));
    registry.registerCheck('cache', async () => ({
      name: 'cache',
      status: 'ok' as const,
      latencyMs: 2,
    }));
    const status = await registry.runAll();
    expect(status.status).toBe('ok');
    expect(status.checks).toHaveLength(2);
    expect(status.checks.map((c) => c.name).sort()).toEqual(['cache', 'db']);
  });

  it('reports degraded when any check is degraded', async () => {
    const registry = new HealthCheckRegistry();
    registry.registerCheck('a', async () => ({ name: 'a', status: 'ok' as const, latencyMs: 0 }));
    registry.registerCheck('b', async () => ({
      name: 'b',
      status: 'degraded' as const,
      message: 'slow',
      latencyMs: 50,
    }));
    const status = await registry.runAll();
    expect(status.status).toBe('degraded');
  });

  it('reports fail when any check fails (fail overrides degraded)', async () => {
    const registry = new HealthCheckRegistry();
    registry.registerCheck('a', async () => ({
      name: 'a',
      status: 'degraded' as const,
      latencyMs: 1,
    }));
    registry.registerCheck('b', async () => ({
      name: 'b',
      status: 'fail' as const,
      message: 'down',
      latencyMs: 1,
    }));
    const status = await registry.runAll();
    expect(status.status).toBe('fail');
  });

  it('captures thrown exceptions as failing checks', async () => {
    const registry = new HealthCheckRegistry();
    registry.registerCheck('flaky', async () => {
      throw new Error('connection refused');
    });
    registry.registerCheck('ok', async () => ({ name: 'ok', status: 'ok' as const, latencyMs: 0 }));
    const status = await registry.runAll();
    expect(status.status).toBe('fail');
    const flaky = status.checks.find((c) => c.name === 'flaky')!;
    expect(flaky.status).toBe('fail');
    expect(flaky.message).toBe('connection refused');
  });

  it('runs all checks concurrently and preserves order of completion', async () => {
    const registry = new HealthCheckRegistry();
    const order: string[] = [];
    registry.registerCheck('slow', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('slow');
      return { name: 'slow', status: 'ok' as const, latencyMs: 20 };
    });
    registry.registerCheck('fast', async () => {
      order.push('fast');
      return { name: 'fast', status: 'ok' as const, latencyMs: 0 };
    });
    const status = await registry.runAll();
    expect(order).toEqual(['fast', 'slow']); // ran concurrently
    expect(status.checks).toHaveLength(2);
  });
});

describe('registerStandardChecks', () => {
  it('registers the four standard checks, all passing', async () => {
    const registry = new HealthCheckRegistry();
    registry.registerStandardChecks();
    const status = await registry.runAll();
    expect(status.status).toBe('ok');
    const names = status.checks.map((c: HealthCheckResult) => c.name).sort();
    expect(names).toEqual(['egress-plane', 'postgres', 'relay-channels', 'vision-engine']);
    for (const c of status.checks) {
      expect(c.latencyMs).toBeGreaterThanOrEqual(0);
      expect(c.message).toBeTruthy();
    }
  });
});
