import { and, eq } from 'drizzle-orm';
import { db, schema } from '@axiom/db';
import {
  CACHE_CONTROL_PROVIDERS,
  defaultCacheControlSetting,
  type CacheControlSetting,
} from '@axiom/llm-gateway';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Load model-scoped cache controls without exposing provider secrets or raw payloads. */
export async function loadCacheControls(
  tx: Transaction,
  orgId: string,
  modelId: string,
): Promise<CacheControlSetting[]> {
  const rows = await tx
    .select()
    .from(schema.providerCacheControl)
    .where(and(
      eq(schema.providerCacheControl.orgId, orgId),
      eq(schema.providerCacheControl.modelId, modelId),
    ));
  const byProvider = new Map(rows.map((row: { provider: string }) => [row.provider, row]));
  return CACHE_CONTROL_PROVIDERS.map(provider => {
    const row = byProvider.get(provider) as {
      provider: string;
      enabled: boolean;
      prefixAlignment: boolean;
      promptCacheKey: string | null;
    } | undefined;
    if (!row) return defaultCacheControlSetting(provider);
    return {
      provider: row.provider,
      enabled: row.enabled,
      prefixAlignment: row.prefixAlignment,
      promptCacheKey: row.promptCacheKey,
    };
  });
}
