import { expect, it } from 'vitest';
import { nextDigestAt } from './digest-schedule.js';
it.each([
  ['2026-09-20T23:59:59Z', '2026-09-21T00:00:00.000Z'],
  ['2026-09-21T00:00:00Z', '2026-09-28T00:00:00.000Z'],
  ['2026-09-17T10:30:00Z', '2026-09-21T00:00:00.000Z'],
  ['2026-12-31T23:00:00Z', '2027-01-04T00:00:00.000Z'],
])('schedules strictly next Monday UTC from %s', (now, expected) => {
  expect(nextDigestAt(new Date(now)).toISOString()).toBe(expected);
});
it('rejects an invalid clock', () => expect(() => nextDigestAt(new Date('invalid'))).toThrow());
