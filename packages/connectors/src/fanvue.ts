// ─── Fanvue Connector (real Fanvue API v2025-06-26) ───
// Targets https://api.fanvue.com with OAuth 2.0 Bearer tokens and the
// required X-Fanvue-API-Version header. Media upload uses the documented
// S3 multipart flow: create session → presigned part URLs → PUT parts →
// complete session → mediaUuid; posts are created via POST /posts.
// Token refresh (Ory client_secret_basic) is supported when refresh
// credentials are supplied, so short-lived (1h) access tokens stay valid.

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

const FANVUE_API_BASE = 'https://api.fanvue.com';
const FANVUE_API_VERSION = '2025-06-26';
const FANVUE_TOKEN_URL = 'https://auth.fanvue.com/oauth2/token';
const FANVUE_REVOKE_URL = 'https://auth.fanvue.com/oauth2/revoke';

/** Media type allowed by the upload session API. */
type FanvueMediaType = 'image' | 'video' | 'audio' | 'document';

interface FanvueUploadSession {
  mediaUuid: string;
  uploadId: string;
  partSize: number;
  maxParts: number;
  totalParts: number | null;
}

interface FanvuePost {
  uuid: string;
  createdAt: string;
  text: string | null;
  price: number | null;
  audience: 'subscribers' | 'followers-and-subscribers';
  publishAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  mediaUuids?: string[];
  likesCount?: number;
  commentsCount?: number;
  tips?: { count: number; totalGross: number; totalNet: number };
}

interface FanvueUser {
  uuid: string;
  handle: string;
  displayName?: string;
  isCreator?: boolean;
}

/** A completed S3 part, carrying the ETag returned by the presigned PUT. */
interface CompletedPart {
  partNumber: number;
  etag: string;
}

