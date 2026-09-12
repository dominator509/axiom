// ─── X (Twitter) Connector ───
// Uses the Twitter API v2 for publishing, metrics, and OAuth 2.0 management.

import {
  BaseConnector,
  CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
  CONNECTOR_MAX_JSON_RESPONSE_BYTES,
  readResponseBytes,
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
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { mediaTypeHint, validatePublish } from './validation.js';

const TWITTER_UPLOAD_BASE = 'https://upload.twitter.com/1.1';
const TWITTER_API_BASE = 'https://api.twitter.com/2';
const TWITTER_OAUTH_REVOKE = 'https://api.twitter.com/2/oauth2/revoke';
const X_IMAGE_MAX_BYTES = 5_000_000;
const X_GIF_MAX_BYTES = 15_000_000;
const X_VIDEO_MAX_BYTES = 536_870_912;
const X_MAX_MEDIA_BYTES = X_VIDEO_MAX_BYTES;

type XMediaKind = 'image' | 'gif' | 'video';

/**
 * X accepts a homogeneous media set on a post. The shared capability shape
 * can express the overall count, but not the provider rule that a post may
 * contain either up to four images, one GIF, or one video. Keep this constraint at the
 * connector boundary so invalid inputs are rejected before media uploads.
 */
function inferXMediaKind(
  url: string,
  declared?: ReturnType<typeof mediaTypeHint>,
): XMediaKind {
  if (declared === 'video') return 'video';
  if (declared === 'gif') return 'gif';
  if (declared === 'image') return 'image';

  try {
    const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
    if (extension === 'gif') return 'gif';
    return extension && ['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v'].includes(extension)
      ? 'video'
      : 'image';
  } catch {
    // The common validator already treats an unknown URL extension as image.
    return 'image';
  }
}

interface MediaInitResponse {
  media_id_string: string;
  media_id: number;
  size: number;
  expires_after_secs: number;
}

interface MediaFinalizeResponse {
  media_id_string: string;
  media_id: number;
  size: number;
  processing_state?: string;
}

interface TweetResponse {
  data: {
    id: string;
    text: string;
  };
}

interface TweetMetricsResponse {
  data: {
    id: string;
    public_metrics?: {
      like_count?: number;
      reply_count?: number;
      retweet_count?: number;
      quote_count?: number;
      impression_count?: number;
      bookmark_count?: number;
    };
  };
}

interface RevokeResponse {
  revoked: boolean;
}

export class XConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('x' as Platform, 'X (Twitter)', 'api' as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: [
        'image' as MediaType,
        'video' as MediaType,
        'gif' as MediaType,
        'text' as MediaType,
      ],
      maxMediaBytes: X_MAX_MEDIA_BYTES,
      maxMediaCount: 4,
      caption: true,
      maxCaptionLength: 4_000,
      scheduling: 'internal' as const,
      metrics: ['likes', 'comments', 'shares', 'impressions', 'reposts', 'quotes'],
      refreshMetrics: true,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    const report = validatePublish(input, this.capability());
    if (input.mediaUrls.length > 1) {
      const declared = mediaTypeHint(input);
      const mediaKinds = input.mediaUrls.map((url) => inferXMediaKind(url, declared));
      const containsVideo = mediaKinds.includes('video');
      const containsGif = mediaKinds.includes('gif');

      if (containsVideo || containsGif) {
        report.valid = false;
        report.tosVerdict = 'block';
        report.errors.push({
          field: 'mediaUrls',
          message:
            'X posts allow up to four images, one GIF, or one video; media types cannot be mixed.',
          severity: 'error',
        });
      }
    }
    return report;
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const validation = await this.validate(input);
      if (!validation.valid) {
        throw new Error(
          `X publish validation failed: ${validation.errors.map((error) => error.message).join('; ')}`,
        );
      }

      const mediaIds: string[] = [];

      // Step 1: Upload each media file via chunked upload (INIT → APPEND → FINALIZE)
      for (const mediaUrl of input.mediaUrls) {
        const mediaId = await this.uploadMedia(mediaUrl);
        mediaIds.push(mediaId);
        this.log('info', 'publish', `Media uploaded to X`, { mediaUrl, mediaId });
      }

      // Step 2: Create tweet with media_ids
      const body: Record<string, unknown> = {
        text: input.caption,
      };

      if (mediaIds.length > 0) {
        body.media = { media_ids: mediaIds };
      }

      const tweetResp = await this.apiPost<TweetResponse>(`${TWITTER_API_BASE}/tweets`, body, {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'Content-Type': 'application/json',
      });

      const remoteId = tweetResp.data.id;
      this.log('info', 'publish', `Tweet published`, { remoteId });

      const postUrl = `https://x.com/i/web/status/${remoteId}`;

      return {
        remoteId,
        state: 'published',
        postUrl,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const url = `${TWITTER_API_BASE}/tweets/${remoteId}?tweet.fields=public_metrics`;

    const resp = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
      },
    });

    if (!resp.ok) {
      const body = await readResponseText(
        resp,
        CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
        'provider error response',
      ).catch(() => '');
      throw new Error(`X metrics fetch failed: HTTP ${resp.status} — ${redactProviderText(body)}`);
    }

    const data = await readResponseJson<TweetMetricsResponse>(resp);

    if (!data.data) {
      throw new Error(`X tweet ${remoteId} not found`);
    }

    const m = data.data.public_metrics ?? {};

    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        likes: m.like_count ?? 0,
        comments: m.reply_count ?? 0,
        shares: m.retweet_count ?? 0,
        impressions: m.impression_count ?? 0,
        reposts: m.retweet_count ?? 0,
        quotes: m.quote_count ?? 0,
      },
      raw: data.data as unknown as Record<string, unknown>,
    };
  }

  async revoke(): Promise<void> {
    // Revoke OAuth 2.0 token
    const clientId = (this.auth.extra?.clientId as string) ?? '';

    const params = new URLSearchParams({
      token: this.auth.accessToken,
      token_type_hint: 'access_token',
    });

    if (clientId) {
      params.append('client_id', clientId);
    }

    const response = await this.fetchImpl(TWITTER_OAUTH_REVOKE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await readResponseText(
        response,
        CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
        'provider error response',
      ).catch(() => '');
      throw new Error(
        `X token revocation failed: HTTP ${response.status} — ${redactProviderText(body)}`,
      );
    }

    const responseBody = await readResponseText(
      response,
      CONNECTOR_MAX_JSON_RESPONSE_BYTES,
      'provider JSON response',
    ).catch(() => '');
    const result: RevokeResponse = responseBody.trim()
      ? (JSON.parse(responseBody) as RevokeResponse)
      : { revoked: true };
    this.log('info', 'revoke', `X OAuth 2.0 token revoked`, { revoked: result.revoked ?? true });

    // Clear cached auth data
    this.auth.accessToken = '';
    this.auth.refreshToken = undefined;
    this.auth.expiresAt = 0;
  }

  /**
   * Upload a single media file to X using the chunked upload API.
   * Downloads the media from the provided URL first, then performs
   * INIT → APPEND → FINALIZE.
   */
  private async uploadMedia(mediaUrl: string): Promise<string> {
    // Download the media file
    const mediaResponse = await this.fetchImpl(mediaUrl);
    if (!mediaResponse.ok) {
      throw new Error(`Failed to download media from ${mediaUrl}: ${mediaResponse.status}`);
    }

    const contentType = mediaResponse.headers.get('content-type') ?? 'application/octet-stream';
    const normalizedContentType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    const mediaKind = inferXMediaKind(
      mediaUrl,
      normalizedContentType?.startsWith('video/')
        ? 'video'
        : normalizedContentType === 'image/gif'
          ? 'gif'
          : undefined,
    );
    const maxBytes =
      mediaKind === 'video'
        ? X_VIDEO_MAX_BYTES
        : mediaKind === 'gif'
          ? X_GIF_MAX_BYTES
          : X_IMAGE_MAX_BYTES;
    const mediaBuffer = await readResponseBytes(mediaResponse, maxBytes, 'X media');
    const totalBytes = mediaBuffer.byteLength;

    // Detect media type for the upload
    const mediaType =
      mediaKind === 'video'
        ? normalizedContentType?.startsWith('video/')
          ? normalizedContentType
          : 'video/mp4'
        : mediaKind === 'gif'
          ? 'image/gif'
          : normalizedContentType?.startsWith('image/')
            ? normalizedContentType
            : 'image/jpeg';
    const mediaCategory =
      mediaKind === 'video' ? 'tweet_video' : mediaKind === 'gif' ? 'tweet_gif' : 'tweet_image';

    // STEP 1: INIT — allocate a media ID
    const initFormData = new FormData();
    initFormData.append('command', 'INIT');
    initFormData.append('media_type', mediaType);
    initFormData.append('media_category', mediaCategory);
    initFormData.append('total_bytes', String(totalBytes));

    const initResp = await this.fetchImpl(`${TWITTER_UPLOAD_BASE}/media/upload.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
      },
      body: initFormData,
    });

    if (!initResp.ok) {
      const initBody = await readResponseText(
        initResp,
        CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
        'provider error response',
      ).catch(() => '');
      throw new Error(
        `X media INIT failed: HTTP ${initResp.status} — ${redactProviderText(initBody)}`,
      );
    }

    const initData = await readResponseJson<MediaInitResponse>(initResp);
    const mediaId = initData.media_id_string;

    this.log('info', 'uploadMedia', `Media INIT complete`, { mediaId, totalBytes });

    // STEP 2: APPEND — upload the file in chunks
    const chunkSize = 5 * 1024 * 1024; // 5 MB chunks
    let segmentIndex = 0;

    for (let offset = 0; offset < totalBytes; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, totalBytes);
      const chunk = Buffer.from(mediaBuffer.slice(offset, end));

      const appendFormData = new FormData();
      appendFormData.append('command', 'APPEND');
      appendFormData.append('media_id', mediaId);
      appendFormData.append('segment_index', String(segmentIndex));
      appendFormData.append('media', new Blob([chunk], { type: contentType }));

      const appendResp = await this.fetchImpl(`${TWITTER_UPLOAD_BASE}/media/upload.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.auth.accessToken}`,
        },
        body: appendFormData,
      });

      if (!appendResp.ok) {
        const appendBody = await readResponseText(
          appendResp,
          CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
          'provider error response',
        ).catch(() => '');
        throw new Error(
          `X media APPEND failed at segment ${segmentIndex}: HTTP ${appendResp.status} — ${redactProviderText(appendBody)}`,
        );
      }

      segmentIndex++;
    }

    this.log('info', 'uploadMedia', `Media APPEND complete`, { mediaId, segments: segmentIndex });

    // STEP 3: FINALIZE — complete the upload
    const finalizeFormData = new FormData();
    finalizeFormData.append('command', 'FINALIZE');
    finalizeFormData.append('media_id', mediaId);

    const finalizeResp = await this.fetchImpl(`${TWITTER_UPLOAD_BASE}/media/upload.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
      },
      body: finalizeFormData,
    });

    if (!finalizeResp.ok) {
      const finalizeBody = await readResponseText(
        finalizeResp,
        CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
        'provider error response',
      ).catch(() => '');
      throw new Error(
        `X media FINALIZE failed: HTTP ${finalizeResp.status} — ${redactProviderText(finalizeBody)}`,
      );
    }

    const finalizeData = await readResponseJson<MediaFinalizeResponse>(finalizeResp);

    // For videos, wait for processing to complete
    if (mediaKind === 'video' && finalizeData.processing_state === 'pending') {
      await this.pollMediaProcessing(mediaId);
    }

    this.log('info', 'uploadMedia', `Media FINALIZE complete`, { mediaId });

    return mediaId;
  }

  /**
   * Poll media processing status for videos.
   */
  private async pollMediaProcessing(mediaId: string): Promise<void> {
    const maxAttempts = 30;
    const pollIntervalMs = 2_000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const statusResp = await this.fetchImpl(
        `${TWITTER_UPLOAD_BASE}/media/upload.json?command=STATUS&media_id=${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${this.auth.accessToken}`,
          },
        },
      );

      if (!statusResp.ok) {
        this.log('warn', 'pollMediaProcessing', `Status check failed on attempt ${attempt}`);
        continue;
      }

      const statusData = await readResponseJson<{
        processing_info?: {
          state: 'pending' | 'in_progress' | 'succeeded' | 'failed';
          progress_percent?: number;
          error?: { code: number; name: string; message: string };
        };
      }>(statusResp);

      const info = statusData.processing_info;

      if (!info) {
        // No processing info means processing is complete
        return;
      }

      if (info.state === 'succeeded') {
        return;
      }

      if (info.state === 'failed') {
        throw new Error(`X media processing failed: ${info.error?.message ?? 'Unknown error'}`);
      }

      this.log('info', 'pollMediaProcessing', `Media processing ${info.state}`, {
        mediaId,
        progress: info.progress_percent,
      });
    }

    throw new Error(`X media processing timed out for media_id ${mediaId}`);
  }
}

export default XConnector;
