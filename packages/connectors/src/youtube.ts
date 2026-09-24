// ─── YouTube Connector ───
// Uses the YouTube Data API v3 with resumable uploads, shorts detection, and OAuth management.

import { randomUUID } from 'node:crypto';

import {
  BaseConnector,
  CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
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
  SocialOperationInput,
  SocialOperationResult,
  YouTubePlaylist,
  YouTubeCaptionTrack,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { validatePublish } from './validation.js';

const YT_API_BASE = 'https://www.googleapis.com';
const YT_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';
// This implementation buffers the source before opening the resumable upload
// session; advertise and enforce the actual bounded implementation limit
// instead of the provider's much larger theoretical maximum.
const YOUTUBE_MAX_BUFFERED_MEDIA_BYTES = 536_870_912;

function isSquareOrVerticalAspectRatio(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length === 2) {
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= height;
  }
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio > 0 && ratio <= 1;
}

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

interface YtAnalyticsReportResponse {
  columnHeaders?: Array<{ name: string; columnType?: string; dataType?: string }>;
  rows?: Array<Array<number | string>>;
}
interface YtCommentThreadsResponse {
  nextPageToken?: string;
  items?: Array<{
    id: string;
    snippet?: {
      videoId?: string;
      topLevelComment?: { id?: string; snippet?: { textDisplay?: string; authorDisplayName?: string; authorChannelId?: { value?: string }; publishedAt?: string } };
    };
  }>;
}
interface YtPlaylistListResponse {
  nextPageToken?: string;
  items?: Array<{ id?: string; snippet?: { title?: string; description?: string }; status?: { privacyStatus?: 'private' | 'public' | 'unlisted' } }>;
}
interface YtCaptionListResponse {
  items?: Array<{ id?: string; snippet?: { language?: string; name?: string; status?: string; isDraft?: boolean } }>;
}
interface YtInsertedResource { id?: string; }