export class FanvueConnector extends BaseConnector implements SocialConnector {
  private modelId: string;
  private refreshToken?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly tokenExpiresAt?: number;

  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('fanvue' as Platform, 'Fanvue', 'api' as PublishMode, auth, fetchImpl);
    this.modelId = auth.externalUserId || '';
    this.refreshToken = auth.refreshToken;
    this.clientId = (auth.extra as Record<string, unknown> | undefined)?.['clientId'] as
      string | undefined;
    this.clientSecret = (auth.extra as Record<string, unknown> | undefined)?.['clientSecret'] as
      string | undefined;
    this.tokenExpiresAt = auth.expiresAt;
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['image' as MediaType, 'video' as MediaType, 'audio' as MediaType],
      maxMediaBytes: 1_610_612_736, // 1.5 GiB — API limit (sizeBytes <= 1610612736)
      maxMediaCount: 10,
      caption: true,
      maxCaptionLength: 5000, // text max length per API reference
      scheduling: 'internal' as const,
      metrics: ['likes' as const, 'comments' as const],
      refreshMetrics: true,
    };
  }

  // ── Token refresh (Ory client_secret_basic) ──

  /**
   * Exchange the refresh token for a fresh access token using the Ory token
   * endpoint. Returns the new access token and expiry (epoch seconds).
   * Throws if refresh credentials are absent or the exchange fails.
   */
  async refreshAccessToken(): Promise<{ accessToken: string; expiresAt: number }> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Fanvue token refresh requires refreshToken + clientId + clientSecret');
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const resp = await this.fetchImpl(FANVUE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // NOTE: scope intentionally omitted — requesting scopes beyond the
      // original authorization grant makes Ory reject the refresh (400).
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      this.log('error', 'refresh', `HTTP ${resp.status}: ${body}`);
      throw new Error(`Fanvue token refresh failed: ${resp.status} ${resp.statusText}`);
    }

    const tokens: Record<string, unknown> = (await resp.json()) as Record<string, unknown>;
    const accessToken = typeof tokens['access_token'] === 'string' ? tokens['access_token'] : '';
    const expiresIn = typeof tokens['expires_in'] === 'number' ? tokens['expires_in'] : 3600;
    if (!accessToken) {
      throw new Error('Fanvue token refresh returned no access_token');
    }

    // Ory ROTATES the refresh token on every grant — the old one is revoked
    // immediately. Adopt the rotated token so the next refresh keeps working.
    const rotatedRefresh =
      typeof tokens['refresh_token'] === 'string' && tokens['refresh_token']
        ? tokens['refresh_token']
        : undefined;
    if (rotatedRefresh) {
      this.refreshToken = rotatedRefresh;
      this.auth.refreshToken = rotatedRefresh;
    }

    this.auth.accessToken = accessToken;
    this.auth.expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    return { accessToken, expiresAt: this.auth.expiresAt };
  }

  /** Whether a stored refresh token is usable. */
  canRefresh(): boolean {
    return Boolean(this.refreshToken && this.clientId && this.clientSecret);
  }

  /** Refresh if the current token is expired (or within 60s of expiry). */
  private async ensureFreshToken(): Promise<void> {
    if (!this.tokenExpiresAt && !this.auth.expiresAt) return;
    const exp = this.auth.expiresAt ?? this.tokenExpiresAt ?? 0;
    if (Date.now() / 1000 > exp - 60) {
      if (!this.canRefresh()) {
        throw new Error('Fanvue access token expired and no refresh credentials available');
      }
      await this.refreshAccessToken();
    }
  }

  // ── Request helpers (real API surface) ──

  private fanvueHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.auth.accessToken}`,
      'Content-Type': 'application/json',
      'X-Fanvue-API-Version': FANVUE_API_VERSION,
    };
  }

  private async fanvueRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    rawText = false,
  ): Promise<T> {
    await this.ensureFreshToken();
    const response = await this.fetchImpl(`${FANVUE_API_BASE}${path}`, {
      method,
      headers: this.fanvueHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      this.log('error', method, `HTTP ${response.status}: ${responseBody}`, { path });
      throw new Error(
        `Fanvue API ${method} ${path} failed: ${response.status} ${response.statusText}`,
      );
    }

    if (response.status === 204) return undefined as T;
    if (rawText) return (await response.text()) as T;
    return response.json() as Promise<T>;
  }

  /** Determine media type from a URL path extension (defaults to image). */
  private mediaTypeFromUrl(url: string): FanvueMediaType {
    const path = url.split('?')[0].toLowerCase();
    if (/\.(mp4|mov|avi|webm|mkv)$/.test(path)) return 'video';
    if (/\.(mp3|wav|m4a|aac|flac)$/.test(path)) return 'audio';
    if (/\.(pdf|docx?|xlsx?|txt)$/.test(path)) return 'document';
    return 'image';
  }

  /** Download remote media bytes (bounded) for the multipart upload. */
  private async downloadMedia(url: string): Promise<Uint8Array> {
    const resp = await this.fetchImpl(url, { method: 'GET' });
    if (!resp.ok) {
      throw new Error(`Fanvue media download failed: ${resp.status} ${resp.statusText} (${url})`);
    }
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Upload one remote media URL via the documented multipart flow and return
   * the mediaUuid. Requires the creator uuid for the presigned part URLs.
   */
  private async uploadMedia(url: string, creatorUuid: string): Promise<string> {
    const bytes = await this.downloadMedia(url);

    const name = url.split('/').pop()?.split('?')[0] || 'media';
    const filename = name.length <= 255 ? name : name.slice(-255);
    const mediaType = this.mediaTypeFromUrl(url);

    const session = await this.fanvueRequest<FanvueUploadSession>('POST', '/media/uploads', {
      name: filename,
      filename,
      mediaType,
      sizeBytes: bytes.length,
    });

    const parts = Math.max(1, session.totalParts ?? Math.ceil(bytes.length / session.partSize));
    const completed: CompletedPart[] = [];

    for (let partNumber = 1; partNumber <= parts; partNumber++) {
      const signedUrl = await this.fanvueRequest<string>(
        'GET',
        `/creators/${creatorUuid}/media/uploads/${session.uploadId}/parts/${partNumber}/url`,
        undefined,
        true,
      );

      const start = (partNumber - 1) * session.partSize;
      const end = Math.min(bytes.length, partNumber * session.partSize);
      const partBytes = bytes.slice(start, end);

      const putRes = await this.fetchImpl(signedUrl, {
        method: 'PUT',
        body: partBytes,
      });
      if (!putRes.ok) {
        const body = await putRes.text().catch(() => '');
        throw new Error(`Fanvue part ${partNumber} upload failed: ${putRes.status} ${body}`);
      }
      const etag = putRes.headers.get('etag') || '';
      completed.push({ partNumber, etag });
    }

    await this.fanvueRequest<{ status: string }>('PATCH', `/media/uploads/${session.uploadId}`, {
      parts: completed,
    });

    this.log('info', 'upload', `Fanvue media uploaded: ${session.mediaUuid}`);
    return session.mediaUuid;
  }

  // ── Connector interface ──

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    const errors = [];

    if (!input.mediaUrls || input.mediaUrls.length === 0) {
      errors.push({
        field: 'mediaUrls',
        message: 'Fanvue requires at least one media file',
        severity: 'error' as const,
      });
    }
    if (!input.caption) {
      errors.push({
        field: 'caption',
        message: 'Fanvue posts require a caption',
        severity: 'error' as const,
      });
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
      // Resolve the creator uuid (needed for presigned part URLs).
      let creatorUuid = this.modelId;
      if (!creatorUuid) {
        const me = await this.fanvueRequest<FanvueUser>('GET', '/users/me');
        creatorUuid = me.uuid;
        this.modelId = me.uuid;
      }

      // 1. Upload each media URL → mediaUuid list.
      const mediaUuids: string[] = [];
      for (const mediaUrl of input.mediaUrls) {
        const mediaUuid = await this.uploadMedia(mediaUrl, creatorUuid);
        mediaUuids.push(mediaUuid);
      }

      // 2. Create the post (audience defaults to followers-and-subscribers).
      const audience =
        (input.options?.['audience'] as 'subscribers' | 'followers-and-subscribers' | undefined) ??
        'followers-and-subscribers';
      const post = await this.fanvueRequest<FanvuePost>('POST', '/posts', {
        audience,
        text: input.caption,
        mediaUuids,
        publishAt: input.scheduledFor ?? null,
      });

      this.log('info', 'publish', `Fanvue post created: ${post.uuid}`);

      return {
        remoteId: post.uuid,
        state: 'published',
        postUrl: `https://fanvue.com/post/${post.uuid}`,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const post = await this.fanvueRequest<FanvuePost>('GET', `/posts/${remoteId}`);

    return {
      postId: remoteId,
      platform: 'fanvue' as Platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        likes: post.likesCount ?? 0,
        comments: post.commentsCount ?? 0,
      },
      raw: {
        tips: post.tips ?? null,
        price: post.price ?? null,
        audience: post.audience,
        publishedAt: post.publishedAt ?? null,
      },
    };
  }

  async revoke(): Promise<void> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      this.log('warn', 'revoke', 'Fanvue revoke skipped: no refresh token/client credentials');
      return;
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const resp = await this.fetchImpl(FANVUE_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: this.refreshToken,
        token_type_hint: 'refresh_token',
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      this.log('error', 'revoke', `HTTP ${resp.status}: ${body}`);
      return;
    }

    this.log('info', 'revoke', 'Fanvue refresh token revoked (Ory RFC 7009)');
  }
}
