// ─── Instagram Connector ───
// Uses the Instagram Graph API for publishing, metrics, and auth management.

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
import { mediaTypeHint, validatePublish } from './validation.js';

const IG_GRAPH_BASE = 'https://graph.facebook.com/v22.0';
const CONTAINER_POLL_INTERVAL_MS = 60_000;
const CONTAINER_POLL_ATTEMPTS = 5;

interface IgMediaContainerResponse {
  id: string;
}

interface IgContainerStatusResponse {
  id: string;
  status_code?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  status?: string;
}

interface IgPublishResponse {
  id: string;
}

interface IgInsightsResponse {
  data: Array<{
    name: string;
    period: string;
    values: Array<{ value: number }>;
  }>;
}

interface IgPermissionsResponse {
  success: boolean;
}

export class InstagramConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('instagram' as Platform, 'Instagram', 'api' as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: [
        'image' as MediaType,
        'video' as MediaType,
        'carousel' as MediaType,
        'story' as MediaType,
      ],
      maxMediaBytes: 104_857_600, // 100 MB
      maxMediaCount: 10,
      caption: true,
      maxCaptionLength: 2_200,
      // The worker owns the scheduled slot and invokes this connector when
      // it is due; this connector does not send a provider-side schedule.
      scheduling: 'internal' as const,
      metrics: ['impressions', 'likes', 'comments', 'shares', 'saves'],
      refreshMetrics: true,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    const report = validatePublish(input, this.capability());
    if (input.options?.mediaType === 'story' && input.mediaUrls.length !== 1) {
      report.valid = false;
      report.tosVerdict = 'block';
      report.errors.push({
        field: 'mediaUrls',
        message: 'Instagram stories require exactly one media URL.',
        severity: 'error',
      });
    }
    return report;
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const igUserId = this.auth.externalUserId;
      if (!igUserId) {
        throw new Error('Instagram externalUserId (IG Business Account ID) is required');
      }

      const accessToken = this.auth.accessToken;

      // Stories use the same /media container flow, but must be explicitly
      // marked STORIES and never receive carousel/feed-only fields.
      if (input.options?.mediaType === 'story') {
        if (input.mediaUrls.length !== 1) {
          throw new Error('Instagram stories require exactly one media URL');
        }

        const mediaUrl = input.mediaUrls[0];
        const mediaType = this.detectMediaType(mediaUrl, mediaTypeHint(input));
        const storyParams: Record<string, string> = {
          media_type: 'STORIES',
          access_token: accessToken,
          ...(mediaType === 'video' ? { video_url: mediaUrl } : { image_url: mediaUrl }),
        };
        const storyContainer = await this.apiPost<IgMediaContainerResponse>(
          this.graphUrl(`${IG_GRAPH_BASE}/${igUserId}/media`, storyParams),
        );
        await this.waitForContainerReady(storyContainer.id);
        const publishResp = await this.apiPost<IgPublishResponse>(
          this.graphUrl(`${IG_GRAPH_BASE}/${igUserId}/media_publish`, {
            creation_id: storyContainer.id,
            access_token: accessToken,
          }),
        );

        return {
          remoteId: publishResp.id,
          state: 'published',
          // Stories do not have a stable feed permalink.
          postUrl: undefined,
        };
      }

      // Step 1: Create media containers for each media URL. For a carousel,
      // each child must be marked is_carousel_item and the parent below is
      // the only container that gets published.
      const creationIds: string[] = [];

      for (const mediaUrl of input.mediaUrls) {
        const mediaType = this.detectMediaType(mediaUrl, mediaTypeHint(input));

        const params: Record<string, string> = {
          image_url: mediaUrl,
          access_token: accessToken,
        };

        if (mediaType === 'video') {
          params.media_type = input.mediaUrls.length > 1 ? 'VIDEO' : 'REELS';
          params.video_url = mediaUrl;
          delete params.image_url;
        }
        if (input.mediaUrls.length > 1) params.is_carousel_item = 'true';
        else params.caption = input.caption;

        const createResp = await this.apiPost<IgMediaContainerResponse>(
          this.graphUrl(`${IG_GRAPH_BASE}/${igUserId}/media`, params),
        );

        creationIds.push(createResp.id);
        await this.waitForContainerReady(createResp.id);
        this.log('info', 'publish', `Created media container ${createResp.id}`, {
          mediaUrl,
          mediaType,
        });
      }

      const publishCreationId =
        creationIds.length > 1
          ? (
              await this.apiPost<IgMediaContainerResponse>(
                this.graphUrl(`${IG_GRAPH_BASE}/${igUserId}/media`, {
                  media_type: 'CAROUSEL',
                  children: creationIds.join(','),
                  caption: input.caption,
                  access_token: accessToken,
                }),
              )
            ).id
          : creationIds[0];

      if (!publishCreationId) throw new Error('Instagram did not return a publish container ID');
      if (creationIds.length > 1) await this.waitForContainerReady(publishCreationId);

      // Step 2: Publish the single container (or carousel parent).
      const publishResp = await this.apiPost<IgPublishResponse>(
        this.graphUrl(`${IG_GRAPH_BASE}/${igUserId}/media_publish`, {
          creation_id: publishCreationId,
          access_token: accessToken,
        }),
      );
      const lastRemoteId = publishResp.id;
      this.log(
        'info',
        'publish',
        `Published container ${publishCreationId} -> post ${lastRemoteId}`,
      );

      const postUrl = lastRemoteId ? `https://www.instagram.com/p/${lastRemoteId}/` : undefined;

      return {
        remoteId: lastRemoteId,
        state: 'published',
        postUrl,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const accessToken = this.auth.accessToken;

    const metrics = await this.apiGet<IgInsightsResponse>(
      `${IG_GRAPH_BASE}/${remoteId}/insights` +
        `?metric=impressions,likes,comments,shares,saved` +
        `&access_token=${accessToken}`,
    );

    const result: Partial<Record<string, number>> = {};

    for (const item of metrics.data) {
      if (item.values && item.values.length > 0) {
        result[item.name] = item.values[0].value;
      }
    }

    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        impressions: result['impressions'] ?? 0,
        likes: result['likes'] ?? 0,
        comments: result['comments'] ?? 0,
        shares: result['shares'] ?? 0,
        saves: result['saved'] ?? result['saves'] ?? 0,
      },
      raw: metrics as unknown as Record<string, unknown>,
    };
  }

  async revoke(): Promise<void> {
    const igUserId = this.auth.externalUserId;
    if (!igUserId) {
      throw new Error('Instagram revoke requires externalUserId (Instagram User ID)');
    }

    const accessToken = this.auth.accessToken;

    await this.apiDelete<IgPermissionsResponse>(
      `${IG_GRAPH_BASE}/${igUserId}/permissions?delegation&access_token=${accessToken}`,
    );

    this.log('info', 'revoke', `Revoked Instagram permissions for user ${igUserId}`);
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

  private graphUrl(endpoint: string, params: Record<string, string>): string {
    const query = new URLSearchParams(params).toString();
    return `${endpoint}?${query}`;
  }

  /**
   * Instagram media containers are processed asynchronously. The provider
   * requires status_code=FINISHED before media_publish, including carousel
   * children and the carousel parent itself.
   */
  private async waitForContainerReady(containerId: string): Promise<void> {
    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt++) {
      const status = await this.apiGet<IgContainerStatusResponse>(
        `${IG_GRAPH_BASE}/${containerId}?fields=status_code,status`,
      );

      if (status.status_code === 'FINISHED' || status.status_code === 'PUBLISHED') return;

      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        throw new Error(
          `Instagram container ${containerId} processing ${status.status_code.toLowerCase()}: ${status.status ?? 'unknown provider error'}`,
        );
      }

      if (attempt < CONTAINER_POLL_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
      }
    }

    throw new Error(`Instagram container ${containerId} processing timed out`);
  }
}

export default InstagramConnector;
