import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { approvalSlot } from './schedule';

const now = Date.parse('2026-01-01T00:00:00Z');
beforeEach(() => vi.stubEnv('TZ', 'America/Los_Angeles'));
afterEach(() => vi.unstubAllEnvs());

describe('approval slot REST contract', () => {
  it('preserves the API default when the operator leaves the slot blank', () => {
    expect(approvalSlot('', now)).toBeUndefined();
  });
  it('converts local summer and winter slots to UTC', () => {
    expect(approvalSlot('2026-07-10T18:30', now)).toBe('2026-07-11T01:30:00.000Z');
    expect(approvalSlot('2026-12-10T18:30', now)).toBe('2026-12-11T02:30:00.000Z');
  });
  it('works for a timezone east of UTC', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
    expect(approvalSlot('2026-07-10T18:30', now)).toBe('2026-07-10T13:00:00.000Z');
  });
  it('uses the earlier occurrence when the local clock repeats an hour', () => {
    expect(approvalSlot('2026-11-01T01:30', now)).toBe('2026-11-01T08:30:00.000Z');
  });
  it.each(['2026-02-30T18:30', '2026-03-08T02:30', '2026-13-10T18:30'])(
    'rejects nonexistent local time %s',
    (value) => {
      expect(() => approvalSlot(value, now)).toThrow('does not exist');
    },
  );
  it.each(['invalid', '2026-07-10', '2026-07-10T18:30Z'])('rejects malformed input %s', (value) => {
    expect(() => approvalSlot(value, now)).toThrow('valid local date');
  });
  it('rejects a past or current instant before any mutation is submitted', () => {
    const instant = Date.parse('2026-07-11T01:30:00Z');
    expect(() => approvalSlot('2026-07-10T18:30', instant)).toThrow('future');
    expect(() => approvalSlot('2026-07-10T18:30', instant + 1)).toThrow('future');
  });
});
