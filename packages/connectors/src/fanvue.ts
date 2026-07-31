// ─── Fanvue MCP Connector ───
// Connects to Fanvue's MCP endpoint for uploads, posting, and analytics

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

const FANVUE_MCP_BASE = 'https://mcp.fanvue.com/v1';

interface FanvueUploadResponse {
  id: string;
  url: string;
}

interface FanvuePostResponse {
  id: string;
  url: string;
  status: string;
}

interface FanvueAnalyticsResponse {
  views: number;
  likes: number;
  comments: number;
  revenue: number;
}

export class FanvueConnector extends BaseConnector implements SocialConnector {
  private modelId: string;

  constructor(auth: ConnectorAuth) {
    super('fanvue' as Platform, 'Fanvue', 'api' as PublishMode, auth);
    this.modelId = auth.externalUserId || '';
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['image' as MediaType, 'video' as MediaType],
      maxMediaBytes: 200_000_000, // 200 MB
      maxMediaCount: 10,
      caption: true,
      maxCaptionLength: 2200,
      scheduling: 'internal' as const,
      metrics: ['views' as const, 'likes' as const, 'comments' as const],
      refreshMetrics: true,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    const errors = [];

    if (!input.mediaUrls || input.mediaUrls.length === 0) {
      errors.push({ field: 'mediaUrls', message: 'Fanvue requires at least one media file', severity: 'error' as const });
    }
    if (!input.caption) {
      errors.push({ field: 'caption', message: 'Fanvue posts require a caption', severity: 'error' as const });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
      infos: [],
      tosVerdict: 'pass' as const,
    };
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      // 1. Upload media to Fanvue
      const mediaIds: string[] = [];
      for (const mediaUrl of input.mediaUrls) {
        const uploadRes = await this.apiPost<FanvueUploadResponse>(
          `${FANVUE_MCP_BASE}/upload`,
          { url: mediaUrl, model_id: this.modelId },
        );
        mediaIds.push(uploadRes.id);
      }

      // 2. Create post with uploaded media
      const postRes = await this.apiPost<FanvuePostResponse>(
        `${FANVUE_MCP_BASE}/posts`,
        {
          model_id: this.modelId,
          media_ids: mediaIds,
          caption: input.caption,
          hashtags: input.hashtags || [],
          scheduled_for: input.scheduledFor || null,
        },
      );

      this.log('info', 'publish', `Fanvue post created: ${postRes.id}`);

      return {
        remoteId: postRes.id,
        state: 'published',
        postUrl: postRes.url,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const data = await this.apiGet<FanvueAnalyticsResponse>(
      `${FANVUE_MCP_BASE}/analytics/posts/${remoteId}`,
    );

    return {
      postId: remoteId,
      platform: 'fanvue' as Platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        views: data.views,
        likes: data.likes,
        comments: data.comments,
      },
    };
  }

  async revoke(): Promise<void> {
    await this.apiPost(`${FANVUE_MCP_BASE}/auth/revoke`, { model_id: this.modelId });
    this.log('info', 'revoke', 'Fanvue MCP access revoked');
  }
}
