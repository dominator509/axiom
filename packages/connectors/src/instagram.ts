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
import { validatePublish } from './validation.js';

const IG_GRAPH_BASE = 'https://graph.facebook.com/v22.0';

interface IgMediaContainerResponse {
  id: string;
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
  constructor(auth: ConnectorAuth) {
    super('instagram' as Platform, 'Instagram', 'api' as PublishMode, auth);
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
      scheduling: 'native' as const,
      metrics: ['impressions', 'likes', 'comments', 'shares', 'saves'],
      refreshMetrics: true,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const igUserId = this.auth.externalUserId;
      if (!igUserId) {
        throw new Error('Instagram externalUserId (IG Business Account ID) is required');
      }

      const accessToken = this.auth.accessToken;

      // Step 1: Create media containers for each media URL. For a carousel,
      // each child must be marked is_carousel_item and the parent below is
      // the only container that gets published.
      const creationIds: string[] = [];

      for (const mediaUrl of input.mediaUrls) {
        const mediaType = this.detectMediaType(mediaUrl);

        const body: Record<string, string> = {
          image_url: mediaUrl,
          access_token: accessToken,
        };

        if (mediaType === 'video') {
          body.media_type = 'VIDEO';
          body.video_url = mediaUrl;
          delete body.image_url;
        }
        if (input.mediaUrls.length > 1) body.is_carousel_item = 'true';
        else body.caption = input.caption;

        const createResp = await this.apiPost<IgMediaContainerResponse>(
          `${IG_GRAPH_BASE}/${igUserId}/media`,
          body,
          { 'Content-Type': 'application/json' },
        );

        creationIds.push(createResp.id);
        this.log('info', 'publish', `Created media container ${createResp.id}`, {
          mediaUrl,
          mediaType,
        });
      }

      const publishCreationId =
        creationIds.length > 1
          ? (
              await this.apiPost<IgMediaContainerResponse>(
                `${IG_GRAPH_BASE}/${igUserId}/media`,
                {
                  media_type: 'CAROUSEL',
                  children: creationIds.join(','),
                  caption: input.caption,
                  access_token: accessToken,
                },
                { 'Content-Type': 'application/json' },
              )
            ).id
          : creationIds[0];

      if (!publishCreationId) throw new Error('Instagram did not return a publish container ID');

      // Step 2: Publish the single container (or carousel parent).
      const publishResp = await this.apiPost<IgPublishResponse>(
        `${IG_GRAPH_BASE}/${igUserId}/media_publish`,
        { creation_id: publishCreationId, access_token: accessToken },
        { 'Content-Type': 'application/json' },
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
    const igUserId = this.auth.externalUserId;
    if (!igUserId) {
      throw new Error('Instagram externalUserId is required for metrics');
    }

    const accessToken = this.auth.accessToken;

    const metrics = await this.apiGet<IgInsightsResponse>(
      `${IG_GRAPH_BASE}/${igUserId}/media/${remoteId}/insights` +
        `?metric=impressions,likes,comments,shares,saves` +
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
        saves: result['saves'] ?? 0,
      },
      raw: metrics as unknown as Record<string, unknown>,
    };
  }

  async revoke(): Promise<void> {
    const igUserId = this.auth.externalUserId;
    if (!igUserId) {
      this.log('warn', 'revoke', 'No externalUserId set; skipping revoke');
      return;
    }

    const accessToken = this.auth.accessToken;

    await this.apiDelete<IgPermissionsResponse>(
      `${IG_GRAPH_BASE}/${igUserId}/permissions?delegation&access_token=${accessToken}`,
    );

    this.log('info', 'revoke', `Revoked Instagram permissions for user ${igUserId}`);
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

export default InstagramConnector;
