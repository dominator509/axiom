// ─── Generation pipeline (F-36, L3.0) — TOKENKILLER + LLM + ToS → bundle ───
// POST /models/:id/generate — runs the Master Prompt Engine
// (generatePhotoshootPrompts, TOKENKILLER S0-S3), optionally enriches via the
// LLM gateway, evaluates text ToS rules per platform (LBI-11), and persists a
// text-only content_bundle. It does not create a media asset; the operator
// must supply one separately before approving a media-only destination.
// The operator then approves/revises/rejects via Relay or the dashboard
// approvals tab.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit, apiError, statusTitle } from './helpers.js';
import {
  generatePhotoshootPrompts,
  buildS0,
  buildS1,
  buildS2,
  buildS3,
  assemblePrompt,
  type ModelProfile as PromptModelProfile,
  type ViralExemplar,
} from '@axiom/llm-gateway';
import { LLMGateway } from '@axiom/llm-gateway';
import { PLATFORM_RULES, DEFAULT_PLATFORM_THRESHOLDS } from '@axiom/fanvue-mcp';
import { asPlatform, enqueueJob } from '@axiom/worker';

type PromptPlatform =
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'youtube'
  | 'facebook'
  | 'reddit'
  | 'threads'
  | 'snapchat'
  | 'discord'
  | 'telegram'
  | 'fanvue';

const router = new Hono<AppBindings>();

/**
 * Retrieve the model's top-performing viral exemplars for S2 injection
 * (F-83, L2.8/L3.5). Real DB path: viral_exemplar rows ranked by label
 * (viral > strong > baseline > weak) then perf_score, scoped to model +
 * platform. `features` carries title/caption/hashtags captured at label time.
 */
async function retrieveTopExemplars(
  orgId: string,
  modelId: string,
  platform: string,
  limit: number,
): Promise<ViralExemplar[]> {
  const labelOrder = ['viral', 'strong', 'baseline', 'weak'];

  // F-86 (L2.8 §8): opt-in org-level cross-model sharing. When the org enables
  // viral_sharing, generation may draw exemplars from ANY model in the same
  // org (tenant-isolated by RLS — never across orgs); otherwise strict
  // per-model scope.
  const sharing = await withOrgContext(orgId, (tx) =>
    tx
      .select({ viralSharing: schema.orgSettings.viralSharing })
      .from(schema.orgSettings)
      .where(eq(schema.orgSettings.orgId, orgId))
      .limit(1),
  );
  const shareAcrossModels = sharing[0]?.viralSharing ?? false;

  const rows = await withOrgContext(orgId, (tx) =>
    tx
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
      .limit(50),
  );

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
      (r: {
        id: string;
        platform: string;
        label: string;
        perfScore: number | null;
        features: unknown;
      }) => {
        const f = (r.features ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          platform: (r.platform as ViralExemplar['platform']) ?? 'instagram',
          title: (f.title as string) ?? '',
          caption: (f.caption as string) ?? '',
          hashtags: Array.isArray(f.hashtags) ? (f.hashtags as string[]) : [],
          viralLabel: (r.label as ViralExemplar['viralLabel']) ?? 'baseline',
          aiNotes: (f.aiNotes as string | null) ?? null,
        };
      },
    );
}

const generateSchema = z.object({
  style: z.string().min(1).max(100).default('studio'),
  outfit: z.string().min(1).max(100).default('summer dress'),
  location: z.string().min(1).max(100).default('studio'),
  mood: z.string().min(1).max(100).default('energetic'),
  lighting: z.string().min(1).max(100).default('soft studio'),
  aspectRatio: z.string().min(1).max(20).default('4:5'),
  platforms: z.array(z.string().min(1).max(30)).min(1).default(['instagram']),
  enrichWithLlm: z.boolean().default(false),
  model: z.string().max(100).optional(),
});

interface TextToSResult {
  verdict: 'pass' | 'review' | 'block';
  scores: Array<{
    platform: string;
    score: number;
    threshold: number;
    verdict: string;
    reasons: string[];
  }>;
  reasons: string[];
}

/** Text-only ToS check (caption keywords, length, hashtag count) per platform. */
function evaluateTextToS(caption: string, hashtags: string[], platforms: string[]): TextToSResult {
  const scores: TextToSResult['scores'] = [];
  const allReasons = new Set<string>();
  for (const platform of platforms) {
    const rule = PLATFORM_RULES[platform as keyof typeof PLATFORM_RULES];
    const threshold =
      DEFAULT_PLATFORM_THRESHOLDS[platform as keyof typeof DEFAULT_PLATFORM_THRESHOLDS] ?? 70;
    if (!rule) {
      scores.push({ platform, score: 0, threshold, verdict: 'pass', reasons: [] });
      continue;
    }
    const reasons: string[] = [];
    const captionLower = caption.toLowerCase();
    const blocked = rule.blockedKeywords.filter((kw) => captionLower.includes(kw.toLowerCase()));
    if (blocked.length > 0)
      reasons.push(`Caption contains blocked keywords: ${blocked.join(', ')}`);
    if (caption.length > rule.maxCaptionLength) {
      reasons.push(`Caption exceeds ${rule.maxCaptionLength} chars (${caption.length})`);
    }
    if (hashtags.length > rule.maxHashtags) {
      reasons.push(`Hashtags (${hashtags.length}) exceed limit (${rule.maxHashtags})`);
    }
    const score = blocked.length * 15;
    const verdict: string =
      score >= threshold + 15 ? 'block' : score >= threshold ? 'review' : 'pass';
    reasons.forEach((r) => allReasons.add(r));
    scores.push({ platform, score: Math.min(score, 100), threshold, verdict, reasons });
  }
  const hasBlock = scores.some((s) => s.verdict === 'block');
  const hasReview = scores.some((s) => s.verdict === 'review');
  return {
    verdict: hasBlock ? 'block' : hasReview ? 'review' : 'pass',
    scores,
    reasons: Array.from(allReasons),
  };
}

