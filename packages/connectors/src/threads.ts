// ─── Threads Connector ───
// Uses the Threads Publishing API (Meta Graph API v1.0) for publishing,
// metrics, and auth management.

import { BaseConnector } from './base.js';
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
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { validatePublish } from './validation.js';

const THREADS_GRAPH_BASE = 'https://graph.threads.net/v1.0';

interface ThreadsMediaContainerResponse {
  id: string;
}

interface ThreadsPublishResponse {
  id: string;
}

interface ThreadsInsightsResponse {
  data: Array<{
    name: string;
    period: string;
    values: Array<{ value: number }>;
  }>;
}

interface ThreadsPermissionsResponse {
  success: boolean;
}

export class ThreadsConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('threads' as Platform, 'Threads', 'api' as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['image' as MediaType, 'video' as MediaType, 'carousel' as MediaType],
      maxMediaBytes: 104_857_600, // 100 MB
      maxMediaCount: 20,
      caption: true,
      maxCaptionLength: 500,
      scheduling: 'native' as const,
      metrics: ['impressions', 'likes', 'comments', 'shares', 'reposts', 'quotes'],
      refreshMetrics: true,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const threadsUserId = this.auth.externalUserId;
      if (!threadsUserId) {
        throw new Error('Threads externalUserId (Threads User ID) is required');
      }

      const accessToken = this.auth.accessToken;

      // Step 1: Create one child container per URL. Threads requires
      // image_url/video_url (not the generic media_url) for media posts.
      const creationIds: string[] = [];

      for (const mediaUrl of input.mediaUrls) {
        const mediaType = this.detectMediaType(mediaUrl);

        const body: Record<string, string | boolean> = {
          media_type: mediaType === 'video' ? 'VIDEO' : 'IMAGE',
          ...(mediaType === 'video' ? { video_url: mediaUrl } : { image_url: mediaUrl }),
          access_token: accessToken,
        };
        if (input.mediaUrls.length > 1) body.is_carousel_item = true;

        const createResp = await this.apiPost<ThreadsMediaContainerResponse>(
          `${THREADS_GRAPH_BASE}/${threadsUserId}/threads`,
          body,
          { 'Content-Type': 'application/json' },
        );

        creationIds.push(createResp.id);
        this.log('info', 'publish', `Created Threads media container ${createResp.id}`, {
          mediaUrl,
          mediaType,
        });
      }

      const publishCreationId =
        creationIds.length > 1
          ? (
              await this.apiPost<ThreadsMediaContainerResponse>(
                `${THREADS_GRAPH_BASE}/${threadsUserId}/threads`,
                {
                  media_type: 'CAROUSEL_ALBUM',
                  text: input.caption,
                  children: creationIds.join(','),
                  access_token: accessToken,
                },
                { 'Content-Type': 'application/json' },
              )
            ).id
          : creationIds[0];

      if (!publishCreationId) throw new Error('Threads did not return a publish container ID');

      // Step 2: Publish the single container (or carousel parent).
      const publishResp = await this.apiPost<ThreadsPublishResponse>(
        `${THREADS_GRAPH_BASE}/${threadsUserId}/threads_publish`,
        { creation_id: publishCreationId, access_token: accessToken },
        { 'Content-Type': 'application/json' },
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
    const threadsUserId = this.auth.externalUserId;
    if (!threadsUserId) {
      throw new Error('Threads externalUserId is required for metrics');
    }

    const accessToken = this.auth.accessToken;

    const metricsUrl =
      `${THREADS_GRAPH_BASE}/${remoteId}/insights` +
      `?metric=views,likes,replies,reposts,quotes,shares` +
      `&access_token=${accessToken}`;

    const resp = await this.fetchImpl(metricsUrl);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Threads metrics fetch failed: HTTP ${resp.status} — ${body}`);
    }

    const data = (await resp.json()) as ThreadsInsightsResponse;

    const result: Partial<Record<string, number>> = {};

    for (const item of data.data) {
      if (item.values && item.values.length > 0) {
        result[item.name] = item.values[0].value;
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

  async revoke(): Promise<void> {
    const threadsUserId = this.auth.externalUserId;
    if (!threadsUserId) {
      this.log('warn', 'revoke', 'No externalUserId set; skipping revoke');
      return;
    }

    const accessToken = this.auth.accessToken;

    await this.apiDelete<ThreadsPermissionsResponse>(
      `${THREADS_GRAPH_BASE}/${threadsUserId}/permissions?access_token=${accessToken}`,
    );

    this.log('info', 'revoke', `Revoked Threads permissions for user ${threadsUserId}`);
  }

  /** Detect media type from URL extension */
  private detectMediaType(url: string): 'image' | 'video' {
    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
      const videoExts = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']);
      return videoExts.has(ext) ? 'video' : 'image';
    } catch {
      return 'image';
    }
  }
}

export default ThreadsConnector;
