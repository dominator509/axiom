import { describe, expect, it, vi } from 'vitest';
import {
  assertDatabaseReady,
  databaseReadinessColumns,
  databaseReadinessQueryTimeoutMs,
  databaseReadinessSql,
  type ReadinessQuery,
} from './readiness.js';

describe('database readiness', () => {
  const mockQuery = () => vi.fn<ReadinessQuery['query']>();

  it('checks current schema columns including authentication and the latest features', () => {
    expect(databaseReadinessColumns).toEqual(expect.arrayContaining([
      { table_name: 'auth_user', column_name: 'id' },
      { table_name: 'asset', column_name: 'origin' },
      { table_name: 'inbox_reply_review', column_name: 'id' },
    ]));
    expect(new Set(databaseReadinessColumns.map(c => `${c.table_name}.${c.column_name}`)).size)
      .toBe(databaseReadinessColumns.length);
  });

  it('requires an affirmative catalog/privilege result, not just connectivity', async () => {
    const query = mockQuery().mockResolvedValue({ rows: [{ ready: true }] });
    await expect(assertDatabaseReady({ query })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith({
      text: databaseReadinessSql,
      values: [JSON.stringify(databaseReadinessColumns)],
      query_timeout: databaseReadinessQueryTimeoutMs,
    });
  });

  it.each([{ rows: [] }, { rows: [{ ready: false }] }, { rows: [{ ready: null }] }, { rows: [{ ready: 'true' }] }])(
    'fails closed on a missing or non-boolean success result %j', async ({ rows }) => {
      await expect(assertDatabaseReady({ query: mockQuery().mockResolvedValue({ rows: rows as { ready: boolean }[] }) }))
        .rejects.toThrow('Database schema is not ready');
    },
  );

  it('propagates connectivity/query failure to the readiness route', async () => {
    await expect(assertDatabaseReady({ query: mockQuery().mockRejectedValue(new Error('offline')) }))
      .rejects.toThrow('offline');
  });
});
