import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { lockAuditChain } from './audit-chain-lock.js';

describe('audit-chain transaction lock', () => {
  it('uses a transaction-scoped advisory lock keyed by organization', async () => {
    const statements: SQL[] = [];
    await lockAuditChain({ execute: async (statement) => { statements.push(statement); } }, 'org-1');

    expect(statements).toHaveLength(1);
    const statement = statements[0];
    if (!statement) throw new Error('Expected one audit lock statement');
    expect(new PgDialect().sqlToQuery(statement)).toEqual({
      sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      params: ['org-1'],
    });
  });
});
