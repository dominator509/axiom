import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';
import pg from 'pg';
import { assertDatabaseReady, databaseReadinessPoolOptions } from './readiness.js';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  application_name: 'axiom',
});

function observeIdlePoolErrors(databasePool: pg.Pool, poolName: 'application' | 'readiness'): void {
  databasePool.on('error', (error) => {
    const candidateCode = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const code = candidateCode && /^[A-Z0-9_]{1,32}$/.test(candidateCode) ? candidateCode : undefined;
    console.error(JSON.stringify({
      event: 'database_pool_idle_client_error',
      pool: poolName,
      errorClass: error instanceof Error ? 'Error' : 'UnknownError',
      ...(code ? { code } : {}),
    }));
  });
}

observeIdlePoolErrors(pool, 'application');

// Keep readiness checks on a single isolated connection with bounded connect
// and query timeouts so a dead/stale shared application socket cannot hang the
// liveness/readiness endpoint or consume the application pool.
const readinessPool = new pg.Pool(databaseReadinessPoolOptions(process.env.DATABASE_URL));
observeIdlePoolErrors(readinessPool, 'readiness');

export const db = drizzle({
  client: pool,
  schema,
});

export async function checkDatabase(): Promise<void> {
  await assertDatabaseReady(readinessPool);
}

export { schema };
export { lockAuditChain } from './audit-chain-lock.js';
export {
  REQUIRED_CONSENT_DOCUMENT_KINDS,
  isCurrentConsentRecord,
  evaluateConsentRecords,
  getPublishingConsentStatus,
  consentRequirementMessage,
  getTosScanState,
  tosScanSnapshotDigest,
} from './compliance.js';
export type {
  RequiredConsentDocumentKind,
  ConsentPolicyRow,
  ConsentStatus,
  TosScanState,
  TosScanSnapshotInput,
} from './compliance.js';
