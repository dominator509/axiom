// ─── Generation pipeline (F-36, L3.0) — TOKENKILLER + LLM + ToS → bundle ───
// POST /models/:id/generate — runs the Master Prompt Engine
// (generatePhotoshootPrompts, TOKENKILLER S0-S3), optionally enriches via the
// LLM gateway, evaluates text ToS rules per platform (LBI-11), and persists a
// content_bundle. The operator then approves/revises/rejects via Relay or the
// dashboard approvals tab.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { withOrgContext, requireOrg, writeAudit } from './helpers.js';
import {
  generatePhotoshootPrompts,
  buildS0,
  buildS1,
  buildS3,
  assemblePrompt,
  type ModelProfile as PromptModelProfile,
} from '@axiom/llm-gateway';
import { LLMGateway } from '@axiom/llm-gateway';
import { PLATFORM_RULES, DEFAULT_PLATFORM_THRESHOLDS } from '@axiom/fanvue-mcp';

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
  scores: Array<{ platform: string; score: number; threshold: number; verdict: string; reasons: string[] }>;
  reasons: string[];
}

/** Text-only ToS check (caption keywords, length, hashtag count) per platform. */
function evaluateTextToS(
  caption: string,
  hashtags: string[],
  platforms: string[],
): TextToSResult {
  const scores: TextToSResult['scores'] = [];
  const allReasons = new Set<string>();
  for (const platform of platforms) {
    const rule = PLATFORM_RULES[platform as keyof typeof PLATFORM_RULES];
    const threshold = DEFAULT_PLATFORM_THRESHOLDS[platform as keyof typeof DEFAULT_PLATFORM_THRESHOLDS] ?? 70;
    if (!rule) {
      scores.push({ platform, score: 0, threshold, verdict: 'pass', reasons: [] });
      continue;
    }
    const reasons: string[] = [];
    const captionLower = caption.toLowerCase();
    const blocked = rule.blockedKeywords.filter((kw) => captionLower.includes(kw.toLowerCase()));
    if (blocked.length > 0) reasons.push(`Caption contains blocked keywords: ${blocked.join(', ')}`);
    if (caption.length > rule.maxCaptionLength) {
      reasons.push(`Caption exceeds ${rule.maxCaptionLength} chars (${caption.length})`);
    }
    if (hashtags.length > rule.maxHashtags) {
      reasons.push(`Hashtags (${hashtags.length}) exceed limit (${rule.maxHashtags})`);
    }
    let score = blocked.length * 15;
    const verdict: string = score >= threshold + 15 ? 'block' : score >= threshold ? 'review' : 'pass';
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
  if (!orgId) return c.json({ error: { message: 'orgId required' } }, 401);
  const { modelId } = c.req.param();
  const body = c.req.valid('json');
  const userId = c.get('userId') ?? 'system';

  const result = await withOrgContext(orgId, async (tx) => {
    // Verify model belongs to org
    const models = await tx
      .select()
      .from(schema.modelProfile)
      .where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId)))
      .limit(1);
    if (models.length === 0) return { status: 404 as const, data: null };
    const model = models[0];

    const platforms = body.platforms;
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
        const prompt = assemblePrompt({
          S0: buildS0(profile),
          S1: buildS1(promptPlatform),
          S2: '',
          S3: buildS3({
            modelId,
            task: 'Write an engaging caption for the photoshoot, max 200 chars.',
            platform: promptPlatform,
            context: variants[0].caption,
          }),
        });
        const chat = await gateway.chat(
          [{ role: 'system', content: prompt }, { role: 'user', content: variants[0].prompt }],
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

    return {
      status: 201 as const,
      data: { bundle, variants, tosReport },
    };
  });

  if (result.status === 404) return c.json({ error: { message: 'model not found' } }, 404);
  return c.json({ data: result.data }, 201);
});

export { router as generateRouter };
