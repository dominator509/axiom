import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { incidentNotify } from './incident.js';

function makeTx(previousHash: Buffer) {
  const limit = vi.fn().mockResolvedValue([{ rowHash: previousHash }]);
  const orderBy = vi.fn(() => ({ limit }));
  const whereSelect = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));
  const values = vi.fn().mockResolvedValue([]);
  const insert = vi.fn(() => ({ values }));
  const whereUpdate = vi.fn().mockResolvedValue([]);
  const set = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn(() => ({ set }));

  return {
    tx: { select, insert, update },
    insertValues: values,
    updateWhere: whereUpdate,
  };
}

describe('incident.notify executor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hashes the complete incident audit row instead of copying prev_hash', async () => {
    const now = new Date('2026-09-07T18:00:00.000Z');
    vi.setSystemTime(now);
    const previousHash = createHash('sha256').update('previous').digest();
    const { tx, insertValues } = makeTx(previousHash);

    await incidentNotify({
      tx,
      workerId: 'worker-1',
      killSwitchEnabled: true,
      job: {
        id: 'job-1',
        org_id: 'org-1',
        payload: { incidentId: 'incident-1', message: 'publish failed' },
      } as never,
    });

    const row = insertValues.mock.calls[0]?.[0] as {
      prevHash: Buffer;
      rowHash: Buffer;
      detail: Record<string, string>;
      ts: Date;
    };
    expect(row.prevHash).toEqual(previousHash);
    expect(row.rowHash).not.toEqual(previousHash);
    expect(row.detail).toEqual({ message: 'publish failed', severity: 'sev-1' });

    const payload = {
      org_id: 'org-1',
      actor_ref: 'worker:worker-1',
      action: 'incident.raise',
      target: 'incident-1',
      detail: row.detail,
      ts: now.toISOString(),
      prev_hash: previousHash.toString('hex'),
    };
    const expected = createHash('sha256')
      .update(JSON.stringify(payload, Object.keys(payload).sort()))
      .digest();
    expect(row.rowHash).toEqual(expected);
  });

  it('marks the referenced job dead for DLQ visibility', async () => {
    const previousHash = Buffer.alloc(32);
    const { tx, updateWhere } = makeTx(previousHash);

    await incidentNotify({
      tx,
      workerId: 'worker-1',
      killSwitchEnabled: true,
      job: {
        id: 'job-incident',
        org_id: 'org-1',
        payload: { incidentId: 'incident-1', jobId: 'job-original' },
      } as never,
    });

    expect(updateWhere).toHaveBeenCalledTimes(1);
  });
});
