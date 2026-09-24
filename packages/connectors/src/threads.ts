// ─── Threads Connector ───
// Uses the Threads Publishing API (Meta Graph API v1.0) for publishing,
// metrics, and auth management.

import {
  BaseConnector,
  CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
  readResponseJson,
  readResponseText,
  redactProviderText,
} from './base.js';
import type {
  SocialConnector,
  ConnectorAuth,
  ConnectorPublishInput,
  ConnectorPublishResult,
  ConnectorCapability,
  ConnectorMetrics,
  MetricPeriod,
  ValidationReport,
  MediaType,
  SocialOperationInput,
  SocialOperationResult,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { mediaTypeHint, validatePublish } from './validation.js';

const THREADS_GRAPH_BASE = 'https://graph.threads.net/v1.0';
const CONTAINER_POLL_INTERVAL_MS = 60_000;
const CONTAINER_POLL_ATTEMPTS = 5;

interface ThreadsMediaContainerResponse {
  id: string;
}

interface ThreadsContainerStatusResponse {
  id: string;
  status?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  error_message?: string;
}

interface ThreadsPublishResponse {
  id: string;
}

interface ThreadsInsightsResponse {
  data: Array<{
    name: string;
    period: string;
    values?: Array<{ value: number }>;
    total_value?: { value: number };
  }>;
}

interface ThreadsPermissionsResponse {
  success: boolean;
}

interface ThreadsRepliesResponse {
  data?: Array<{ id?: string; text?: string; username?: string; timestamp?: string; permalink?: string }>;
  paging?: { cursors?: { after?: string } };
}

export class ThreadsConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('threads' as Platform, 'Threads', 'api' as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    const canPublish = this.hasGrantedScope('threads_content_publish');
    const canReadMetrics = this.hasGrantedScope('threads_manage_insights');
    const canReadReplies = this.hasGrantedScope('threads_read_replies');
    const canManageReplies = this.hasGrantedScope('threads_manage_replies');
    return {
      publish: canPublish,
      media: canPublish ? ['image' as MediaType, 'video' as MediaType, 'carousel' as MediaType] : [],
      maxMediaBytes: 104_857_600, // 100 MB
      maxMediaCount: 20,
      caption: true,
      maxCaptionLength: 500,
      // The worker owns the scheduled slot; Threads containers are created
      // and published immediately when the job runs.
      scheduling: 'internal' as const,
      metrics: canReadMetrics ? ['impressions', 'likes', 'comments', 'shares', 'reposts', 'quotes'] : [],
      refreshMetrics: canReadMetrics,
      operations: [
        ...(canReadReplies ? ['comments.read' as const] : []),
        ...(canPublish && canManageReplies ? ['comments.reply' as const] : []),
        ...(canManageReplies ? ['comments.moderate' as const] : []),
      ],
      moderationActions: canManageReplies ? ['hide', 'approve', 'reject'] : [],
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      this.assertGrantedScope('publishing', 'threads_content_publish');
      const threadsUserId = this.auth.externalUserId;
      if (!threadsUserId) {
        throw new Error('Threads externalUserId (Threads User ID) is required');
      }

      const accessToken = this.auth.accessToken;

      // Step 1: Create one child container per URL. Threads requires
      // image_url/video_url (not the generic media_url) for media posts.
      const creationIds: string[] = [];

      for (const mediaUrl of input.mediaUrls) {
        const mediaType = this.detectMediaType(mediaUrl, mediaTypeHint(input));

        const params: Record<string, string> = {
          media_type: mediaType === 'video' ? 'VIDEO' : 'IMAGE',
          ...(mediaType === 'video' ? { video_url: mediaUrl } : { image_url: mediaUrl }),
          access_token: accessToken,
          // Threads calls the caption `text` on a single media container.
          // Carousel captions belong to the parent container below.
          ...(input.mediaUrls.length === 1 && input.caption ? { text: input.caption } : {}),
        };
        if (input.mediaUrls.length > 1) params.is_carousel_item = 'true';

        const createResp = await this.apiPost<ThreadsMediaContainerResponse>(
          graphUrl(`${THREADS_GRAPH_BASE}/${threadsUserId}/threads`, params),
        );

        creationIds.push(createResp.id);
        await this.waitForContainerReady(createResp.id);
        this.log('info', 'publish', `Created Threads media container ${createResp.id}`, {
          mediaUrl,
          mediaType,
        });
      }

      const publishCreationId =
        creationIds.length > 1
          ? (
              await this.apiPost<ThreadsMediaContainerResponse>(
                graphUrl(`${THREADS_GRAPH_BASE}/${threadsUserId}/threads`, {
                  media_type: 'CAROUSEL',
                  text: input.caption,
                  children: creationIds.join(','),
                  access_token: accessToken,
                }),
              )
            ).id
          : creationIds[0];

      if (!publishCreationId) throw new Error('Threads did not return a publish container ID');
      if (creationIds.length > 1) await this.waitForContainerReady(publishCreationId);

      // Step 2: Publish the single container (or carousel parent).
      const publishResp = await this.apiPost<ThreadsPublishResponse>(
        graphUrl(`${THREADS_GRAPH_BASE}/${threadsUserId}/threads_publish`, {
          creation_id: publishCreationId,
          access_token: accessToken,
        }),
      );
      const lastRemoteId = publishResp.id;

      const postUrl = lastRemoteId
        ? `https://www.threads.net/@${this.auth.extra?.username ?? 'user'}/post/${lastRemoteId}`
        : undefined;

      return {
        remoteId: lastRemoteId,
        state: 'published',
        postUrl,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    this.assertGrantedScope('metrics', 'threads_manage_insights');
    const threadsUserId = this.auth.externalUserId;
    if (!threadsUserId) {
      throw new Error('Threads externalUserId is required for metrics');
    }

    const accessToken = this.auth.accessToken;

    const metricsUrl =
      `${THREADS_GRAPH_BASE}/${remoteId}/insights` +
      '?metric=views,likes,replies,reposts,quotes,shares';

    const resp = await this.fetchImpl(metricsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const body = await readResponseText(
        resp,
        CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
        'provider error response',
      ).catch(() => '');
      throw new Error(
        `Threads metrics fetch failed: HTTP ${resp.status} — ${redactProviderText(body)}`,
      );
    }

    const data = await readResponseJson<ThreadsInsightsResponse>(resp);

    const result: Partial<Record<string, number>> = {};

    for (const item of data.data) {
      // Threads returns time-series metrics in values[], but engagement
      // metrics such as likes/replies/reposts/quotes may be returned as a
      // lifetime aggregate in total_value.value. Preserve either documented
      // response shape instead of silently normalizing the latter to zero.
      const value = item.total_value?.value ?? item.values?.[0]?.value;
      if (typeof value === 'number') {
        result[item.name] = value;
      }
    }

    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        impressions: result['impressions'] ?? result['views'] ?? 0,
        likes: result['likes'] ?? 0,
        comments: result['comments'] ?? result['replies'] ?? 0,
        shares: result['shares'] ?? 0,
        reposts: result['reposts'] ?? 0,
        quotes: result['quotes'] ?? 0,
      },
      raw: data as unknown as Record<string, unknown>,
    };
  }

  async executeOperation(operation: SocialOperationInput): Promise<SocialOperationResult> {
    if (!this.capability().operations?.includes(operation.type)) {
      throw new Error(`Threads ${operation.type} is unavailable: required permission was not granted`);
    }
    const base = THREADS_GRAPH_BASE;
    if (operation.type === 'comments.read') {
      this.assertGrantedScope('reply reads', 'threads_read_replies');
      const url = new URL(`${base}/${encodeURIComponent(operation.postId)}/replies`);
      url.searchParams.set('fields', 'id,text,username,timestamp,permalink');
      url.searchParams.set('limit', String(operation.limit ?? 50));
      if (operation.cursor) url.searchParams.set('after', operation.cursor);
      const response = await this.apiGet<ThreadsRepliesResponse>(url.toString());
      return {
        type: 'comments',
        items: (response.data ?? []).flatMap(reply => typeof reply.id === 'string' ? [{
          id: reply.id,
          postId: operation.postId,
          text: reply.text ?? '',
          ...(reply.username ? { authorName: reply.username } : {}),
          ...(reply.timestamp ? { createdAt: reply.timestamp } : {}),
          ...(reply.permalink ? { permalink: reply.permalink } : {}),
        }] : []),
        ...(response.paging?.cursors?.after ? { nextCursor: response.paging.cursors.after } : {}),
      };
    }
    if (operation.type === 'comments.reply') {
      this.assertGrantedScope('reply publishing', 'threads_content_publish', 'threads_manage_replies');
      const replyText = operation.text.trim();
      if (!replyText || replyText.length > 500) throw new Error('Threads replies must contain 1–500 characters');
      const createUrl = graphUrl(`${base}/me/threads`, {
        media_type: 'TEXT',
        text: replyText,
        reply_to_id: operation.commentId,
      });
      const container = await this.apiPost<ThreadsMediaContainerResponse>(createUrl);
      if (!container.id) throw new Error('Threads did not return a reply container ID');
      const published = await this.apiPost<ThreadsPublishResponse>(graphUrl(`${base}/me/threads_publish`, {
        creation_id: container.id,
      }));
      if (!published.id) throw new Error('Threads did not confirm the published reply');
      return { type: 'mutation', success: true, remoteId: published.id };
    }
    if (operation.type === 'comments.moderate') {
      this.assertGrantedScope('reply moderation', 'threads_manage_replies');
      if (operation.action === 'hide') {
        await this.apiPost(`${base}/${encodeURIComponent(operation.commentId)}/manage_reply?hide=true`);
      } else if (operation.action === 'approve' || operation.action === 'reject') {
        await this.apiPost(`${base}/${encodeURIComponent(operation.commentId)}/manage_pending_reply?approve=${operation.action === 'approve'}`);
      } else {
        throw new Error(`Threads does not support reply moderation action '${operation.action}'`);
      }
      return { type: 'mutation', success: true, remoteId: operation.commentId };
    }
    throw new Error(`Threads does not support ${operation.type}`);
  }

  async revoke(): Promise<void> {
    const threadsUserId = this.auth.externalUserId;
    if (!threadsUserId) {
      throw new Error('Threads revoke requires externalUserId (Threads User ID)');
    }

    await this.apiDelete<ThreadsPermissionsResponse>(
      `${THREADS_GRAPH_BASE}/${threadsUserId}/permissions`,
    );

    this.log('info', 'revoke', `Revoked Threads permissions for user ${threadsUserId}`);
  }

  /** Detect media type from URL extension */
  private detectMediaType(url: string, declared?: MediaType): 'image' | 'video' {
    if (declared === 'video') return 'video';
    if (declared === 'image') return 'image';

    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
      const videoExts = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']);
      return videoExts.has(ext) ? 'video' : 'image';
    } catch {
      return 'image';
    }
  }

  /**
   * Threads media uploads are asynchronous. Publishing a container before
   * Meta reports FINISHED is rejected for media and can strand a carousel.
   * Meta recommends polling no more than once per minute for up to five
   * minutes, so keep that provider contract explicit here.
   */
  private async waitForContainerReady(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt++) {
      const status = await this.apiGet<ThreadsContainerStatusResponse>(
        `${THREADS_GRAPH_BASE}/${containerId}?fields=status`,
      );

      if (status.status === 'FINISHED' || status.status === 'PUBLISHED') return;

      if (status.status === 'ERROR' || status.status === 'EXPIRED') {
        throw new Error(
          `Threads container ${containerId} processing ${status.status.toLowerCase()}: ${redactProviderText(status.error_message ?? 'unknown provider error')}`,
        );
      }

      if (attempt < CONTAINER_POLL_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
      }
    }

    throw new Error(`Threads container ${containerId} processing timed out`);
  }
}

function graphUrl(endpoint: string, params: Record<string, string>): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export default ThreadsConnector;
