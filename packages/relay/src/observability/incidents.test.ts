// ─── IncidentManager — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncidentManager, type Incident } from './incidents.js';

let manager: IncidentManager;

beforeEach(() => {
  manager = new IncidentManager();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  // Let fire-and-forget autoPage() promises settle
  await Promise.resolve();
  await Promise.resolve();
}

describe('reportIncident', () => {
  it('creates a well-formed incident', () => {
    const incident = manager.reportIncident('sev-3', 'DB connection slow', 'postgres');
    expect(incident).toMatchObject({
      severity: 'sev-3',
      message: 'DB connection slow',
      source: 'postgres',
      resolved: false,
      crashLoop: false,
    });
    expect(incident.id).toMatch(/^inc-\d+-/);
    expect(incident.timestamp).toBeGreaterThan(0);
    expect(manager.getIncidents()).toHaveLength(1);
  });

  it('does not page for low-severity incidents without a crash loop', async () => {
    const pageHandler = vi.fn().mockResolvedValue(undefined);
    manager.setPageHandler(pageHandler);
    manager.reportIncident('sev-4', 'minor', 'worker');
    await flush();
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it('auto-pages sev-1 incidents when a page handler is configured', async () => {
    const pageHandler = vi.fn().mockResolvedValue(undefined);
    manager.setPageHandler(pageHandler);
    const incident = manager.reportIncident('sev-1', 'PRODUCTION DOWN', 'egress');
    await flush();
    expect(pageHandler).toHaveBeenCalledTimes(1);
    expect(pageHandler).toHaveBeenCalledWith(
      expect.objectContaining({ id: incident.id, severity: 'sev-1' }),
    );
  });

  it('auto-paging without a handler does not throw', async () => {
    expect(() => manager.reportIncident('sev-1', 'down', 'egress')).not.toThrow();
    await flush();
  });
});

describe('crash loop detection', () => {
  it('flags crashLoop after 5 failures from the same source within 5 minutes', async () => {
    const pageHandler = vi.fn().mockResolvedValue(undefined);
    manager.setPageHandler(pageHandler);

    const incidents: Incident[] = [];
    for (let i = 0; i < 5; i++) {
      incidents.push(manager.reportIncident('sev-4', `fail ${i}`, 'worker-node'));
    }
    await flush();

    expect(incidents[0].crashLoop).toBe(false);
    expect(incidents[1].crashLoop).toBe(false);
    expect(incidents[2].crashLoop).toBe(false);
    expect(incidents[3].crashLoop).toBe(false);
    expect(incidents[4].crashLoop).toBe(true);
    // The crashLoop 5th failure triggers an auto-page even at sev-4
    expect(pageHandler).toHaveBeenCalledTimes(1);
    expect(pageHandler).toHaveBeenCalledWith(expect.objectContaining({ crashLoop: true }));
  });

  it('does not flag crashLoop when failures are spread beyond the 5-minute window', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(t0 + i * 2 * 60 * 1000); // 2 min apart → 4th at +8min is outside window
      manager.reportIncident('sev-4', `fail ${i}`, 'slow-source');
    }
    const incidents = manager.getIncidents();
    expect(incidents[4].crashLoop).toBe(false);
    vi.useRealTimers();
  });
});

describe('enqueueDLQ / replayDLQ', () => {
  it('enqueues entries with generated ids and zero retry count', () => {
    const entry = manager.enqueueDLQ({
      originalPayload: { postId: 'p1' },
      error: 'timeout',
      source: 'publisher',
      maxRetries: 3,
    });
    expect(entry.id).toMatch(/^dlq-\d+-/);
    expect(entry.retryCount).toBe(0);
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.originalPayload).toEqual({ postId: 'p1' });
    expect(manager.getDLQ()).toHaveLength(1);
  });

  it('replays a successful DLQ entry and removes it', async () => {
    const entry = manager.enqueueDLQ({
      originalPayload: { a: 1 },
      error: 'e',
      source: 's',
      maxRetries: 3,
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    const ok = await manager.replayDLQ(entry.id, handler);
    expect(ok).toBe(true);
    expect(handler).toHaveBeenCalledWith({ a: 1 });
    expect(manager.getDLQ()).toHaveLength(0);
  });

  it('returns false for unknown DLQ ids', async () => {
    const ok = await manager.replayDLQ('dlq-nope', vi.fn());
    expect(ok).toBe(false);
  });

  it('returns false once maxRetries are exhausted and keeps the entry', async () => {
    const entry = manager.enqueueDLQ({
      originalPayload: { a: 1 },
      error: 'e',
      source: 's',
      maxRetries: 2,
    });
    const failingHandler = vi.fn().mockRejectedValue(new Error('still broken'));

    expect(await manager.replayDLQ(entry.id, failingHandler)).toBe(false);
    expect(await manager.replayDLQ(entry.id, failingHandler)).toBe(false);
    // retryCount now 2 >= maxRetries 2
    expect(await manager.replayDLQ(entry.id, failingHandler)).toBe(false);
    expect(manager.getDLQ()).toHaveLength(1);
    const stored = manager.getDLQ()[0];
    expect(stored.retryCount).toBe(2);
  });

  it('keeps the entry and increments retryCount when the handler throws', async () => {
    const entry = manager.enqueueDLQ({
      originalPayload: { a: 1 },
      error: 'e',
      source: 's',
      maxRetries: 5,
    });
    const failingHandler = vi.fn().mockRejectedValue(new Error('nope'));
    const ok = await manager.replayDLQ(entry.id, failingHandler);
    expect(ok).toBe(false);
    expect(manager.getDLQ()).toHaveLength(1);
    expect(manager.getDLQ()[0].retryCount).toBe(1);
  });
});

describe('resolveIncident', () => {
  it('resolves an existing incident', () => {
    const incident = manager.reportIncident('sev-3', 'x', 'y');
    expect(manager.resolveIncident(incident.id)).toBe(true);
    expect(manager.getIncidents()[0].resolved).toBe(true);
  });

  it('returns false for unknown incidents', () => {
    expect(manager.resolveIncident('inc-nope')).toBe(false);
  });
});