// POST /models/:id/generate
router.post('/models/:modelId/generate', zValidator('json', generateSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  // Keep generation targets aligned with the connector/worker contract. The
  // prompt and ToS paths use platform-specific rules, so accepting arbitrary
  // strings here would persist captions that no worker can publish.
  const platforms: PromptPlatform[] = [];
  const seenPlatforms = new Set<PromptPlatform>();
  for (const requestedPlatform of body.platforms) {
    let platform: PromptPlatform;
    try {
      platform = asPlatform(requestedPlatform);
    } catch {
      return apiError(
        c,
        400,
        statusTitle(400),
        `unsupported target platform '${requestedPlatform}'`,
      );
    }
    if (seenPlatforms.has(platform)) {
      return apiError(c, 400, statusTitle(400), `duplicate target platform '${platform}'`);
    }
    seenPlatforms.add(platform);
    platforms.push(platform);
  }

  const result = await withOrgContext(orgId, async (tx) => {
    // Verify model belongs to org
    const models = await tx
      .select()
      .from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId)))
      .limit(1);
    if (models.length === 0) return { status: 404 as const, data: null };
    const model = models[0];

    const promptPlatform = (platforms[0] ?? 'instagram') as PromptPlatform;
    const profile: PromptModelProfile = {
      id: model.id,
      displayName: model.displayName,
      handle: model.handle,
      avatarUrl: model.avatarUrl ?? null,
      bio: model.bio ?? null,
    };

    // 1. Master Prompt Engine — 5 variants (F-36)
    const variants = generatePhotoshootPrompts({
      modelName: model.displayName,
      style: body.style,
      outfit: body.outfit,
      location: body.location,
      mood: body.mood,
      lighting: body.lighting,
      aspectRatio: body.aspectRatio,
      platform: promptPlatform,
    });

    // 2. Optional LLM enrichment through the gateway (real provider call)
    let enrichedCaption: string | null = null;
    if (body.enrichWithLlm) {
      try {
        const gateway = new LLMGateway();
        // F-83 exemplar injection: retrieve the model's best-performing
        // exemplars from the DB-backed viral memory (L2.8) and feed them
        // into the S2 segment so generation is guided by what worked.
        const exemplars = await retrieveTopExemplars(orgId, modelId, promptPlatform, 3);
        const prompt = assemblePrompt({
          S0: buildS0(profile),
          S1: buildS1(promptPlatform),
          S2: buildS2(exemplars),
          S3: buildS3({
            modelId,
            task: 'Write an engaging caption for the photoshoot, max 200 chars.',
            platform: promptPlatform,
            context: variants[0].caption,
          }),
        });
        const chat = await gateway.chat(
          [
            { role: 'system', content: prompt },
            { role: 'user', content: variants[0].prompt },
          ],
          { model: body.model },
        );
        enrichedCaption = chat.content.trim();
      } catch (err) {
        // LLM enrichment is best-effort; the bundle still forms from the
        // prompt engine. Never fail generation because a provider is down.
        console.error('generate enrich failed:', (err as Error).message);
      }
    }

    // 3. ToS text evaluation per platform (LBI-11)
    const captions: Record<string, string> = {};
    const tosScores: Record<string, unknown>[] = [];
    const allReasons = new Set<string>();
    for (const platform of platforms) {
      const caption = enrichedCaption ?? variants[0].caption;
      captions[platform] = caption;
      const evalResult = evaluateTextToS(caption, variants[0].hashtags, [platform]);
      tosScores.push(...evalResult.scores);
      evalResult.reasons.forEach((r) => allReasons.add(r));
    }
    const tosReport = {
      verdict: tosScores.some((s) => s.verdict === 'block')
        ? 'block'
        : tosScores.some((s) => s.verdict === 'review')
          ? 'review'
          : 'pass',
      scores: tosScores,
      reasons: Array.from(allReasons),
    };

    // 4. Persist the bundle
    const [bundle] = await tx
      .insert(schema.contentBundle)
      .values({
        orgId,
        modelId,
        captions,
        hashtags: variants[0].hashtags,
        tosReport,
        state: 'generated',
      })
      .returning();
    await writeAudit(tx, orgId, userId, 'bundle.generate', bundle.id, {
      modelId,
      variantCount: variants.length,
      platforms,
      tosVerdict: tosReport.verdict,
    });

    // Canonical flow (L2.0): generate → ToS scan → relay card → operator.
    // Enqueue in the SAME transaction as the bundle (L3.4 §1).
    await enqueueJob(tx, {
      orgId,
      queue: 'tos',
      kind: 'tos.scan',
      payload: { bundleId: bundle.id },
      dedupeParts: ['tos.scan', bundle.id],
    });

    return {
      status: 201 as const,
      data: { bundle, variants, tosReport },
    };
  });

  if (result.status === 404) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: result.data }, 201);
});

export { router as generateRouter };
