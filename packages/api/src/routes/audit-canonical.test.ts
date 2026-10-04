import { describe, expect, it } from 'vitest';
import { canonical } from './helpers.js';

describe('audit detail integrity', () => {
  const payload = { org_id: 'fixture', actor_ref: 'operator', action: 'approve', target: 'bundle',
    ts: '2026-10-04T00:00:00.000Z', prev_hash: '0'.repeat(64),
    detail: { reason: 'reviewed', nested: { approved: true }, steps: ['review', 'approve'] } };
  it.each([
    { ...payload.detail, reason: 'changed' },
    { ...payload.detail, nested: { approved: false } },
    { ...payload.detail, steps: ['approve', 'review'] },
  ])('binds every detail value and array order (case %#)', detail => {
    expect(canonical({ ...payload, detail })).not.toBe(canonical(payload));
  });
});
