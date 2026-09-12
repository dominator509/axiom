import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbExecute, txExecute, transaction } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  txExecute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@axiom/db', () => ({
  db: { execute: dbExecute, transaction },
  schema: {},
}));

import { isModelKillSwitchEnabled } from './org-context.js';

const MODEL = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';

describe('isModelKillSwitchEnabled', () => {
  beforeEach(() => {
    dbExecute.mockReset();
    txExecute.mockReset();
    transaction.mockReset();
    transaction.mockImplementation(async (callback: (tx: { execute: typeof txExecute }) => unknown) =>
      callback({ execute: txExecute }),
    );
    dbExecute.mockResolvedValue({ rows: [{ org_id: ORG }] });
    txExecute.mockResolvedValue({ rows: [] });
  });

  it('returns true only for an explicit disabled setting', async () => {
    txExecute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ publishing_enabled: false }],
    });

    await expect(isModelKillSwitchEnabled(MODEL)).resolves.toBe(true);
    expect(dbExecute).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledOnce();
    expect(txExecute).toHaveBeenCalledTimes(2);
  });

  it('fails closed when settings are absent', async () => {
    txExecute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await expect(isModelKillSwitchEnabled(MODEL)).resolves.toBe(true);
    expect(txExecute).toHaveBeenCalledTimes(2);
  });
});
