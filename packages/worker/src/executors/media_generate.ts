import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { OfficialSubscriptionTransport, characterLockSnapshot, buildMediaPrompt, type GrokMediaRequest } from '@axiom/llm-gateway';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { storeGeneratedAsset } from '../generated-asset-store.js';
import { sanitizeMedia } from '../media-sanitizer.js';
import { enqueueJob } from '../enqueue.js';
import { ParkJobError, type Executor } from './context.js';

/** A request is charged at most once automatically: the committed attempt
 * survives executor rollback and lease recovery. Uncertain outcomes stay held.
 */
export const mediaGenerate: Executor = async (ctx) => {
  const { tx, job } = ctx;
  if (ctx.killSwitchEnabled) throw new ParkJobError('Media generation paused by kill switch', 60_000);
  const payload = job.payload as {
    bundleId?: string; userId?: string; kind?: string; prompt?: string; provider?: string;
    sourceAssetId?: string; duration?: number; aspectRatio?: GrokMediaRequest['aspectRatio'];
    characterLockPrompt?: string; characterLockVersion?: number;
    sanitizeMetadata?: boolean;
  };
  if (!payload.bundleId || !payload.userId || !payload.prompt?.trim()
    || (payload.sanitizeMetadata !== undefined && typeof payload.sanitizeMetadata !== 'boolean')
    || (payload.provider !== undefined && payload.provider !== 'grok')
    || payload.prompt.length > 4000 || !['image', 'video'].includes(payload.kind ?? '')
    || (payload.kind === 'video' && (!payload.sourceAssetId || ![6, 10].includes(payload.duration ?? 6)))
    || (payload.kind === 'image' && !['auto', '1:1', '16:9', '9:16', '4:5', '3:2', '2:3'].includes(payload.aspectRatio ?? 'auto')))
    throw new Error('media.generate: invalid request');
  const effectivePrompt = buildMediaPrompt(payload.prompt, characterLockSnapshot(payload));
  const [actor] = await tx.select().from(schema.authUser).where(and(
    eq(schema.authUser.id, payload.userId), eq(schema.authUser.orgId, job.org_id),
  )).limit(1);
  if (!actor || !['owner', 'manager', 'operator'].includes(actor.role))
    throw new Error('media.generate: requesting operator no longer authorized');
  const [bundle] = await tx.select().from(schema.contentBundle).where(and(
    eq(schema.contentBundle.id, payload.bundleId), eq(schema.contentBundle.orgId, job.org_id),
  )).limit(1).for('update');
  if (!bundle || bundle.assetId || bundle.state !== 'generated')
    throw new Error('media.generate: bundle is not awaiting a media asset');
  if (!ctx.persistSideEffectMarker || !ctx.markExternalSideEffect)
    throw new Error('media.generate: durable dispatch boundary unavailable');
  const mediaRoot = resolve(process.env.AXIOM_MEDIA_ROOT ?? 'var/media');
  let image: Buffer | undefined;
  if (payload.kind === 'video') {
    const [source] = await tx.select().from(schema.asset).where(and(
      eq(schema.asset.id, payload.sourceAssetId!), eq(schema.asset.orgId, job.org_id),
      eq(schema.asset.modelId, bundle.modelId),
    )).limit(1);
    if (!source || source.kind !== 'image' || !['image/jpeg', 'image/png'].includes(source.mimeType)
      || source.fileSize < 12 || source.fileSize > 20 * 1024 * 1024)
      throw new Error('media.generate: invalid source asset');
    const root = await realpath(mediaRoot);
    const path = resolve(root, source.storageKey);
    const local = relative(root, path);
    if (!local || isAbsolute(local) || local.split(sep).includes('..') || await realpath(path) !== path)
      throw new Error('media.generate: source asset outside media root');
    const reader = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await reader.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size !== source.fileSize)
        throw new Error('media.generate: source asset changed');
      image = Buffer.alloc(source.fileSize);
      let offset = 0;
      while (offset < image.length) {
        const { bytesRead } = await reader.read(image, offset, image.length - offset, offset);
        if (!bytesRead) throw new Error('media.generate: truncated source asset');
        offset += bytesRead;
      }
      const after = await reader.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        throw new Error('media.generate: source asset changed during read');
      if (!Buffer.isBuffer(source.sha256) || !createHash('sha256').update(image).digest().equals(source.sha256))
        throw new Error('media.generate: source asset content hash mismatch');
    } finally { await reader.close(); }
    if (payload.sanitizeMetadata) image = (await sanitizeMedia(image!, source.mimeType as 'image/jpeg' | 'image/png')).bytes;
  }
  const artifact = await new OfficialSubscriptionTransport().generateMedia({
    kind: payload.kind as 'image' | 'video', userId: payload.userId, prompt: effectivePrompt,
    ...(payload.kind === 'image' ? { aspectRatio: payload.aspectRatio ?? 'auto' } : {}),
    ...(image ? { image, duration: (payload.duration ?? 6) as 6 | 10 } : {}),
  }, async () => {
    const [attempt] = await ctx.persistSideEffectMarker!<Array<{ jobId: string }>>(markerTx =>
      markerTx.insert(schema.mediaGenerationAttempt).values({
        jobId: job.id, orgId: job.org_id, bundleId: bundle.id, modelId: bundle.modelId,
        userId: payload.userId!, kind: payload.kind!,
      }).onConflictDoNothing().returning({ jobId: schema.mediaGenerationAttempt.jobId }),
    );
    ctx.markExternalSideEffect!();
    if (!attempt) throw new Error('media.generate: existing dispatch requires provider reconciliation');
  });
  const stored = await storeGeneratedAsset(artifact, {
    orgId: job.org_id, modelId: bundle.modelId, requestRoot: dirname(artifact.path), mediaRoot,
    sanitizeMetadata: payload.sanitizeMetadata === true,
  });
  const [inserted] = await tx.insert(schema.asset).values({
    orgId: job.org_id, modelId: bundle.modelId, kind: payload.kind,
    ...stored,
  }).onConflictDoNothing().returning({ id: schema.asset.id });
  const existing = inserted ? [] : await tx.select().from(schema.asset).where(and(
    eq(schema.asset.orgId, job.org_id), eq(schema.asset.sha256, stored.sha256),
    eq(schema.asset.modelId, bundle.modelId),
  )).limit(1);
  const assetId = inserted?.id ?? existing[0]?.id;
  if (!assetId) throw new Error('media.generate: asset content is already assigned to another model');
  await tx.update(schema.contentBundle).set({ assetId, tosReport: { verdict: 'pending' }, updatedAt: new Date() })
    .where(and(eq(schema.contentBundle.id, bundle.id), eq(schema.contentBundle.orgId, job.org_id)));
  await tx.update(schema.mediaGenerationAttempt).set({ state: 'completed', assetId, completedAt: new Date() })
    .where(and(eq(schema.mediaGenerationAttempt.jobId, job.id), eq(schema.mediaGenerationAttempt.orgId, job.org_id)));
  await enqueueJob(tx, { orgId: job.org_id, queue: 'tos', kind: 'tos.scan',
    payload: { bundleId: bundle.id }, dedupeParts: ['tos.scan', bundle.id, assetId] });
};
