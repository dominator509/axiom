import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { Executor } from './context.js';

function mediaOrigin(): string { return (process.env.MEDIA_PLANE_URL ?? 'http://127.0.0.1:8100').replace(/\/$/, ''); }

export const mediaTransform: Executor = async ({ tx, job }) => {
  const operationId = typeof job.payload?.operationId === 'string' ? job.payload.operationId : '';
  if (!operationId) throw new Error('media.transform: payload.operationId required');
  const [operation] = await tx.select().from(schema.mediaOperation).where(and(eq(schema.mediaOperation.id, operationId), eq(schema.mediaOperation.orgId, job.org_id))).limit(1);
  if (!operation) throw new Error(`media.transform: operation ${operationId} not found`);
  if (operation.state === 'completed') return;
  const [source] = await tx.select().from(schema.asset).where(and(eq(schema.asset.id, operation.sourceAssetId), eq(schema.asset.orgId, job.org_id), eq(schema.asset.modelId, operation.modelId))).limit(1);
  if (!source) throw new Error('media.transform: source asset not found');
  await tx.update(schema.mediaOperation).set({ state: 'running', error: null }).where(eq(schema.mediaOperation.id, operation.id));
  const token = process.env.MEDIA_PLANE_AUTH_TOKEN?.trim();
  if (!token) throw new Error('media.transform: MEDIA_PLANE_AUTH_TOKEN is not configured');
  const outputKey = `operations/${operation.id}.${operation.type.endsWith('transcode') ? (operation.options.targetFormat === 'webm' ? 'webm' : 'mp4') : source.kind === 'video' ? 'mp4' : 'jpg'}`;
  const options = operation.options;
  const path = operation.type === 'image_clip' ? '/media/clip' : operation.type === 'image_resize' ? '/media/resize' : operation.type === 'video_clip' ? '/media/video/clip' : '/media/video/transcode';
  const body = operation.type === 'image_clip'
    ? { image_path: source.storageKey, x: options.x, y: options.y, width: options.width, height: options.height, output_path: outputKey }
    : operation.type === 'image_resize'
      ? { image_path: source.storageKey, width: options.width, height: options.height, output_path: outputKey }
      : operation.type === 'video_clip'
        ? { video_path: source.storageKey, start: String(options.start), duration: String(options.duration), output_path: outputKey }
        : { input_path: source.storageKey, target_format: options.targetFormat, scale: options.scale, output_path: outputKey };
  try {
    const response = await fetch(`${mediaOrigin()}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`media plane returned HTTP ${response.status}`);
    const [variant] = await tx.insert(schema.assetVariant).values({ orgId: job.org_id, assetId: source.id, variantType: operation.type, storageKey: outputKey, width: typeof options.width === 'number' ? options.width : source.width, height: typeof options.height === 'number' ? options.height : source.height, settings: options }).returning();
    if (!variant) throw new Error('media.transform: result variant could not be saved');
    await tx.update(schema.mediaOperation).set({ state: 'completed', resultVariantId: variant.id, completedAt: new Date(), error: null }).where(eq(schema.mediaOperation.id, operation.id));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'media transform failed';
    await tx.update(schema.mediaOperation).set({ state: 'failed', error: message, completedAt: new Date() }).where(eq(schema.mediaOperation.id, operation.id));
    throw error;
  }
};
