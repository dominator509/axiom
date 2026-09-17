import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';
import pg from 'pg';
import { assertDatabaseReady } from './readiness.js';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  application_name: 'axiom',
});

export const db = drizzle({
  client: pool,
  schema,
});

export async function checkDatabase(): Promise<void> {
  await assertDatabaseReady(pool);
}

export { schema };
export {
  REQUIRED_CONSENT_DOCUMENT_KINDS,
  isCurrentConsentRecord,
  evaluateConsentRecords,
  getPublishingConsentStatus,
  consentRequirementMessage,
  getTosScanState,
} from './compliance.js';
export type {
  RequiredConsentDocumentKind,
  ConsentPolicyRow,
  ConsentStatus,
  TosScanState,
} from './compliance.js';
