import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { ViralExemplar } from '@axiom/llm-gateway';

export interface RetrievalRow {
  id: string;
  modelId: string;
  platform: string;
  label: string;
  perfScore: number | null;
  features: unknown;
}

/** Cross-model sharing grants access to structure, never another persona's copy. */
export function projectExemplar(row: RetrievalRow, modelId: string): ViralExemplar {
  const features = (row.features ?? {}) as Record<string, unknown>;
  const caption = typeof features.caption === 'string' ? features.caption : '';
  const hashtags = Array.isArray(features.hashtags)
    ? features.hashtags.filter((tag): tag is string => typeof tag === 'string') : [];
  const shared = row.modelId !== modelId;
  return {
    id: row.id,
    platform: row.platform as ViralExemplar['platform'],
    title: shared ? 'Shared structural guidance' : typeof features.title === 'string' ? features.title : '',
    caption: shared ? '' : caption,
    hashtags: shared ? [] : hashtags,
    viralLabel: row.label as ViralExemplar['viralLabel'],
    aiNotes: shared
      ? `Caption length: ${caption.length < 80 ? 'short' : caption.length < 240 ? 'medium' : 'long'}; paragraphs: ${Math.min(10, caption.split(/\n\s*\n/).length)}; hashtag count: ${Math.min(30, hashtags.length)}; question hook: ${caption.includes('?') ? 'yes' : 'no'}.`
      : typeof features.aiNotes === 'string' ? features.aiNotes : null,
  };
}

/**
 * Retrieve the strongest DB-backed exemplars for TOKENKILLER S2.
 *
 * The caller supplies an already RLS-scoped transaction so the synchronous
 * API and queued worker paths use the same tenant/share policy without opening
 * a second unscoped connection.
 */
export async function retrieveTopExemplars(
  tx: any,
  orgId: string,
  modelId: string,
  platform: string,
  limit: number,
): Promise<ViralExemplar[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Exemplar limit must be 1..50');
  const labelOrder = ['viral', 'strong'];
  const sharing = await tx
    .select({ viralSharing: schema.orgSettings.viralSharing })
    .from(schema.orgSettings)
    .where(eq(schema.orgSettings.orgId, orgId))
    .limit(1);
  const shareAcrossModels = sharing[0]?.viralSharing ?? false;

  const rows = await tx
    .select({
      id: schema.viralExemplar.id,
      modelId: schema.viralExemplar.modelId,
      platform: schema.viralExemplar.platform,
      label: schema.viralExemplar.label,
      perfScore: schema.viralExemplar.perfScore,
      features: schema.viralExemplar.features,
    })
    .from(schema.viralExemplar)
    .where(
      and(
        eq(schema.viralExemplar.orgId, orgId),
        ...(shareAcrossModels ? [] : [eq(schema.viralExemplar.modelId, modelId)]),
        eq(schema.viralExemplar.platform, platform),
        inArray(schema.viralExemplar.label, ['strong', 'viral']),
        sql`${schema.viralExemplar.features}->>'evidence_source' = 'published-provider-v1'`,
      ),
    )
    .orderBy(desc(schema.viralExemplar.perfScore), schema.viralExemplar.id)
    .limit(50);

  const sorted = rows.sort(
    (
      a: { label: string; perfScore: number | null },
      b: { label: string; perfScore: number | null },
    ) => {
      const la = labelOrder.indexOf(a.label) === -1 ? 3 : labelOrder.indexOf(a.label);
      const lb = labelOrder.indexOf(b.label) === -1 ? 3 : labelOrder.indexOf(b.label);
      if (la !== lb) return la - lb;
      return (b.perfScore ?? 0) - (a.perfScore ?? 0);
    },
  );

  return sorted
    .slice(0, limit)
    .map((row: RetrievalRow) => projectExemplar(row, modelId));
}
