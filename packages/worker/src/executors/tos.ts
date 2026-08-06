// ─── tos.scan executor (L3.4 §2, L2.10) ───
// Local ToS evaluation of a bundle per platform (text rules from fanvue-mcp;
// the Rust plane adds local vision on media). Writes the tos_report verdict
// so the relay card carries pass/review/block (L3.3 §1, LBI-11).

import { eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { PLATFORM_RULES, DEFAULT_PLATFORM_THRESHOLDS } from '@axiom/fanvue-mcp';
import type { Executor, ExecutorContext } from './context.js';

export function evaluateTextToS(
  caption: string,
  hashtags: string[],
  platforms: string[],
): { verdict: 'pass' | 'review' | 'block'; scores: Array<{ platform: string; score: number; threshold: number; verdict: string; reasons: string[] }>; reasons: string[] } {
  const scores: Array<{ platform: string; score: number; threshold: number; verdict: string; reasons: string[] }> = [];
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
    if (caption.length > rule.maxCaptionLength) reasons.push(`Caption exceeds ${rule.maxCaptionLength} chars (${caption.length})`);
    if (hashtags.length > rule.maxHashtags) reasons.push(`Hashtags (${hashtags.length}) exceed limit (${rule.maxHashtags})`);
    let score = blocked.length * 15;
    const verdict = score >= threshold + 15 ? 'block' : score >= threshold ? 'review' : 'pass';
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

export const tosScan: Executor = async (ctx: ExecutorContext) => {
  const { tx } = ctx;
  const payload = (ctx.job.payload ?? {}) as { bundleId?: string };
  const bundleId = payload.bundleId;
  if (!bundleId) throw new Error('tos.scan: payload.bundleId required');

  const bundles = await tx
    .select()
    .from(schema.contentBundle)
    .where(eq(schema.contentBundle.id, bundleId))
    .limit(1);
  if (bundles.length === 0) throw new Error(`tos.scan: bundle ${bundleId} not found`);
  const bundle = bundles[0];

  const captions = (bundle.captions as Record<string, string> | null) ?? {};
  const hashtags = (bundle.hashtags as string[] | null) ?? [];
  const platforms = Object.keys(captions).length > 0 ? Object.keys(captions) : ['instagram'];
  const report = evaluateTextToS(captions[platforms[0]] ?? '', hashtags, platforms);

  await tx
    .update(schema.contentBundle)
    .set({ tosReport: report, updatedAt: new Date() })
    .where(eq(schema.contentBundle.id, bundleId));

  // A pass/review verdict flows to the relay card (produced by relay.card).
  await tx
    .insert(schema.job)
    .values({
      orgId: ctx.job.org_id,
      queue: 'relay',
      kind: 'relay.card',
      payload: { bundleId },
      state: 'ready',
      runAfter: new Date(),
    })
    .onConflictDoNothing();
};
