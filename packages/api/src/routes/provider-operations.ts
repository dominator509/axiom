// Model-scoped operations beyond feed publishing: comment moderation/replies
// and provider messaging. Connector operations still use the model egress
// binding, and their advertised scope is checked again at execution time.
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { connectorForConnection, resolveProviderAssetUrl } from '@axiom/worker';
import type { SocialOperationInput } from '@axiom/connectors';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import type { AppBindings } from '../index.js';
import { apiError, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();
const identifier = z.string().trim().min(1).max(256);
const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('comments.read'), postId: identifier, cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ type: z.literal('comments.reply'), commentId: identifier, text: z.string().trim().min(1).max(10_000) }).strict(),
  z.object({ type: z.literal('comments.moderate'), commentId: identifier, action: z.enum(['hide', 'delete', 'approve', 'reject', 'block']) }).strict(),
  z.object({ type: z.literal('messages.read'), conversationId: identifier.optional(), cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ type: z.literal('messages.send'), recipientId: identifier, text: z.string().trim().min(1).max(10_000) }).strict(),
  z.object({ type: z.literal('youtube.playlists.read'), cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
  z.object({ type: z.literal('youtube.playlist.create'), title: z.string().trim().min(1).max(150), description: z.string().max(5_000).optional(), privacyStatus: z.enum(['private', 'public', 'unlisted']) }).strict(),
  z.object({ type: z.literal('youtube.playlist.add-video'), playlistId: identifier, videoId: identifier, position: z.number().int().min(0).max(50_000).optional() }).strict(),
  z.object({ type: z.literal('youtube.playlist.remove-video'), playlistItemId: identifier }).strict(),
  z.object({ type: z.literal('youtube.thumbnail.set'), videoId: identifier, assetId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('youtube.captions.list'), videoId: identifier }).strict(),
  z.object({ type: z.literal('youtube.captions.upload'), videoId: identifier, language: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/), name: z.string().trim().min(1).max(150), assetId: z.string().uuid(), isDraft: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('youtube.captions.delete'), captionId: identifier }).strict(),
  z.object({ type: z.literal('vault.folders.read'), page: z.number().int().min(1).optional(), size: z.number().int().min(1).max(50).optional(), mediaName: z.string().trim().max(255).optional() }).strict(),
  z.object({ type: z.literal('vault.folder.read'), folderName: z.string().trim().min(1).max(255) }).strict(),
  z.object({ type: z.literal('vault.folder.create'), name: z.string().trim().min(1).max(255) }).strict(),
  z.object({ type: z.literal('vault.folder.rename'), folderName: z.string().trim().min(1).max(255), name: z.string().trim().min(1).max(255) }).strict(),
  z.object({ type: z.literal('vault.folder.delete'), folderName: z.string().trim().min(1).max(255) }).strict(),
  z.object({
    type: z.literal('vault.media.read'),
    folderName: z.string().trim().min(1).max(255),
    page: z.number().int().min(1).optional(),
    size: z.number().int().min(1).max(50).optional(),
    mediaType: z.enum(['image', 'video', 'audio', 'document']).optional(),
    name: z.string().trim().max(255).optional(),
    startDate: z.string().max(64).optional(),
    endDate: z.string().max(64).optional(),
    variants: z.array(z.enum(['blurred', 'main', 'thumbnail', 'thumbnail_gallery'])).max(4).optional(),
  }).strict(),
  z.object({ type: z.literal('vault.media.add'), folderName: z.string().trim().min(1).max(255), mediaUuids: z.array(z.string().uuid()).min(1).max(100) }).strict(),
  z.object({ type: z.literal('vault.media.remove'), folderName: z.string().trim().min(1).max(255), mediaUuid: z.string().uuid() }).strict(),
  z.object({
    type: z.literal('vault.media.update'),
    folderName: z.string().trim().min(1).max(255),
    mediaUuid: z.string().uuid(),
    name: z.string().trim().min(1).max(255).nullable().optional(),
    recommendedPrice: z.number().int().min(0).nullable().optional(),
  }).strict(),
]).superRefine((value, context) => {
  if (value.type === 'vault.media.update' && value.name === undefined && value.recommendedPrice === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one media property must be provided' });
  }
});

