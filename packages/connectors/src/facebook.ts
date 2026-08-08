// ─── Facebook Connector ───
// Uses the Facebook Graph API v22.0 for publishing, metrics, and app permissions management.

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

const FB_GRAPH_BASE = 'https://graph.facebook.com/v22.0';

interface FbPhotoResponse {
  id: string;
  post_id?: string;
}

interface FbVideoResponse {
  id: string;
  post_id?: string;
}

interface FbFeedResponse {
  id: string;
}

interface FbInsightsResponse {
  data: Array<{
    name: string;
    period: string;
    values: Array<{ value: number }>;
  }>;
}

interface FbPermissionsResponse {
  success: boolean;
}

export class FacebookConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth) {
    super('facebook' as Platform, 'Facebook', 'api' as PublishMode, auth);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['image' as MediaType, 'video' as MediaType, 'story' as MediaType],
      maxMediaBytes: 4_294_967_296, // 4 GB
      maxMediaCount: 10,
      caption: true,
      maxCaptionLength: 63_206,
      scheduling: 'native' as const,
      metrics: ['impressions', 'likes', 'comments', 'shares'],
      refreshMetrics: true,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const pageId = this.auth.externalUserId;
      if (!pageId) {
        throw new Error('Facebook externalUserId (Page ID) is required');
      }

      const accessToken = this.auth.accessToken;
      const caption = input.caption;
      const mediaUrls = input.mediaUrls;
      const link = input.options?.link as string | undefined;

      // ── Text-only post (with optional link) ──
      if (mediaUrls.length === 0) {
        const body: Record<string, string> = {
          message: caption,
          access_token: accessToken,
        };

        if (link) {
          body.link = link;
        }

        const feedResp = await this.apiPost<FbFeedResponse>(
          `${FB_GRAPH_BASE}/${pageId}/feed`,
          body,
          { 'Content-Type': 'application/json' },
        );

        const remoteId = feedResp.id;
        this.log('info', 'publish', `Facebook feed post published`, { remoteId });

        return {
          remoteId,
          state: 'published',
          postUrl: `https://www.facebook.com/${pageId}/posts/${remoteId}`,
        };
      }

      // ── Media posts ──
      let lastRemoteId: string | null = null;

      for (const mediaUrl of mediaUrls) {
        const mediaType = this.detectMediaType(mediaUrl);

        if (mediaType === 'video') {
          // POST /{page-id}/videos
          const body: Record<string, string> = {
            file_url: mediaUrl,
            description: caption,
            access_token: accessToken,
          };

          const videoResp = await this.apiPost<FbVideoResponse>(
            `${FB_GRAPH_BASE}/${pageId}/videos`,
            body,
            { 'Content-Type': 'application/json' },
          );

          lastRemoteId = videoResp.id;
          this.log('info', 'publish', `Facebook video published`, {
            remoteId: videoResp.id,
            mediaUrl,
          });
        } else if (mediaType === 'story') {
          // Story upload via /{page-id}/stories
          const body: Record<string, string> = {
            file_url: mediaUrl,
            access_token: accessToken,
          };

          // Stories use the parent page ID as the media owner
          const storyResp = await this.apiPost<FbPhotoResponse>(
            `${FB_GRAPH_BASE}/${pageId}/stories`,
            body,
            { 'Content-Type': 'application/json' },
          );

          lastRemoteId = storyResp.id;
          this.log('info', 'publish', `Facebook story published`, {
            remoteId: storyResp.id,
            mediaUrl,
          });
        } else {
          // POST /{page-id}/photos
          const body: Record<string, string> = {
            url: mediaUrl,
            caption: caption,
            access_token: accessToken,
          };

          const photoResp = await this.apiPost<FbPhotoResponse>(
            `${FB_GRAPH_BASE}/${pageId}/photos`,
            body,
            { 'Content-Type': 'application/json' },
          );

          lastRemoteId = photoResp.post_id ?? photoResp.id;
          this.log('info', 'publish', `Facebook photo published`, {
            remoteId: lastRemoteId,
            mediaUrl,
          });
        }
      }

