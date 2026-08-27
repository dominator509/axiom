// ─── YouTube Connector ───
// Uses the YouTube Data API v3 with resumable uploads, shorts detection, and OAuth management.

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

const YT_API_BASE = 'https://www.googleapis.com';
const YT_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

interface YtVideoResponse {
  id: string;
  kind: string;
  snippet?: {
    title: string;
    description: string;
  };
  status?: {
    uploadStatus: string;
    privacyStatus: string;
  };
}

interface YtStatisticsResponse {
  items: Array<{
    id: string;
    statistics: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
      shareCount?: string;
    };
  }>;
}

export class YouTubeConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth) {
    super('youtube' as Platform, 'YouTube', 'api' as PublishMode, auth);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['video' as MediaType, 'short' as MediaType],
      maxMediaBytes: 274_877_906_944, // 256 GB
      maxMediaCount: 1,
      caption: true,
      maxCaptionLength: 5_000,
      scheduling: 'native' as const,
      metrics: ['views', 'likes', 'comments'],
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
        throw new Error('YouTube requires exactly one video URL');
      }

      // Detect if this is a Short based on options
      const durationSec = (input.options?.durationSec as number) ?? 0;
      const aspectRatio = (input.options?.aspectRatio as string) ?? '16:9';
      const isShort = durationSec > 0 && durationSec <= 60 && aspectRatio === '9:16';

      // Build snippet and status metadata
      const title = (input.options?.title as string) ?? 'Untitled';
      const description = input.caption || '';
      const privacyStatus = (input.options?.privacyStatus as string) ?? 'private';

      // Append #Shorts tag if detected (copy so we never mutate caller's input)
      const tags = [...((input.options?.tags as string[]) ?? [])];
      if (isShort && !tags.includes('#Shorts')) {
        tags.push('#Shorts');
      }

      const metadata = {
        snippet: {
          title,
          description,
          tags,
          categoryId: (input.options?.categoryId as string) ?? '22', // 22 = Entertainment
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: input.options?.madeForKids ?? false,
        },
      };

      // Step 1: Initiate resumable upload session
      const metadataJson = JSON.stringify(metadata);

      const initResponse = await fetch(
        `${YT_UPLOAD_BASE}/videos?part=snippet,status&uploadType=resumable`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.auth.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(input.options?.videoSize ?? ''),
            'X-Upload-Content-Type': 'video/*',
          },
          body: metadataJson,
        },
      );

      if (!initResponse.ok) {
        const initBody = await initResponse.text().catch(() => '');
        throw new Error(
          `YouTube resumable upload init failed: ${initResponse.status} — ${initBody}`,
        );
      }

      const uploadUrl = initResponse.headers.get('Location');
      if (!uploadUrl) {
        throw new Error('YouTube did not return a Location header for resumable upload');
      }

      this.log('info', 'publish', `YouTube resumable upload session created`);

      // Step 2: Download the video and upload it to the resumable URL
      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video from ${videoUrl}: ${videoResponse.status}`);
      }

      const videoBuffer = await videoResponse.arrayBuffer();

      const uploadResp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/*',
          'Content-Length': String(videoBuffer.byteLength),
        },
        body: videoBuffer,
      });

      if (!uploadResp.ok) {
        const uploadBody = await uploadResp.text().catch(() => '');
        throw new Error(
          `YouTube video upload failed: ${uploadResp.status} ${uploadResp.statusText} — ${uploadBody}`,
        );
      }

      const videoData = (await uploadResp.json()) as YtVideoResponse;
      const remoteId = videoData.id;

      this.log('info', 'publish', `YouTube video published`, { remoteId });

      const postUrl = `https://www.youtube.com/watch?v=${remoteId}`;

      return {
        remoteId,
        state: 'published',
        postUrl,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const url = `${YT_API_BASE}/youtube/v3/videos?part=statistics&id=${remoteId}`;

    const resp = await this.apiGet<YtStatisticsResponse>(url, {
      Authorization: `Bearer ${this.auth.accessToken}`,
    });

    if (!resp.items || resp.items.length === 0) {
      throw new Error(`YouTube video ${remoteId} not found`);
    }

    const stats = resp.items[0].statistics;

    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        views: parseInt(stats.viewCount ?? '0', 10),
        likes: parseInt(stats.likeCount ?? '0', 10),
        comments: parseInt(stats.commentCount ?? '0', 10),
      },
      raw: stats as unknown as Record<string, unknown>,
    };
  }

  async revoke(): Promise<void> {
    const token = this.auth.accessToken;

    // Revoke the OAuth token at Google's revocation endpoint
    const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`;

    const response = await fetch(revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.log('warn', 'revoke', `YouTube token revocation warned: ${response.status} — ${body}`);
      // Don't throw — token may already be revoked
    } else {
      this.log('info', 'revoke', `YouTube OAuth token revoked successfully`);
    }

    // Clear cached auth data
    this.auth.accessToken = '';
    this.auth.refreshToken = undefined;
    this.auth.expiresAt = 0;
  }
}

export default YouTubeConnector;
