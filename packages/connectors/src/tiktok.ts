// ─── TikTok Connector ───
// Uses the TikTok Content Posting API v2 for uploads, metrics, and OAuth management.

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

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

interface TiktokInitResponse {
  data: {
    publish_id: string;
    upload_url: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface TiktokStatusResponse {
  data: {
    status: string;
    fail_reason?: string;
    publicaly_available_post_id?: number[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface TiktokVideoQueryResponse {
  data: {
    videos: Array<{
      id: string;
      statistics: {
        view_count: number;
        like_count: number;
        comment_count: number;
        share_count: number;
      };
    }>;
  };
  error?: {
    code: string;
    message: string;
  };
}

export class TikTokConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('tiktok' as Platform, 'TikTok', 'api' as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['video' as MediaType, 'short' as MediaType],
      maxMediaBytes: 524_288_000, // 500 MB
      maxMediaCount: 1,
      caption: true,
      maxCaptionLength: 2_200,
      scheduling: 'internal' as const,
      metrics: ['views', 'likes', 'comments', 'shares', 'follows'],
      refreshMetrics: true,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const videoUrl = input.mediaUrls[0];
      if (!videoUrl) {
        throw new Error('TikTok requires at least one video URL');
      }

      const options = input.options ?? {};
      const pendingPublishId =
        typeof options.publishId === 'string' && options.publishId.length > 0
          ? options.publishId
          : undefined;

      // A TikTok publish is asynchronous. Retries resume by polling the
      // publish_id stored on post_target instead of uploading a second copy.
      if (pendingPublishId) {
        return this.statusResult(pendingPublishId, await this.fetchPublishStatus(pendingPublishId));
      }

      // Download first so FILE_UPLOAD metadata reflects the actual bytes.
      const videoResponse = await this.fetchImpl(videoUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video from ${videoUrl}: ${videoResponse.status}`);
      }
      const videoBuffer = await videoResponse.arrayBuffer();
      const videoSize = videoBuffer.byteLength;
      if (videoSize <= 0) throw new Error('TikTok video must not be empty');
      const requestedChunkSize = Number(options.chunkSize);
      const chunkSize =
        Number.isSafeInteger(requestedChunkSize) && requestedChunkSize > 0
          ? requestedChunkSize
          : videoSize;
      const totalChunkCount = Math.ceil(videoSize / chunkSize);

      // Step 1: Initialize the video upload. TikTok requires post_info,
      // including privacy_level, in this request alongside FILE_UPLOAD data.
      const initPayload: Record<string, unknown> = {
        post_info: {
          title: input.caption,
          privacy_level: (options.privacyLevel as string | undefined) ?? 'SELF_ONLY',
          disable_duet: options.disableDuet ?? false,
          disable_stitch: options.disableStitch ?? false,
          disable_comment: options.disableComment ?? false,
          brand_content_toggle: options.brandContentToggle ?? options.brandContent ?? false,
          brand_organic_toggle: options.brandOrganicToggle ?? options.brandOrganicUse ?? false,
          is_aigc: options.isAigc ?? false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      };

      const initResp = await this.apiPost<TiktokInitResponse>(
        `${TIKTOK_API_BASE}/post/publish/video/init/`,
        initPayload,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.auth.accessToken}`,
        },
      );

      if (initResp.error && initResp.error.code !== 'ok') {
        throw new Error(`TikTok init failed: ${initResp.error.code} — ${initResp.error.message}`);
      }

      const { publish_id, upload_url } = initResp.data;
      this.log('info', 'publish', `TikTok video init complete`, { publish_id });

      // Step 2: Upload the downloaded bytes to TikTok.
      const uploadResp = await this.fetchImpl(upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(videoBuffer.byteLength),
        },
        body: videoBuffer,
      });

      if (!uploadResp.ok) {
        const uploadBody = await uploadResp.text().catch(() => '');
        throw new Error(
          `TikTok video upload failed: ${uploadResp.status} ${uploadResp.statusText} — ${uploadBody}`,
        );
      }

      this.log('info', 'publish', `TikTok video uploaded (${videoBuffer.byteLength} bytes)`);

      // Step 3: TikTok processes the upload asynchronously. Use the
      // documented status endpoint; there is no /video/complete endpoint.
      return this.statusResult(publish_id, await this.fetchPublishStatus(publish_id));
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const queryUrl = `${TIKTOK_API_BASE}/video/query/?fields=statistics&id=${remoteId}`;

    const resp = await this.apiGet<TiktokVideoQueryResponse>(queryUrl, {
      Authorization: `Bearer ${this.auth.accessToken}`,
    });

    if (resp.error) {
      throw new Error(`TikTok metrics fetch failed: ${resp.error.code} — ${resp.error.message}`);
    }

    const video = resp.data.videos?.[0];
    if (!video) {
      throw new Error(`TikTok video ${remoteId} not found`);
    }

    const stats = video.statistics;

    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        views: stats.view_count ?? 0,
        likes: stats.like_count ?? 0,
        comments: stats.comment_count ?? 0,
        shares: stats.share_count ?? 0,
        follows: 0, // TikTok's video-level API does not expose follower gains per video
      },
      raw: { statistics: stats },
    };
  }

  async revoke(): Promise<void> {
    const clientKey = this.auth.extra?.clientKey as string | undefined;
    const clientSecret = this.auth.extra?.clientSecret as string | undefined;
    if (!clientKey || !clientSecret) {
      throw new Error('TikTok revoke requires clientKey and clientSecret in auth.extra');
    }

    const response = await this.fetchImpl(`${TIKTOK_API_BASE}/oauth/revoke/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        token: this.auth.accessToken,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`TikTok token revoke failed: ${response.status} — ${body}`);
    }

    this.auth.accessToken = '';
    this.auth.refreshToken = undefined;
    this.auth.expiresAt = 0;
    this.log('info', 'revoke', 'TikTok OAuth token revoked successfully');
  }

  private async fetchPublishStatus(publishId: string): Promise<TiktokStatusResponse> {
    return this.apiPost<TiktokStatusResponse>(
      `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
      { publish_id: publishId },
      { 'Content-Type': 'application/json' },
    );
  }

  private statusResult(publishId: string, response: TiktokStatusResponse): ConnectorPublishResult {
    if (response.error && response.error.code !== 'ok') {
      throw new Error(`TikTok status failed: ${response.error.code} — ${response.error.message}`);
    }
    const status = response.data.status;
    if (status === 'FAILED') {
      throw new Error(`TikTok publish failed: ${response.data.fail_reason ?? 'unknown reason'}`);
    }
    const postId = response.data.publicaly_available_post_id?.[0];
    if (status === 'PUBLISH_COMPLETE' && postId !== undefined) {
      const remoteId = String(postId);
      this.log('info', 'publish', 'TikTok video published', { publish_id: publishId, remoteId });
      return {
        remoteId,
        state: 'published',
        postUrl: `https://www.tiktok.com/@${this.auth.extra?.username ?? 'user'}/video/${remoteId}`,
      };
    }
    return {
      remoteId: publishId,
      state: 'pending',
      error: `TikTok publish status is ${status}; waiting for the final post ID`,
    };
  }
}

export default TikTokConnector;
