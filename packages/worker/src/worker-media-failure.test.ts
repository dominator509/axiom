import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ writes: [] as Array<{ table: unknown; values: any; where: any; transaction: number }>, transaction: 0, loseTerminalLease: false }));
vi.mock('@axiom/db', async original => ({ ...await original<typeof import('@axiom/db')>(),
  db: { transaction: async (operation: (tx: any) => Promise<unknown>) => {
    const transaction = ++state.transaction;
    const query = (rows: unknown[]): any => new Proxy({}, { get(_target, key) {
      if (key === 'then') return Promise.resolve(rows).then.bind(Promise.resolve(rows));
      return () => query(rows);
    } });
    return operation({ execute: async () => ({}), select: () => query([{ publishingEnabled: true }]),
      update: (table: unknown) => ({ set: (values: unknown) => ({ where: (where: unknown) => {
        state.writes.push({ table, values, where, transaction });
        return query(state.loseTerminalLease && (values as { state?: string }).state === 'dead' ? [] : [{ id: 'job' }]);
      } }) }),
    });
  } },
}));
import { schema } from '@axiom/db';
import { processJob } from './worker.js';
import type { JobRow } from './types.js';
const orgId = '11111111-1111-4111-8111-111111111111';
const bundleId = '22222222-2222-4222-8222-222222222222';
function job(kind = 'media.generate', payload: Record<string, unknown> = { bundleId }): JobRow {
  return { id: '33333333-3333-4333-8333-333333333333', org_id: orgId, kind, payload,
    queue: 'content', state: 'running', attempts: 2, max_attempts: 3,
    locked_by: 'worker', locked_at: new Date(), last_error: null,
    run_after: new Date(), dedupe_key: null, scheduled_for: null,
    started_at: new Date(), completed_at: null, created_at: new Date() };
}
beforeEach(() => { state.writes = []; state.transaction = 0; state.loseTerminalLease = false; });
it.each([false, true])('holds unfinished media after terminal failure (dispatched=%s)', async dispatched => {
  const item = job();
  const outcome = await processJob(item, { 'media.generate': async ctx => {
    if (dispatched) ctx.markExternalSideEffect?.();
    throw new Error('Generation unavailable');
  } }, 'worker', {});
  expect(outcome).toBe('dead');
  const terminal = state.writes.find(write => write.table === schema.job && write.values.state === 'dead');
  const hold = state.writes.find(write => write.table === schema.contentBundle);
  expect(hold?.values).toEqual({ state: 'hold', updatedAt: expect.any(Date) });
  expect(hold?.transaction).toBe(terminal?.transaction);
  expect(state.writes.indexOf(hold!)).toBeLessThan(state.writes.indexOf(terminal!));
  const condition = new PgDialect().sqlToQuery(hold!.where);
  expect(condition.params).toEqual([bundleId, orgId, 'generated']);
  expect(condition.sql).toContain('"asset_id" is null');
  expect(item.last_error?.startsWith('external-side-effect-unknown:')).toBe(dispatched);
});
it.each([false, true])('rejects the terminal transaction when ownership was lost (dispatched=%s)', async dispatched => {
  state.loseTerminalLease = true;
  await expect(processJob(job(), { 'media.generate': async ctx => {
    if (dispatched) ctx.markExternalSideEffect?.();
    throw new Error('Unavailable');
  } }, 'worker', {})).rejects.toThrow('lease ownership lost before state transition');
  // This fixture verifies rejection propagates to the transaction boundary;
  // it does not substitute for a live PostgreSQL rollback test.
  const hold = state.writes.find(write => write.table === schema.contentBundle);
  const terminal = state.writes.find(write => write.table === schema.job && write.values.state === 'dead');
  expect(hold?.transaction).toBe(terminal?.transaction);
});
it('does not hold an ordinary retry that can still run', async () => {
  const item = { ...job(), attempts: 0 };
  expect(await processJob(item, { 'media.generate': async () => { throw new Error('Unavailable'); } }, 'worker', {})).toBe('retry');
  expect(state.writes.some(write => write.table === schema.contentBundle)).toBe(false);
});
it.each([
  ['publish.target', { bundleId }], ['media.generate', {}], ['media.generate', { bundleId: '../invalid' }],
] as const)('does not alter bundles for %s with payload %j', async (kind, payload) => {
  expect(await processJob(job(kind, payload), { [kind]: async () => { throw new Error('Unavailable'); } }, 'worker', {})).toBe('dead');
  expect(state.writes.some(write => write.table === schema.contentBundle)).toBe(false);
});
