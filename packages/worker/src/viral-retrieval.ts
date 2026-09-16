import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { ViralExemplar } from '@axiom/llm-gateway';

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
  const labelOrder = ['viral', 'strong', 'baseline', 'weak'];
  const sharing = await tx
    .select({ viralSharing: schema.orgSettings.viralSharing })
    .from(schema.orgSettings)
    .where(eq(schema.orgSettings.orgId, orgId))
    .limit(1);
  const shareAcrossModels = sharing[0]?.viralSharing ?? false;

  const rows = await tx
    .select({
      id: schema.viralExemplar.id,
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
      ),
    )
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
    .map(
      (row: {
        id: string;
        platform: string;
        label: string;
        perfScore: number | null;
        features: unknown;
      }) => {
        const features = (row.features ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          platform: (row.platform as ViralExemplar['platform']) ?? 'instagram',
          title: (features.title as string) ?? '',
          caption: (features.caption as string) ?? '',
          hashtags: Array.isArray(features.hashtags) ? (features.hashtags as string[]) : [],
          viralLabel: (row.label as ViralExemplar['viralLabel']) ?? 'baseline',
          aiNotes: (features.aiNotes as string | null) ?? null,
        };
      },
    );
}