      const postUrl = lastRemoteId
        ? `https://www.facebook.com/${pageId}/posts/${lastRemoteId}`
        : undefined;

      return {
        remoteId: lastRemoteId,
        state: 'published',
        postUrl,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const pageId = this.auth.externalUserId;
    if (!pageId) {
      throw new Error('Facebook externalUserId (Page ID) is required for metrics');
    }

    const accessToken = this.auth.accessToken;

    // Get insights for the post
    const insightsUrl =
      `${FB_GRAPH_BASE}/${pageId}_${remoteId}/insights` +
      `?metric=impressions,likes,comments,shares&access_token=${accessToken}`;

    const resp = await fetch(insightsUrl);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Facebook metrics fetch failed: HTTP ${resp.status} — ${body}`);
    }

    const insights = (await resp.json()) as FbInsightsResponse;

    const result: Partial<Record<string, number>> = {};

    for (const item of insights.data) {
      if (item.values && item.values.length > 0) {
        result[item.name] = item.values[0].value;
      }
    }

    // If the insights endpoint didn't return data, fall back to reading post fields
    let likes = result['likes'] ?? 0;
    let comments = result['comments'] ?? 0;
    let shares = result['shares'] ?? 0;
    const impressions = result['impressions'] ?? 0;

    // Fallback: fetch post reactions/comments counts directly
    if (likes === 0 || comments === 0) {
      try {
        const postUrl = `${FB_GRAPH_BASE}/${pageId}_${remoteId}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=${accessToken}`;

        const postResp = await fetch(postUrl);
        if (postResp.ok) {
          const postData = (await postResp.json()) as {
            likes?: { summary?: { total_count?: number } };
            comments?: { summary?: { total_count?: number } };
            shares?: { count?: number };
          };

          if (postData.likes?.summary?.total_count != null) {
            likes = postData.likes.summary.total_count;
          }
          if (postData.comments?.summary?.total_count != null) {
            comments = postData.comments.summary.total_count;
          }
          if (postData.shares?.count != null) {
            shares = postData.shares.count;
          }
        }
      } catch {
        // Non-critical — use what we have
      }
    }

    this.log('info', 'fetchMetrics', `Fetched Facebook metrics`, {
      remoteId,
      likes,
      comments,
      shares,
      impressions,
    });

    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        impressions,
        likes,
        comments,
        shares,
      },
      raw: insights as unknown as Record<string, unknown>,
    };
  }

  async revoke(): Promise<void> {
    const pageId = this.auth.externalUserId;
    if (!pageId) {
      this.log('warn', 'revoke', 'No externalUserId set; skipping revoke');
      return;
    }

    const accessToken = this.auth.accessToken;

    // Revoke: DELETE /{page-id}/permissions removes all app permissions
    const revokeUrl = `${FB_GRAPH_BASE}/${pageId}/permissions?access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(revokeUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.log(
        'warn',
        'revoke',
        `Facebook permissions deletion warned: ${response.status} — ${body}`,
      );
    } else {
      const result = (await response.json()) as FbPermissionsResponse;
      this.log('info', 'revoke', `Facebook permissions revoked for page ${pageId}`, {
        success: result.success,
      });
    }

    // Also attempt to revoke the user-level token
    try {
      const userTokenRevokeUrl = `${FB_GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(accessToken)}`;

      const userResp = await fetch(userTokenRevokeUrl, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (userResp.ok) {
        this.log('info', 'revoke', 'Facebook user-level permissions also revoked');
      }
    } catch {
      // Non-critical
    }

    // Clear cached auth data
    this.auth.accessToken = '';
    this.auth.refreshToken = undefined;
    this.auth.expiresAt = 0;
  }

  /** Detect media type from URL extension */
  private detectMediaType(url: string): 'image' | 'video' | 'story' {
    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
      const videoExts = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']);
      const storyExts = new Set(['heic', 'heif']);

      if (videoExts.has(ext)) return 'video';
      if (storyExts.has(ext)) return 'story';
      return 'image';
    } catch {
      return 'image';
    }
  }
}

export default FacebookConnector;
