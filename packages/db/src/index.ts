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

// Keep readiness checks on a single isolated connection with bounded connect
// and query timeouts so a dead/stale shared application socket cannot hang the
// liveness/readiness endpoint or consume the application pool.
const readinessPool = new pg.Pool(databaseReadinessPoolOptions(process.env.DATABASE_URL));

export const db = drizzle({
  client: pool,
  schema,
});

export async function checkDatabase(): Promise<void> {
  await assertDatabaseReady(readinessPool);
}

export { schema };
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
