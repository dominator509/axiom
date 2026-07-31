// ─── MetricPoller — Vitest Suite ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricPoller, type PlatformMetrics } from './poller.js';

let poller: MetricPoller;

function makeMetrics(connectionId: string, platform: string): PlatformMetrics {
  return {
    connectionId,
    platform,
    remoteIds: ['r1'],
    impressions: 100,
    likes: 10,
    comments: 2,
    shares: 1,
    saves: 3,
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  poller = new MetricPoller();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pollPlatform', () => {
  it('returns null when no poll handler is configured', async () => {
    expect(await poller.pollPlatform('conn-1', 'tiktok', ['r1'])).toBeNull();
    expect(poller.getHistory()).toEqual([]);
  });

  it('returns and stores metrics on success', async () => {
    const handler = vi.fn().mockResolvedValue(makeMetrics('conn-1', 'tiktok'));
    poller.setPollHandler(handler);
    const result = await poller.pollPlatform('conn-1', 'tiktok', ['r1']);
    expect(handler).toHaveBeenCalledWith('conn-1', 'tiktok', ['r1']);
    expect(result?.platform).toBe('tiktok');
    expect(poller.getHistory()).toHaveLength(1);
  });

  it('returns null and keeps history unchanged when the handler throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    poller.setPollHandler(vi.fn().mockRejectedValue(new Error('api down')));
    const result = await poller.pollPlatform('conn-1', 'tiktok', ['r1']);
    expect(result).toBeNull();
    expect(poller.getHistory()).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Poll failed for tiktok/conn-1'),
      expect.any(Error),
    );
    errSpy.mockRestore();
  });
});

describe('storeMetrics', () => {
  it('caps history at 5000 entries after exceeding 10000', () => {
    for (let i = 0; i < 10001; i++) {
      poller.storeMetrics(makeMetrics(`conn-${i}`, 'tiktok'));
    }
    expect(poller.getHistory()).toHaveLength(5000);
    expect(poller.getHistory()[0].connectionId).toBe('conn-5001');
  });

  it('keeps history under the cap boundary', () => {
    for (let i = 0; i < 100; i++) {
      poller.storeMetrics(makeMetrics(`conn-${i}`, 'tiktok'));
    }
    expect(poller.getHistory()).toHaveLength(100);
  });

  it('getHistory returns a defensive copy', () => {
    poller.storeMetrics(makeMetrics('c1', 'tiktok'));
    const hist = poller.getHistory();
    hist.pop();
    expect(poller.getHistory()).toHaveLength(1);
  });
});

describe('addSchedule / removeSchedule / getScheduleStatus', () => {
  it('adds an inactive schedule', () => {
    poller.addSchedule('tiktok', 60_000);
    const status = poller.getScheduleStatus();
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ platform: 'tiktok', intervalMs: 60_000, active: false });
    expect(status[0].lastPolled).toBe(0);
  });

  it('removeSchedule deletes the schedule and clears its interval', () => {
    vi.useFakeTimers();
    poller.addSchedule('tiktok', 60_000);
    poller.startAll();
    expect(poller.getScheduleStatus()[0].active).toBe(true);
    poller.removeSchedule('tiktok');
    expect(poller.getScheduleStatus()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('removeSchedule on unknown platform is a no-op', () => {
    expect(() => poller.removeSchedule('nope')).not.toThrow();
  });
});

describe('startAll / stopAll', () => {
  it('starts intervals for active schedules and updates lastPolled on tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    poller.addSchedule('tiktok', 60_000);
    poller.addSchedule('instagram', 120_000);
    poller.startAll();

    let status = poller.getScheduleStatus();
    expect(status).toHaveLength(2);
    expect(status.every((s) => s.active)).toBe(true);

    vi.advanceTimersByTime(60_000);
    status = poller.getScheduleStatus();
    const tiktok = status.find((s) => s.platform === 'tiktok')!;
    expect(tiktok.lastPolled).toBe(1_060_000);

    poller.stopAll();
    status = poller.getScheduleStatus();
    expect(status.every((s) => s.active)).toBe(false);
    vi.useRealTimers();
  });

  it('startAll does not double-register intervals for the same platform', () => {
    vi.useFakeTimers();
    poller.addSchedule('tiktok', 60_000);
    poller.startAll();
    poller.startAll();
    expect(poller.getScheduleStatus().filter((s) => s.active)).toHaveLength(1);
    vi.useRealTimers();
  });

  it('stopAll clears all intervals and is idempotent', () => {
    vi.useFakeTimers();
    poller.addSchedule('tiktok', 60_000);
    poller.startAll();
    poller.stopAll();
    poller.stopAll();
    expect(poller.getScheduleStatus().every((s) => !s.active)).toBe(true);
    vi.useRealTimers();
  });
});
