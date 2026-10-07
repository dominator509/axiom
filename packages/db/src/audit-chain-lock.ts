import { sql, type SQL } from 'drizzle-orm';

type AuditLockTransaction = {
  execute: (query: SQL) => PromiseLike<unknown>;
};

/** Serialize audit-chain appends for one organization within the current transaction. */
export async function lockAuditChain(tx: AuditLockTransaction, orgId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${orgId}, 0))`);
}
