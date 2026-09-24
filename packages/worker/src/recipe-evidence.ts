import type { PhotoshootRecipe } from '@axiom/db/schema';
import type { GuidanceEvidence } from '@axiom/core';
import { readTrustedThumbnailFeatures } from './thumbnail-features.js';

/** Publication evidence only: never reconstruct historical input from an editable bundle. */
export function recipeEvidence(
  snapshot: {
    caption: string;
    assetId: string | null;
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
    thumbnailFeatures?: unknown;
    learningEvidence?: GuidanceEvidence | null;
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
    // These are the exact bounded controls submitted to the prompt engine.
    shoot_config: snapshot.shootConfig ?? null,
    thumbnail_features: readTrustedThumbnailFeatures(snapshot.thumbnailFeatures, snapshot.assetId) ?? null,
    learning_evidence_version: snapshot.learningEvidence ? 'learning-evidence-v1' : null,
    learning_evidence: snapshot.learningEvidence ?? null,
  };
}