export class YouTubeConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('youtube' as Platform, 'YouTube', 'api' as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    const canPublish = this.hasGrantedScope('https://www.googleapis.com/auth/youtube.upload');
    const canReadMetrics = this.hasGrantedScope('https://www.googleapis.com/auth/yt-analytics.readonly');
    return {
      publish: canPublish,
      media: canPublish ? ['video' as MediaType, 'short' as MediaType] : [],
      maxMediaBytes: YOUTUBE_MAX_BUFFERED_MEDIA_BYTES,
      maxMediaCount: 1,
      caption: true,
      maxCaptionLength: 5_000,
      // The worker owns the scheduled slot; the upload path does not send a
      // future publishAt value to YouTube.
      scheduling: 'internal' as const,
      metrics: canReadMetrics ? ['views', 'likes', 'comments'] : [],
      refreshMetrics: canReadMetrics,
      operations: [
        ...(this.hasGrantedScope('https://www.googleapis.com/auth/youtube.force-ssl')
          ? ['comments.read' as const, 'comments.reply' as const, 'comments.moderate' as const,
            'youtube.playlist.create' as const, 'youtube.playlist.add-video' as const,
            'youtube.playlist.remove-video' as const, 'youtube.captions.upload' as const,
            'youtube.captions.delete' as const]
          : []),
        ...(this.hasGrantedScope('https://www.googleapis.com/auth/youtube.readonly')
          ? ['youtube.playlists.read' as const, 'youtube.captions.list' as const]
          : []),
        ...(canPublish ? ['youtube.thumbnail.set' as const] : []),
      ],
      moderationActions: this.hasGrantedScope('https://www.googleapis.com/auth/youtube.force-ssl')
        ? ['hide', 'delete', 'approve', 'reject']
        : [],
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      this.assertGrantedScope('publishing', 'https://www.googleapis.com/auth/youtube.upload');
      const videoUrl = input.mediaUrls[0];
      if (!videoUrl) {
        throw new Error('YouTube requires exactly one video URL');
      }

      // Detect if this is a Short based on options
      const durationSec = (input.options?.durationSec as number) ?? 0;
      const aspectRatio = (input.options?.aspectRatio as string) ?? '16:9';
      const isShort = durationSec > 0 && durationSec <= 180 && isSquareOrVerticalAspectRatio(aspectRatio);

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

      // Download before opening the resumable session so the session metadata
      // contains the actual byte count and MIME type. The worker does not
      // have a videoSize option; sending an empty X-Upload-Content-Length
      // header causes the provider contract to reject the session.
      const videoResponse = await this.fetchImpl(videoUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video from ${videoUrl}: ${videoResponse.status}`);
      }

      const videoBuffer = await readResponseBytes(
        videoResponse,
        YOUTUBE_MAX_BUFFERED_MEDIA_BYTES,
        'YouTube video',
      );
      if (videoBuffer.byteLength === 0) {
        throw new Error('YouTube video must not be empty');
      }
      const responseContentType = videoResponse.headers.get('content-type')?.split(';', 1)[0];
      const uploadContentType =
        responseContentType === 'application/octet-stream' ||
        responseContentType?.startsWith('video/')
          ? responseContentType
          : 'video/*';

      // Step 1: Initiate resumable upload session
      const metadataJson = JSON.stringify(metadata);

      const initResponse = await this.fetchImpl(
        `${YT_UPLOAD_BASE}/videos?part=snippet,status&uploadType=resumable`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.auth.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(videoBuffer.byteLength),
            'X-Upload-Content-Type': uploadContentType,
          },
          body: metadataJson,
        },
      );

      if (!initResponse.ok) {
        const initBody = await readResponseText(
          initResponse,
          CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
          'provider error response',
        ).catch(() => '');
        throw new Error(
          `YouTube resumable upload init failed: ${initResponse.status} — ${redactProviderText(initBody)}`,
        );
      }

      const uploadUrl = initResponse.headers.get('Location');
      if (!uploadUrl) {
        throw new Error('YouTube did not return a Location header for resumable upload');
      }

      this.log('info', 'publish', `YouTube resumable upload session created`);

      const uploadResp = await this.fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': uploadContentType,
          'Content-Length': String(videoBuffer.byteLength),
        },
        body: videoBuffer,
      });

      if (!uploadResp.ok) {
        const uploadBody = await readResponseText(
          uploadResp,
          CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
          'provider error response',
        ).catch(() => '');
        throw new Error(
          `YouTube video upload failed: ${uploadResp.status} ${uploadResp.statusText} — ${redactProviderText(uploadBody)}`,
        );
      }

      const videoData = await readResponseJson<YtVideoResponse>(uploadResp);
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

  async fetchMetrics(remoteId: string, period: MetricPeriod = 'month'): Promise<ConnectorMetrics> {
    this.assertGrantedScope('metrics', 'https://www.googleapis.com/auth/yt-analytics.readonly');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(remoteId)) throw new Error('YouTube video ID is invalid');
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const days = period === 'day' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : null;
    const start = days === null ? new Date('2005-04-23T00:00:00.000Z') : new Date(end.getTime() - (days - 1) * 86_400_000);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const url = new URL(`${YT_API_BASE}/youtube/analytics/v2/reports`);
    url.searchParams.set('ids', 'channel==MINE');
    url.searchParams.set('startDate', date(start));
    url.searchParams.set('endDate', date(end));
    url.searchParams.set('metrics', 'views,likes,comments');
    url.searchParams.set('dimensions', 'video');
    url.searchParams.set('filters', `video==${remoteId}`);
    const resp = await this.apiGet<YtAnalyticsReportResponse>(url.toString(), {
      Authorization: `Bearer ${this.auth.accessToken}`,
    });
    const row = resp.rows?.[0];
    const columns = resp.columnHeaders?.map((column) => column.name) ?? [];
    const value = (name: string) => {
      const index = columns.indexOf(name);
      return index >= 0 && typeof row?.[index] === 'number' ? row[index] as number : 0;
    };

    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        views: value('views'),
        likes: value('likes'),
        comments: value('comments'),
      },
      raw: { period, startDate: date(start), endDate: date(end), columns, row: row ?? null },
    };
  }

  async executeOperation(operation: SocialOperationInput): Promise<SocialOperationResult> {
    if (!this.capability().operations?.includes(operation.type)) {
      throw new Error(`YouTube ${operation.type} is unavailable: required permission was not granted`);
    }
    const readOnly = operation.type === 'youtube.playlists.read' || operation.type === 'youtube.captions.list';
    this.assertGrantedScope(operation.type,
      ...(readOnly
        ? ['https://www.googleapis.com/auth/youtube.readonly']
        : operation.type === 'youtube.thumbnail.set'
          ? ['https://www.googleapis.com/auth/youtube.upload']
          : ['https://www.googleapis.com/auth/youtube.force-ssl']));
    if (operation.type === 'comments.read') {
      const url = new URL(`${YT_API_BASE}/youtube/v3/commentThreads`);
      url.searchParams.set('part', 'snippet,replies');
      url.searchParams.set('videoId', operation.postId);
      url.searchParams.set('maxResults', String(operation.limit ?? 50));
      if (operation.cursor) url.searchParams.set('pageToken', operation.cursor);
      const response = await this.apiGet<YtCommentThreadsResponse>(url.toString());
      return {
        type: 'comments',
        items: (response.items ?? []).flatMap((item) => {
          const comment = item.snippet?.topLevelComment;
          if (!comment?.id) return [];
          return [{
            id: comment.id,
            postId: item.snippet?.videoId ?? operation.postId,
            text: comment.snippet?.textDisplay ?? '',
            ...(comment.snippet?.authorChannelId?.value ? { authorId: comment.snippet.authorChannelId.value } : {}),
            ...(comment.snippet?.authorDisplayName ? { authorName: comment.snippet.authorDisplayName } : {}),
            ...(comment.snippet?.publishedAt ? { createdAt: comment.snippet.publishedAt } : {}),
          }];
        }),
        ...(response.nextPageToken ? { nextCursor: response.nextPageToken } : {}),
      };
    }
    if (operation.type === 'comments.reply') {
      const response = await this.apiPost<{ id?: string }>(`${YT_API_BASE}/youtube/v3/comments?part=snippet`, {
        snippet: { parentId: operation.commentId, textOriginal: operation.text },
      });
      return { type: 'mutation', success: true, ...(response.id ? { remoteId: response.id } : {}) };
    }
    if (operation.type === 'comments.moderate') {
      if (operation.action === 'delete') {
        await this.apiDelete(`${YT_API_BASE}/youtube/v3/comments?id=${encodeURIComponent(operation.commentId)}`);
      } else if (operation.action === 'hide' || operation.action === 'reject') {
        const url = `${YT_API_BASE}/youtube/v3/comments/setModerationStatus?id=${encodeURIComponent(operation.commentId)}&moderationStatus=rejected`;
        await this.apiPost(url);
      } else if (operation.action === 'approve') {
        const url = `${YT_API_BASE}/youtube/v3/comments/setModerationStatus?id=${encodeURIComponent(operation.commentId)}&moderationStatus=published`;
        await this.apiPost(url);
      } else {
        throw new Error(`YouTube does not support comment action '${operation.action}'`);
      }
      return { type: 'mutation', success: true, remoteId: operation.commentId };
    }
    if (operation.type === 'youtube.playlists.read') {
      const url = new URL(`${YT_API_BASE}/youtube/v3/playlists`);
      url.searchParams.set('part', 'snippet,status');
      url.searchParams.set('mine', 'true');
      url.searchParams.set('maxResults', String(operation.limit ?? 50));
      if (operation.cursor) url.searchParams.set('pageToken', operation.cursor);
      const response = await this.apiGet<YtPlaylistListResponse>(url.toString());
      const items: YouTubePlaylist[] = (response.items ?? []).flatMap(item => typeof item.id === 'string' ? [{
        id: item.id,
        title: item.snippet?.title ?? '',
        ...(item.snippet?.description ? { description: item.snippet.description } : {}),
        ...(item.status?.privacyStatus ? { privacyStatus: item.status.privacyStatus } : {}),
      }] : []);
      return { type: 'youtube.playlists', items, ...(response.nextPageToken ? { nextCursor: response.nextPageToken } : {}) };
    }
    if (operation.type === 'youtube.playlist.create') {
      const title = operation.title.trim();
      if (!title || title.length > 150) throw new Error('YouTube playlist title must contain 1–150 characters');
      if ((operation.description?.length ?? 0) > 5_000) throw new Error('YouTube playlist description is too long');
      const response = await this.apiPost<YtPlaylistListResponse & { id?: string }>(
        `${YT_API_BASE}/youtube/v3/playlists?part=snippet,status`,
        { snippet: { title, description: operation.description ?? '' }, status: { privacyStatus: operation.privacyStatus } },
      );
      if (!response.id) throw new Error('YouTube did not return a created playlist ID');
      return { type: 'mutation', success: true, remoteId: response.id };
    }
    if (operation.type === 'youtube.playlist.add-video') {
      const response = await this.apiPost<YtInsertedResource>(`${YT_API_BASE}/youtube/v3/playlistItems?part=snippet`, {
        snippet: {
          playlistId: operation.playlistId,
          position: operation.position,
          resourceId: { kind: 'youtube#video', videoId: operation.videoId },
        },
      });
      if (!response.id) throw new Error('YouTube did not return a playlist-item ID');
      return { type: 'mutation', success: true, remoteId: response.id };
    }
    if (operation.type === 'youtube.playlist.remove-video') {
      await this.apiDelete(`${YT_API_BASE}/youtube/v3/playlistItems?id=${encodeURIComponent(operation.playlistItemId)}`);
      return { type: 'mutation', success: true, remoteId: operation.playlistItemId };
    }
    if (operation.type === 'youtube.thumbnail.set') {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(operation.videoId)) throw new Error('YouTube video ID is invalid');
      const response = await this.fetchImpl(operation.mediaUrl);
      if (!response.ok) throw new Error(`YouTube thumbnail download failed: HTTP ${response.status}`);
      const bytes = await readResponseBytes(response, 2 * 1024 * 1024, 'YouTube thumbnail');
      if (!bytes.byteLength) throw new Error('YouTube thumbnail must not be empty');
      const contentType = operation.mimeType ?? response.headers.get('content-type')?.split(';', 1)[0];
      if (contentType !== 'image/jpeg' && contentType !== 'image/png') throw new Error('YouTube thumbnail must be JPEG or PNG');
      const url = new URL(`${YT_UPLOAD_BASE}/thumbnails/set`);
      url.searchParams.set('videoId', operation.videoId);
      url.searchParams.set('uploadType', 'media');
      const uploaded = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.auth.accessToken}`, 'Content-Type': contentType, 'Content-Length': String(bytes.byteLength) },
        body: bytes,
      });
      if (!uploaded.ok) {
        const text = await readResponseText(uploaded, CONNECTOR_MAX_ERROR_RESPONSE_BYTES, 'provider error response').catch(() => '');
        throw new Error(`YouTube thumbnail upload failed: ${uploaded.status} — ${redactProviderText(text)}`);
      }
      await readResponseJson<unknown>(uploaded);
      return { type: 'mutation', success: true, remoteId: operation.videoId };
    }
    if (operation.type === 'youtube.captions.list') {
      const url = new URL(`${YT_API_BASE}/youtube/v3/captions`);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('videoId', operation.videoId);
      const response = await this.apiGet<YtCaptionListResponse>(url.toString());
      const items: YouTubeCaptionTrack[] = (response.items ?? []).flatMap(item => typeof item.id === 'string' ? [{
        id: item.id,
        language: item.snippet?.language ?? '',
        ...(item.snippet?.name ? { name: item.snippet.name } : {}),
        ...(item.snippet?.status ? { status: item.snippet.status } : {}),
        ...(typeof item.snippet?.isDraft === 'boolean' ? { isDraft: item.snippet.isDraft } : {}),
      }] : []);
      return { type: 'youtube.captions', items };
    }
    if (operation.type === 'youtube.captions.upload') {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(operation.videoId)) throw new Error('YouTube video ID is invalid');
      if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(operation.language)) throw new Error('YouTube caption language must be a BCP-47 language tag');
      const captionResponse = await this.fetchImpl(operation.mediaUrl);
      if (!captionResponse.ok) throw new Error(`YouTube caption download failed: HTTP ${captionResponse.status}`);
      const captionBytes = await readResponseBytes(captionResponse, 10 * 1024 * 1024, 'YouTube caption file');
      if (!captionBytes.byteLength) throw new Error('YouTube caption file must not be empty');
      const url = new URL(`${YT_UPLOAD_BASE}/captions`);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('uploadType', 'multipart');
      const boundary = `axiom-${randomUUID()}`;
      const encoder = new TextEncoder();
      const metadata = JSON.stringify({
        snippet: {
          videoId: operation.videoId,
          language: operation.language,
          name: operation.name,
          isDraft: operation.isDraft ?? false,
        },
      });
      const prefix = encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
      );
      const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
      const body = new Blob([prefix, captionBytes, suffix]);
      const response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.auth.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      });
      if (!response.ok) {
        const text = await readResponseText(response, CONNECTOR_MAX_ERROR_RESPONSE_BYTES, 'provider error response').catch(() => '');
        this.log('error', 'captions.upload', `HTTP ${response.status}: ${redactProviderText(text)}`);
        throw new Error(`YouTube caption upload failed: ${response.status} ${response.statusText}`);
      }
      const inserted = await readResponseJson<YtInsertedResource>(response);
      if (!inserted.id) throw new Error('YouTube did not return a caption track ID');
      return { type: 'mutation', success: true, remoteId: inserted.id };
    }
    if (operation.type === 'youtube.captions.delete') {
      await this.apiDelete(`${YT_API_BASE}/youtube/v3/captions?id=${encodeURIComponent(operation.captionId)}`);
      return { type: 'mutation', success: true, remoteId: operation.captionId };
    }
    throw new Error(`YouTube does not support ${operation.type}`);
  }

  async revoke(): Promise<void> {
    const token = this.auth.accessToken;

    // Revoke the OAuth token at Google's revocation endpoint
    const revokeUrl = 'https://oauth2.googleapis.com/revoke';

    const response = await this.fetchImpl(revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token }),
    });

    if (!response.ok) {
      const body = await readResponseText(
        response,
        CONNECTOR_MAX_ERROR_RESPONSE_BYTES,
        'provider error response',
      ).catch(() => '');
      throw new Error(
        `YouTube token revocation failed: HTTP ${response.status} — ${redactProviderText(body)}`,
      );
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
