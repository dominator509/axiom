import { and, cosineDistance, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { ViralExemplar } from '@axiom/llm-gateway';
import { embedExemplarIntent } from './embedding.js';

export interface RetrievalRow {
  id: string;
  modelId: string;
  platform: string;
  label: string;
  perfScore: number | null;
  features: unknown;
}

export interface RankedRow extends RetrievalRow { embedding: number[]; createdAt: Date | string }

function similarity(a: number[], b: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] ?? 0); aa += a[i] ** 2; bb += (b[i] ?? 0) ** 2;
  }
  return aa && bb ? Math.max(0, Math.min(1, dot / Math.sqrt(aa * bb))) : 0;
}

/** MMR over bounded k-NN candidates, with a thirty-day recency half-life. */
export function diversifyExemplars(rows: RankedRow[], query: number[], limit: number, now = Date.now()): RankedRow[] {
  const remaining = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const selected: RankedRow[] = [];
  while (remaining.length && selected.length < limit) {
    let best = 0, bestScore = -Infinity;
    remaining.forEach((row, index) => {
      const age = Math.max(0, now - new Date(row.createdAt).getTime());
      const recency = Number.isFinite(age) ? 2 ** (-age / (30 * 86400_000)) : 0;
      const relevance = .7 * similarity(query, row.embedding) + .2 * recency
        + .1 * Math.max(0, Math.min(1, (row.perfScore ?? 0) / 3));
      const redundancy = Math.max(0, ...selected.map(other => similarity(other.embedding, row.embedding)));
      const score = .5 * relevance - .5 * redundancy;
      if (score > bestScore) { best = index; bestScore = score; }
    });
    selected.push(remaining.splice(best, 1)[0]);
  }
  return selected;
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
  intent = '',
): Promise<ViralExemplar[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Exemplar limit must be 1..50');
  let query = embedExemplarIntent(intent);
  if (!query.some(value => value !== 0)) query = embedExemplarIntent(platform);
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
      embedding: schema.viralExemplar.embedding,
      createdAt: schema.viralExemplar.createdAt,
    })
    .from(schema.viralExemplar)
    .where(
      and(
        eq(schema.viralExemplar.orgId, orgId),
        ...(shareAcrossModels ? [] : [eq(schema.viralExemplar.modelId, modelId)]),
        eq(schema.viralExemplar.platform, platform),
        inArray(schema.viralExemplar.label, ['strong', 'viral']),
        sql`${schema.viralExemplar.features}->>'evidence_source' = 'published-provider-v1'`,
        sql`${schema.viralExemplar.features}->>'embedding_version' = 'lexical-v1'`,
      ),
    )
    .orderBy(cosineDistance(schema.viralExemplar.embedding, query), schema.viralExemplar.id)
    .limit(50);

  return diversifyExemplars(rows, query, limit)
    .map((row: RetrievalRow) => projectExemplar(row, modelId));
}
