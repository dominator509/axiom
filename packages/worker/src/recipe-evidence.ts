import type { PhotoshootRecipe } from '@axiom/db/schema';

/** Publication evidence only: never reconstruct historical input from an editable bundle. */
export function recipeEvidence(
  snapshot: {
    caption: string;
    scheduledFor: string | null;
    tosReport?: Record<string, unknown> | null;
    media?: {
      kind: string;
      mimeType: string;
      width: number | null;
      height: number | null;
      duration: number | null;
    } | null;
    shootConfig?: PhotoshootRecipe | null;
  },
  publishedAt: Date | null,
) {
  const published = publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null;
  return {
    recipe_evidence_version: 'publication-recipe-v1',
    hook: snapshot.caption.split(/\r?\n/, 1)[0],
    hook_source: 'caption-first-line',
    scheduled_for: snapshot.scheduledFor,
    published_at: published?.toISOString() ?? null,
    published_weekday_utc: published?.getUTCDay() ?? null,
    published_hour_utc: published?.getUTCHours() ?? null,
    tos_report_at_publication: snapshot.tosReport ?? null,
    media: snapshot.media ?? null,
    // These are the exact bounded controls submitted to the prompt engine;
    // thumbnail descriptors remain absent until a trusted vision receipt exists.
    shoot_config: snapshot.shootConfig ?? null,
  };
}
