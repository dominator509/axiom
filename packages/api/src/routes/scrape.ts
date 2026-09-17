// ─── Scraper orchestration (F-17/F-18) ────────────────────────────────────
// The Rust sidecar performs the network fetch. This route only validates and
// durably queues a tenant-scoped request; it never reports success early.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { asPlatform, enqueueJob } from '@axiom/worker';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import type { Context } from 'hono';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();
const socialSchema = z.object({ kind: z.literal('social'), platform: z.string().trim().min(1).max(50), profileUrl: z.string().url().max(2_000) }).strict();
const competitorSchema = z.object({ kind: z.literal('competitor'), brandName: z.string().trim().min(1).max(200), industry: z.string().trim().min(1).max(200), platforms: z.array(z.string().trim().min(1).max(50)).min(1).max(10) }).strict();
const createSchema = z.discriminatedUnion('kind', [socialSchema, competitorSchema]);

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 64 * 1024); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; return {}; }
}

function publicUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '::1';
  } catch { return false; }
}

function supportedPlatform(value: string): boolean {
  try { asPlatform(value); return true; } catch { return false; }
}

router.get('/models/:modelId/scrape-runs', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const rows = await withOrgContext(orgId, (tx) => tx.select().from(schema.scrapeRun)
    .where(and(eq(schema.scrapeRun.orgId, orgId), eq(schema.scrapeRun.modelId, c.req.param('modelId'))))
    .orderBy(desc(schema.scrapeRun.createdAt)).limit(50));
  return c.json({ data: rows });
});

router.post('/models/:modelId/scrape-runs', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'scrape request too large'); payload = {}; }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid scrape request');
  if (parsed.data.kind === 'social' && (!publicUrl(parsed.data.profileUrl) || !supportedPlatform(parsed.data.platform))) return apiError(c, 400, statusTitle(400), 'social scrape requires an HTTPS public profile URL and supported platform');
  if (parsed.data.kind === 'competitor' && parsed.data.platforms.some(platform => !supportedPlatform(platform))) return apiError(c, 400, statusTitle(400), 'competitor scrape contains an unsupported platform');
  const modelId = c.req.param('modelId');
  const saved = await withOrgContext(orgId, async (tx) => {
    const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1);
    if (!model) return null;
    const [run] = await tx.insert(schema.scrapeRun).values({ orgId, modelId, kind: parsed.data.kind, request: parsed.data }).returning();
    if (!run) return null;
    await enqueueJob(tx, { orgId, queue: 'scrape', kind: 'scrape.run', payload: { runId: run.id, modelId }, runAfter: new Date(), dedupeParts: ['scrape.run', run.id] });
    await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'scrape.run.create', run.id, { modelId, kind: run.kind });
    return run;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: saved }, 202);
});

export { router as scrapeRouter };
