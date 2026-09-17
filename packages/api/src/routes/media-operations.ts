// ─── Media transform orchestration (F-14/F-29) ─────────────────────────────
// The dashboard queues bounded work for the authenticated media plane. A
// completed transform is an asset variant, not an approved or publishable post.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { enqueueJob } from '@axiom/worker';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import type { Context } from 'hono';
import { withOrgContext, requireOrg, apiError, statusTitle, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();
const options = {
  image_clip: z.object({ type: z.literal('image_clip'), x: z.number().int().min(0).max(100_000), y: z.number().int().min(0).max(100_000), width: z.number().int().min(1).max(20_000), height: z.number().int().min(1).max(20_000) }).strict(),
  image_resize: z.object({ type: z.literal('image_resize'), width: z.number().int().min(1).max(20_000), height: z.number().int().min(1).max(20_000) }).strict(),
  video_clip: z.object({ type: z.literal('video_clip'), start: z.number().finite().min(0).max(86_400), duration: z.number().finite().positive().max(3_600) }).strict(),
  video_transcode: z.object({ type: z.literal('video_transcode'), targetFormat: z.enum(['mp4', 'webm']), scale: z.string().regex(/^\d{2,5}:\d{2,5}$/).optional() }).strict(),
} as const;
const createSchema = z.discriminatedUnion('type', [
  options.image_clip,
  options.image_resize,
  options.video_clip,
  options.video_transcode,
]);

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 64 * 1024); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; return {}; }
}

router.get('/models/:modelId/media-operations', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const rows = await withOrgContext(orgId, (tx) => tx.select().from(schema.mediaOperation)
    .where(and(eq(schema.mediaOperation.orgId, orgId), eq(schema.mediaOperation.modelId, c.req.param('modelId'))))
    .orderBy(desc(schema.mediaOperation.createdAt)).limit(100));
  return c.json({ data: rows });
});

router.post('/models/:modelId/media-operations', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'media operation body too large'); payload = {}; }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid media operation');
  const modelId = c.req.param('modelId');
  const assetId = c.req.query('assetId');
  if (!assetId || !z.string().uuid().safeParse(assetId).success) return apiError(c, 400, statusTitle(400), 'assetId is required');
  const saved = await withOrgContext(orgId, async (tx) => {
    const [asset] = await tx.select({ id: schema.asset.id, kind: schema.asset.kind, modelId: schema.asset.modelId }).from(schema.asset).where(and(eq(schema.asset.id, assetId), eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, modelId))).limit(1);
    if (!asset) return { status: 404 as const, error: 'asset not found' };
    const expectedKind = parsed.data.type.startsWith('video') ? 'video' : 'image';
    if (asset.kind !== expectedKind) return { status: 409 as const, error: `${parsed.data.type} requires a ${expectedKind} asset` };
    const [operation] = await tx.insert(schema.mediaOperation).values({ orgId, modelId, sourceAssetId: asset.id, type: parsed.data.type, options: parsed.data }).returning();
    if (!operation) return { status: 500 as const, error: 'media operation could not be saved' };
    await enqueueJob(tx, { orgId, queue: 'media', kind: 'media.transform', payload: { operationId: operation.id }, runAfter: new Date(), dedupeParts: ['media.transform', operation.id] });
    await writeAudit(tx, orgId, c.get('userId') ?? 'system', 'media.operation.create', operation.id, { modelId, assetId, type: operation.type });
    return { status: 202 as const, data: operation };
  });
  if (saved.status !== 202) return apiError(c, saved.status, statusTitle(saved.status), saved.error);
  return c.json({ data: saved.data }, 202);
});

export { router as mediaOperationsRouter };
