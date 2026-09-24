// Snapchat Public Profile API Stories with an explicit Creative Kit/manual
// handoff when the account or app is not approved for automatic publishing.

import { createCipheriv, randomBytes } from 'node:crypto';
import { BaseConnector, readResponseBytes } from './base.js';
import type {
  SocialConnector,
  ConnectorAuth,
  ConnectorPublishInput,
  ConnectorPublishResult,
  ConnectorCapability,
  ConnectorMetrics,
  MetricPeriod,
  ValidationReport,
  RelayHandoff,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { validatePublish } from './validation.js';

const SNAP_API_ORIGIN = 'https://businessapi.snapchat.com';
const SNAP_API_BASE = `${SNAP_API_ORIGIN}/v1`;
const SNAP_PUBLIC_PROFILE_SCOPE = 'snapchat-profile-api';
const MAX_UPLOAD_BYTES = 32_000_000;
const PENDING_PREFIX = 'snap-story-pending:';

type SnapEnvelope<T extends Record<string, unknown>> = T & {
  request_status?: 'SUCCESS' | 'ERROR' | 'PARTIAL';
  request_id?: string;
  display_message?: string;
  debug_message?: string;
  error_code?: string;
};

type SnapStory = { id?: string; created_at?: string; profile_id?: string };
type SnapStoriesEnvelope = SnapEnvelope<{
  stories?: Array<{ sub_request_status?: string; story?: SnapStory }>;
  paging?: { next_page_id?: string };
}>;

type PendingStory = { requestId: string; startedAt: string; knownStoryIds: string[] };

function profileId(auth: ConnectorAuth): string | undefined {
  const value = auth.extra?.snapchatProfileId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isApiReady(auth: ConnectorAuth): boolean {
  const grantedScopes = auth.extra?.grantedScopes;
  return !!auth.accessToken
    && !!profileId(auth)
    && Array.isArray(grantedScopes)
    && grantedScopes.includes(SNAP_PUBLIC_PROFILE_SCOPE);
}

function isVideoInput(input: ConnectorPublishInput): boolean {
  if (input.options?.mediaType === 'video') return true;
  try { return /\.mp4$/i.test(new URL(input.mediaUrls[0] ?? '').pathname); }
  catch { return false; }
}

function snapchatVideoMetadata(input: ConnectorPublishInput): {
  errors: string[];
  missing: string[];
} {
  const errors: string[] = [];
  const missing: string[] = [];
  const mimeType = input.options?.mediaMimeType;
  const duration = input.options?.mediaDurationSeconds;
  const width = input.options?.mediaWidth;
  const height = input.options?.mediaHeight;
  if (mimeType === undefined || mimeType === null) missing.push('video MIME type');
  else if (mimeType !== 'video/mp4') errors.push('Snapchat Story video must be MP4');
  if (duration === undefined || duration === null) missing.push('video duration');
  else if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 5 || duration > 60) {
    errors.push('Snapchat Story video duration must be between 5 and 60 seconds');
  }
  if (width === undefined || width === null || height === undefined || height === null) {
    missing.push('video dimensions');
  } else if (typeof width !== 'number' || typeof height !== 'number'
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 540 || height < 960) {
    errors.push('Snapchat Story video resolution must be at least 540x960');
  }
  return { errors, missing };
}

function parsePending(value: unknown): PendingStory | undefined {
  if (typeof value !== 'string' || !value.startsWith(PENDING_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(PENDING_PREFIX.length), 'base64url').toString('utf8')) as Partial<PendingStory>;
    if (typeof parsed.requestId !== 'string' || typeof parsed.startedAt !== 'string' || !Array.isArray(parsed.knownStoryIds)) return undefined;
    return {
      requestId: parsed.requestId,
      startedAt: parsed.startedAt,
      knownStoryIds: parsed.knownStoryIds.filter((id): id is string => typeof id === 'string').slice(0, 100),
    };
  } catch {
    return undefined;
  }
}

