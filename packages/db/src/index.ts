import { sql } from 'drizzle-orm';
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

export interface ProviderCacheObservationInput {
  orgId: string;
  modelId: string;
  provider: string;
  observedAt: Date;
  usage?: {
    promptTokens: number;
    cachedPromptTokens: number;
    cacheCreationPromptTokens: number;
  };
}

/** Persist one successful provider response in an independent tenant-scoped transaction. */
export async function recordProviderCacheObservation(
  input: ProviderCacheObservationInput,
): Promise<void> {
  const hasUsage = input.usage !== undefined;
  const table = schema.providerCacheObservation;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${input.orgId}, true)`);
    await tx.insert(table).values({
      orgId: input.orgId,
      modelId: input.modelId,
      provider: input.provider,
      observedOn: input.observedAt.toISOString().slice(0, 10),
      observedResponses: hasUsage ? 1 : 0,
      unobservedResponses: hasUsage ? 0 : 1,
      promptTokens: input.usage?.promptTokens ?? 0,
      cachedPromptTokens: input.usage?.cachedPromptTokens ?? 0,
      cacheCreationPromptTokens: input.usage?.cacheCreationPromptTokens ?? 0,
      lastObservedAt: input.observedAt,
    }).onConflictDoUpdate({
      target: [table.orgId, table.modelId, table.provider, table.observedOn],
      set: {
        observedResponses: sql`${table.observedResponses} + EXCLUDED.observed_responses`,
        unobservedResponses: sql`${table.unobservedResponses} + EXCLUDED.unobserved_responses`,
        promptTokens: sql`${table.promptTokens} + EXCLUDED.prompt_tokens`,
        cachedPromptTokens: sql`${table.cachedPromptTokens} + EXCLUDED.cached_prompt_tokens`,
        cacheCreationPromptTokens: sql`${table.cacheCreationPromptTokens} + EXCLUDED.cache_creation_prompt_tokens`,
        lastObservedAt: input.observedAt,
        updatedAt: input.observedAt,
      },
    });
  });
}

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