router.post('/:modelId/social-accounts/:connectionId/operations', zValidator('json', operationSchema), async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId, connectionId } = c.req.param();
  const operation = c.req.valid('json');
  const rows = await withOrgContext(orgId, (tx) => tx.select().from(schema.platformConnection).where(and(
    eq(schema.platformConnection.id, connectionId),
    eq(schema.platformConnection.orgId, orgId),
    eq(schema.platformConnection.modelId, modelId),
    inArray(schema.platformConnection.status, ['connected', 'active']),
  )).limit(1));
  const connection = rows[0];
  if (!connection) return apiError(c, 404, statusTitle(404), 'connected account not found for this model');

  let result;
  try {
    const { connector } = await connectorForConnection(connection);
    const capability = connector.capability();
    if (!capability.operations?.includes(operation.type) || !connector.executeOperation) {
      return apiError(c, 403, statusTitle(403), `provider does not grant ${operation.type} for this connection`);
    }
    if (operation.type === 'comments.moderate' && !capability.moderationActions?.includes(operation.action)) {
      return apiError(c, 403, statusTitle(403), `provider does not grant comments.moderate.${operation.action} for this connection`);
    }
    let providerOperation: SocialOperationInput = operation as SocialOperationInput;
    if (operation.type === 'youtube.thumbnail.set' || operation.type === 'youtube.captions.upload') {
      const [asset] = await withOrgContext(orgId, (tx) => tx.select({
        id: schema.asset.id,
        storageKey: schema.asset.storageKey,
        mimeType: schema.asset.mimeType,
        fileSize: schema.asset.fileSize,
      }).from(schema.asset).where(and(
        eq(schema.asset.id, operation.assetId),
        eq(schema.asset.orgId, orgId),
        eq(schema.asset.modelId, modelId),
      )).limit(1));
      if (!asset) return apiError(c, 404, statusTitle(404), 'asset not found for this model');
      if (operation.type === 'youtube.thumbnail.set') {
        if (asset.mimeType !== 'image/jpeg' && asset.mimeType !== 'image/png') {
          return apiError(c, 400, statusTitle(400), 'YouTube thumbnails require a JPEG or PNG asset');
        }
        if (asset.fileSize < 1 || asset.fileSize > 2 * 1024 * 1024) {
          return apiError(c, 400, statusTitle(400), 'YouTube thumbnail asset must be between 1 byte and 2 MiB');
        }
      } else {
        if (!/^(text\/(plain|vtt|xml)|application\/(x-subrip|octet-stream))$/i.test(asset.mimeType)) {
          return apiError(c, 400, statusTitle(400), 'YouTube captions require a text, WebVTT, SRT, or XML asset');
        }
        if (asset.fileSize < 1 || asset.fileSize > 10 * 1024 * 1024) {
          return apiError(c, 400, statusTitle(400), 'YouTube caption asset must be between 1 byte and 10 MiB');
        }
      }
      const mediaUrl = resolveProviderAssetUrl(asset);
      if (operation.type === 'youtube.thumbnail.set') {
        providerOperation = { type: operation.type, videoId: operation.videoId, mediaUrl, mimeType: asset.mimeType as 'image/jpeg' | 'image/png' };
      } else {
        const { assetId: _assetId, ...captionOperation } = operation;
        providerOperation = { ...captionOperation, mediaUrl } as SocialOperationInput;
      }
    }
    result = await connector.executeOperation(providerOperation);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/required permission was not granted|scope|permission/i.test(message)) {
      return apiError(c, 403, statusTitle(403), 'provider operation is not authorized by the granted scopes');
    }
    if (/egress|decrypt|binding|AXIOM_ASSET_DELIVERY_BASE_URL|cannot be delivered/i.test(message)) {
      return apiError(c, 503, statusTitle(503), 'required provider configuration, asset delivery, egress, or credential service is unavailable');
    }
    return apiError(c, 502, statusTitle(502), 'provider operation failed');
  }

  const userId = c.get('userId') ?? 'system';
  await withOrgContext(orgId, (tx) => writeAudit(tx, orgId, userId, `social.operation.${operation.type}`, connectionId, {
    modelId,
    platform: connection.platform,
    operation: operation.type,
    ...(operation.type === 'comments.moderate' ? { moderationAction: operation.action } : {}),
    ...('assetId' in operation ? { assetId: operation.assetId } : {}),
    resultType: result.type,
    resultCount: 'items' in result ? result.items.length : undefined,
  }));
  return c.json({ data: result });
});

export { router as providerOperationsRouter };
