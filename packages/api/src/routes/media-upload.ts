import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { schema } from '@axiom/db';
import { storeGeneratedAsset } from '@axiom/worker';
import type { AppBindings } from '../index.js';
import { apiError, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

export const mediaUploadRouter = new Hono<AppBindings>();
mediaUploadRouter.post('/models/:modelId/media-upload', async c => {
  const orgId = requireOrg(c), userId = c.get('userId'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'Authenticated operator required');
  if (!z.string().uuid().safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'Invalid model');
  const mimeType = c.req.header('content-type');
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'video/mp4')
    return apiError(c, 415, 'Unsupported Media Type', 'Upload JPEG, PNG or MP4');
  const selection = c.req.query('sanitize');
  if (selection !== 'true' && selection !== 'false') return apiError(c, 400, statusTitle(400), 'Choose whether to sanitize');
  const exists = await withOrgContext(orgId, async tx => (await tx.select({ id: schema.modelProfile.id })
    .from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1))[0]);
  if (!exists) return apiError(c, 404, statusTitle(404), 'Model not found');
  // The assembled app's idempotency middleware bounds and caches raw bytes.
  // Refuse an unprotected mount rather than reading an unbounded upload.
  if (!c.req.bodyCache.arrayBuffer) return apiError(c, 503, statusTitle(503), 'Upload boundary unavailable');
  const bytes = Buffer.from(await c.req.arrayBuffer());
  const max = (mimeType === 'video/mp4' ? 64 : 20) * 1024 * 1024;
  if (bytes.length < 12 || bytes.length > max) return apiError(c, 413, 'Payload Too Large', 'Invalid upload size');
  const directory = await mkdtemp(join(tmpdir(), 'axiom-upload-'));
  const mediaRoot = resolve(process.env.AXIOM_MEDIA_ROOT ?? 'var/media');
  let storedPath: string | undefined;
  let persistenceAttempted = false;
  try {
    const source = join(directory, 'input');
    await writeFile(source, bytes, { flag: 'wx', mode: 0o600 });
    const stored = await storeGeneratedAsset({ path: source, byteLength: bytes.length, mimeType }, {
      orgId, modelId, requestRoot: directory, mediaRoot, sanitizeMetadata: selection === 'true',
    });
    storedPath = join(mediaRoot, stored.storageKey);
    persistenceAttempted = true;
    const result = await withOrgContext(orgId, async tx => {
      const [inserted] = await tx.insert(schema.asset).values({ orgId, modelId,
        kind: mimeType === 'video/mp4' ? 'video' : 'image', ...stored,
      }).onConflictDoNothing().returning({ id: schema.asset.id });
      const asset = inserted ?? (await tx.select({ id: schema.asset.id }).from(schema.asset).where(and(
        eq(schema.asset.orgId, orgId), eq(schema.asset.modelId, modelId), eq(schema.asset.sha256, stored.sha256),
      )).limit(1))[0];
      if (!asset) throw new Error('Content belongs to another model');
      await writeAudit(tx, orgId, userId, 'asset.upload', asset.id, {
        sanitizeMetadata: selection === 'true', mimeType: stored.mimeType, fileSize: stored.fileSize,
      });
      return { id: asset.id as string, inserted: !!inserted };
    });
    if (!result.inserted) await unlink(storedPath).catch(() => {});
    storedPath = undefined;
    return c.json({ data: { id: result.id, mimeType: stored.mimeType, sanitized: selection === 'true', tosStatus: 'not-scanned' } }, 201);
  } catch {
    // A selected cleaning error never falls back to storing the original.
    if (persistenceAttempted) return apiError(c, 503, statusTitle(503), 'Upload persistence is unconfirmed. Reconcile this request before uploading again.');
    return apiError(c, 422, statusTitle(422), 'Upload could not be completed. Selected sanitization must succeed; no fallback to original media.',
      { code: 'ASSET_UPLOAD_NOT_STORED' });
  } finally {
    // A lost COMMIT acknowledgement can mean the DB row exists. Never delete
    // its file on an ambiguous persistence outcome; retain for reconciliation.
    if (storedPath && !persistenceAttempted) await unlink(storedPath).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