function pendingId(value: PendingStory): string {
  return `${PENDING_PREFIX}${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
}

function successful<T extends Record<string, unknown>>(body: SnapEnvelope<T>, operation: string): void {
  if (body.request_status !== 'SUCCESS') {
    const reason = body.display_message ?? body.error_code ?? body.debug_message ?? body.request_status ?? 'unknown provider response';
    throw new Error(`Snapchat ${operation} failed: ${String(reason).slice(0, 300)}`);
  }
}

function sameSnapOrigin(path: string): string {
  const url = new URL(path, SNAP_API_ORIGIN);
  if (url.origin !== SNAP_API_ORIGIN || !url.pathname.startsWith('/')) {
    throw new Error('Snapchat returned an unsafe upload path');
  }
  return url.toString();
}

export class SnapchatConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('snapchat' as Platform, 'Snapchat', (isApiReady(auth) ? 'api' : 'assisted') as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    const automatic = isApiReady(this.auth);
    return {
      publish: true,
      media: ['image', 'video', 'story'],
      maxMediaBytes: MAX_UPLOAD_BYTES,
      maxMediaCount: 1,
      caption: false,
      maxCaptionLength: 0,
      scheduling: 'none',
      metrics: automatic ? ['views', 'reach', 'favorites'] : [],
      refreshMetrics: automatic,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    const report = validatePublish(input, {
      ...this.capability(),
      maxCaptionLength: Number.MAX_SAFE_INTEGER,
    });
    if (input.caption && input.caption.length > 100) {
      report.warnings.push({ field: 'caption', message: 'Snapchat story captions are not supported by this publishing endpoint; the text will be included only in manual handoff instructions.', severity: 'warning' });
    }
    if (isVideoInput(input)) {
      const requirements = snapchatVideoMetadata(input);
      for (const message of requirements.errors) {
        report.errors.push({ field: 'media', message, severity: 'error' });
      }
      if (requirements.missing.length > 0) {
        const message = `Snapchat Story video eligibility cannot be verified without ${requirements.missing.join(', ')}`;
        if (isApiReady(this.auth)) report.errors.push({ field: 'media', message, severity: 'error' });
        else report.infos.push({ field: 'media', message, severity: 'info' });
      }
    }
    if (!isApiReady(this.auth)) {
      report.infos.push({ field: 'general', message: 'Automatic Story publishing requires an approved Snap Public Profile API app and connected Public Profile. This connection will create a human-assisted handoff.', severity: 'info' });
    }
    report.valid = report.errors.length === 0;
    report.tosVerdict = report.valid ? (report.warnings.length > 0 ? 'flag' : 'pass') : 'block';
    return report;
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const validation = await this.validate(input);
      if (!validation.valid) throw new Error(`Snapchat publish validation failed: ${validation.errors.map(error => error.message).join('; ')}`);
      if (!isApiReady(this.auth)) {
        const profileUrl = this.auth.extra?.snapchatProfileUrl;
        const handoff: RelayHandoff = {
          platform: 'snapchat' as Platform,
          type: 'assisted_publish',
          instructions: 'Open Snapchat, select the supplied media, publish it to the intended Story, then reconcile this handoff in AXIOM. AXIOM does not claim the Story was published until you confirm it.',
          assets: [...input.mediaUrls],
          caption: input.caption,
          ...(typeof profileUrl === 'string' && profileUrl.startsWith('https://www.snapchat.com/') ? { handoffUrl: profileUrl } : {}),
        };
        this.log('info', 'publish', 'Created Snapchat manual-assist handoff; no provider request was made');
        return { remoteId: null, state: 'manual_assist', error: 'Human action required; see the persisted manual-assist handoff.', handoff };
      }
      return this.publishStory(input);
    });
  }

  private async publishStory(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    const profile = profileId(this.auth);
    if (!profile) throw new Error('Snapchat Public Profile ID is required');
    const pending = parsePending(input.options?.publishId);
    if (pending) {
      const stories = await this.listStories(profile);
      const known = new Set(pending.knownStoryIds);
      const story = stories.find(item => item.id && !known.has(item.id) && item.created_at && Date.parse(item.created_at) >= Date.parse(pending.startedAt) - 30_000);
      if (story?.id) return { remoteId: story.id, state: 'published', postUrl: `https://www.snapchat.com/add/${encodeURIComponent(String(this.auth.extra?.snapchatUsername ?? ''))}` };
      return { remoteId: pendingId(pending), state: 'pending', error: 'Snapchat accepted the Story request; the Public Profile API has not exposed the Story ID yet.' };
    }

    if (input.mediaUrls.length !== 1) throw new Error('Snapchat Public Profile Stories require exactly one image or video');
    const mediaResponse = await this.fetchImpl(input.mediaUrls[0]);
    if (!mediaResponse.ok) throw new Error(`Snapchat media source returned HTTP ${mediaResponse.status}`);
    const media = await readResponseBytes(mediaResponse, MAX_UPLOAD_BYTES, 'Snapchat story media');
    const mimeType = (mediaResponse.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const mediaType = mimeType.startsWith('video/') ? 'VIDEO' : mimeType.startsWith('image/') ? 'IMAGE' : undefined;
    if (!mediaType) throw new Error('Snapchat story media must have an image/* or video/* content type');
    if (mediaType === 'VIDEO' && mimeType !== 'video/mp4') {
      throw new Error('Snapchat Story video must be MP4');
    }

    const priorStories = await this.listStories(profile);
    const knownStoryIds = priorStories.flatMap(story => story.id ? [story.id] : []).slice(0, 100);
    const startedAt = new Date().toISOString();
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const encodedKey = key.toString('base64');
    const encodedIv = iv.toString('base64');
    let encrypted: Buffer;
    try {
      const cipher = createCipheriv('aes-256-cbc', key, iv);
      encrypted = Buffer.concat([cipher.update(media), cipher.final()]);
    } finally {
      media.fill(0);
    }

    let created: SnapEnvelope<{ media_id?: string; add_path?: string; finalize_path?: string }>;
    try {
      created = await this.snapJson<{ media_id?: string; add_path?: string; finalize_path?: string }>(
        `${SNAP_API_BASE}/public_profiles/${encodeURIComponent(profile)}/media`,
        { method: 'POST', headers: this.headers(), body: JSON.stringify({
          type: mediaType,
          name: `axiom-${input.idempotencyKey.slice(0, 48)}`,
          key: encodedKey,
          iv: encodedIv,
        }) },
        'create media',
      );
    } finally {
      key.fill(0);
      iv.fill(0);
    }
    if (!created.media_id || !created.add_path || !created.finalize_path) throw new Error('Snapchat create-media response omitted upload identifiers');

    const addForm = new FormData();
    addForm.set('action', 'ADD');
    addForm.set('part_number', '1');
    addForm.set('file', new Blob([encrypted], { type: 'application/octet-stream' }), 'media.enc');
    encrypted.fill(0);
    await this.snapJson<Record<string, unknown>>(sameSnapOrigin(created.add_path), { method: 'POST', headers: this.headers(), body: addForm }, 'upload media');

    const finalizeForm = new FormData();
    finalizeForm.set('action', 'FINALIZE');
    await this.snapJson<Record<string, unknown>>(sameSnapOrigin(created.finalize_path), { method: 'POST', headers: this.headers(), body: finalizeForm }, 'finalize media');

    const storyRequest = await this.snapJson<{ request_id?: string }>(
      `${SNAP_API_BASE}/public_profiles/${encodeURIComponent(profile)}/stories`,
      { method: 'POST', headers: this.headers(), body: JSON.stringify({ media_id: created.media_id }) },
      'create Story',
    );
    if (!storyRequest.request_id) throw new Error('Snapchat Story response omitted request_id');
    const pendingResult = { requestId: storyRequest.request_id, startedAt, knownStoryIds };
    const stories = await this.listStories(profile);
    const known = new Set(knownStoryIds);
    const story = stories.find(item => item.id && !known.has(item.id) && item.created_at && Date.parse(item.created_at) >= Date.parse(startedAt) - 30_000);
    if (story?.id) return { remoteId: story.id, state: 'published', postUrl: this.profileUrl() };
    return { remoteId: pendingId(pendingResult), state: 'pending', error: 'Snapchat accepted the Story request; waiting for the Public Profile API to expose its Story ID.' };
  }

  private profileUrl(): string | undefined {
    const username = this.auth.extra?.snapchatUsername;
    return typeof username === 'string' && username ? `https://www.snapchat.com/add/${encodeURIComponent(username)}` : undefined;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.auth.accessToken}`, 'Content-Type': 'application/json' };
  }

  private async snapJson<T extends Record<string, unknown>>(url: string, init: RequestInit, operation: string): Promise<SnapEnvelope<T>> {
    const response = await this.fetchImpl(url, init);
    if (!response.ok) throw new Error(`Snapchat ${operation} returned HTTP ${response.status}`);
    const body = await response.json() as SnapEnvelope<T>;
    successful(body, operation);
    return body;
  }

  private async listStories(profile: string): Promise<SnapStory[]> {
    const results: SnapStory[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const url = new URL(`${SNAP_API_BASE}/public_profiles/${encodeURIComponent(profile)}/stories`);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const body = await this.snapJson<SnapStoriesEnvelope>(url.toString(), { headers: this.headers() }, 'list Stories');
      for (const entry of body.stories ?? []) if (entry.sub_request_status === 'SUCCESS' && entry.story) results.push(entry.story);
      cursor = body.paging?.next_page_id;
      if (!cursor) break;
    }
    return results;
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const profile = profileId(this.auth);
    if (!isApiReady(this.auth) || !profile) throw new Error('Snapchat Story metrics require an approved Public Profile API connection');
    if (remoteId.startsWith(PENDING_PREFIX)) throw new Error('Snapchat Story metrics are unavailable until Story publication is confirmed');
    const url = `${SNAP_API_BASE}/public_profiles/${encodeURIComponent(profile)}/stories/${encodeURIComponent(remoteId)}/stats?assetType=STORY&granularity=LIFETIME`;
    const response = await this.fetchImpl(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`Snapchat Story metrics returned HTTP ${response.status}`);
    const body = await response.json() as { request_status?: string; assets?: Array<{ sub_request_status?: string; timeseries?: Array<{ fields?: Array<{ field?: { field_name?: string }; stats?: Array<{ value?: string | number }> }> }> }> };
    if (body.request_status !== 'SUCCESS') throw new Error('Snapchat Story metrics response was not successful');
    const fields = body.assets?.filter(asset => asset.sub_request_status === 'SUCCESS').flatMap(asset => asset.timeseries ?? []).flatMap(series => series.fields ?? []) ?? [];
    const numeric = (names: string[]) => {
      const found = fields.find(field => field.field?.field_name && names.includes(field.field.field_name));
      const rawValue = found?.stats?.[0]?.value;
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    };
    const metrics: ConnectorMetrics['metrics'] = {};
    const views = numeric(['STORY_VIEWS']);
    const reach = numeric(['STORY_UNIQUES']);
    const favorites = numeric(['STORY_FAVORITES']);
    if (views !== undefined) metrics.views = views;
    if (reach !== undefined) metrics.reach = reach;
    if (favorites !== undefined) metrics.favorites = favorites;
    return { postId: remoteId, platform: 'snapchat' as Platform, collectedAt: new Date().toISOString(), metrics };
  }

  async revoke(): Promise<void> {
    if (!this.auth.accessToken) return; // Manual Creative Kit connections have no OAuth grant.
    const clientId = this.auth.extra?.snapchatClientId;
    const clientSecret = this.auth.extra?.snapchatClientSecret;
    if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
      throw new Error('Snapchat token revocation requires the app client credentials; disconnect was not falsely reported as provider-revoked');
    }
    const response = await this.fetchImpl('https://accounts.snapchat.com/login/oauth2/revoke', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: this.auth.accessToken }),
    });
    if (!response.ok) throw new Error(`Snapchat token revocation returned HTTP ${response.status}`);
    this.log('info', 'revoke', 'Snapchat access revoked');
  }
}
