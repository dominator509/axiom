// ─── Patreon Community Connector (F-91) per L3.2 §3a ───
//
// Patreon is a READ/SYNC/EVENT-ONLY community integration. It is deliberately
// NOT a publish-capable SocialConnector: there is no API-publish media contract,
// and no post-write, DM, payout or invented-analytics capability is claimed.
// Capabilities are declared here and never assumed by callers (LBI-07).
//
// The adapter persists only tenant/model-scoped normalized records, opaque
// provider IDs and encrypted token material supplied by the caller. It never
// returns webhook secrets to a browser and it never uses undocumented API
// defaults — every read requests explicit `fields`/`include` per L3.2 §3a.

import { createHash, createHmac } from 'node:crypto';
import type { ConnectorAuth } from './types.js';

/** Capability declaration for the community (read/sync/event) contract. */
export interface CommunityCapability {
  identity: boolean;
  campaigns: boolean;
  memberships: boolean;
  postsRead: boolean;
  webhooks: boolean;
  publish: 'none' | 'assisted';
}

/** Explicitly declared NON-capabilities, surfaced so callers cannot assume them. */
export const PATREON_DENIED_ACTIONS = [
  'publish',
  'media_upload',
  'direct_message',
  'payout',
  'analytics_revenue',
  'member_removal',
] as const;

/**
 * Names persisted on platform_connection for the read/sync/event contract.
 * These are deliberately not SocialConnector capability names: Patreon is
 * never eligible for publish target resolution.
 */
export const PATREON_CAPABILITY_NAMES = [
  'community.identity',
  'community.campaigns',
  'community.memberships',
  'community.posts.read',
  'community.webhooks',
] as const;

export type PatreonDeniedAction = (typeof PATREON_DENIED_ACTIONS)[number];

/** Result envelope for a capability probe against an unsupported action. */
export interface ManualAssistResult {
  supported: false;
  action: string;
  manualAssist: true;
  reason: string;
}

/** Normalized, tenant/model-scoped records. No raw provider payloads. */
export interface PatreonCampaign {
  providerCampaignId: string;
  creatorProviderId: string;
  name: string;
  createdAt: string;
  publishedAt?: string;
  patronCount?: number;
}

export interface PatreonMembership {
  providerMemberId: string;
  providerCampaignId: string;
  tierId?: string;
  tierTitle?: string;
  status: 'active_patron' | 'declined_patron' | 'former_patron' | 'pending';
  currentlyEntitledAmountCents?: number;
  lastChargeStatus?: string;
}

export interface PatreonPost {
  providerPostId: string;
  providerCampaignId: string;
  title: string;
  isPublic: boolean;
  publishedAt: string;
  url?: string;
}

export interface PatreonWebhookEvent {
  /** Stable local delivery fingerprint because Patreon does not document a delivery id. */
  deliveryFingerprint: string;
  /** Trigger supplied in Patreon’s X-Patreon-Event header. */
  eventType: string;
  /** Receipt time; Patreon does not document a delivery timestamp. */
  receivedAt: string;
  payloadDigest: string;
}

/** A sync cursor is opaque to this adapter; only the provider interprets it. */
export interface SyncPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface WebhookVerification {
  ok: boolean;
  reason?: string;
  event?: PatreonWebhookEvent;
}

/**
 * Idempotency ledger for provider events and cursors. Implemented by the caller
 * against existing platform idempotency tables (L3.4); in-memory here for tests
 * and for a pure, dependency-free contract.
 */
export interface IdempotencyLedger {
  /** Returns true if the key was newly claimed, false if already seen. */
  claim(key: string): boolean;
  seen(key: string): boolean;
}

export function createMemoryLedger(): IdempotencyLedger {
  const seen = new Set<string>();
  return {
    claim(key: string): boolean {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    seen(key: string): boolean {
      return seen.has(key);
    },
  };
}

/**
 * Minimal HTTP transport the adapter uses. Injected so no test performs a live
 * network call, and so the real transport can attach the model's egress binding
 * (L2.3) without changing this contract.
 */
export interface PatreonTransport {
  getJson(url: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown }>;
  postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: unknown }>;
  delete(url: string, headers?: Record<string, string>): Promise<{ status: number }>;
}

const API_BASE = 'https://www.patreon.com/api/oauth2/v2';
export const PATREON_WEBHOOK_TRIGGERS = [
  'members:create',
  'members:update',
  'members:delete',
  'posts:publish',
  'posts:update',
  'posts:delete',
] as const;

/** Explicit field sets — never rely on undocumented provider defaults (L3.2 §3a). */
export const CAMPAIGN_FIELDS = [
  'creation_name',
  'patron_count',
  'created_at',
  'published_at',
  'vanity',
] as const;

export const MEMBER_FIELDS = [
  'full_name',
  'patron_status',
  'currently_entitled_amount_cents',
  'last_charge_status',
] as const;

export const POST_FIELDS = [
  'title',
  'is_public',
  'published_at',
  'url',
] as const;

export const MEMBER_INCLUDES = ['currently_entitled_tiers'] as const;

export interface PatreonConnectorConfig {
  auth: ConnectorAuth;
  transport: PatreonTransport;
  ledger: IdempotencyLedger;
  /** Provider-issued signing secret. Absent until webhook setup is verified. */
  webhookSecret?: string;
  /** Called for each newly-seen webhook event after verification. */
  onEvent?: (event: PatreonWebhookEvent) => Promise<void> | void;
}

function requireAccessToken(auth: ConnectorAuth): string {
  const token = auth.accessToken;
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('patreon: missing access token');
  }
  return token;
}

function buildUrl(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value);
  }
  return `${API_BASE}${path}?${search.toString()}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The Patreon community connector. Implements the L3.2 §3a CommunityConnector
 * contract: identity, campaigns, memberships, postsRead and webhooks are
 * supported; publish is 'none'. Unsupported actions return a truthful
 * manual-assist result instead of a fabricated success.
 */
export class PatreonCommunityConnector {
  readonly platform = 'patreon' as const;
  readonly integrationKind = 'community' as const;
  readonly auth: ConnectorAuth;
  readonly displayName = 'Patreon (community)';

  private readonly transport: PatreonTransport;
  private readonly ledger: IdempotencyLedger;
  private readonly webhookSecret?: string;
  private readonly onEvent?: (event: PatreonWebhookEvent) => Promise<void> | void;
  private campaignId?: string;

  constructor(config: PatreonConnectorConfig) {
    requireAccessToken(config.auth);
    if (config.webhookSecret !== undefined && config.webhookSecret.length < 16) {
      throw new Error('patreon: webhook secret must be at least 16 characters');
    }
    this.auth = config.auth;
    this.transport = config.transport;
    this.ledger = config.ledger;
    this.webhookSecret = config.webhookSecret;
    this.onEvent = config.onEvent;
  }

  /** Declared capabilities. publish is always 'none' for this adapter. */
  capability(): CommunityCapability {
    return {
      identity: true,
      campaigns: true,
      memberships: true,
      postsRead: true,
      webhooks: true,
      publish: 'none',
    };
  }

  /**
   * Truthful capability probe. Unsupported actions never pretend to succeed;
   * they return a manual-assist directive for the operator (LBI-07).
   */
  supports(action: string): boolean {
    return !(PATREON_DENIED_ACTIONS as readonly string[]).includes(action);
  }

  manualAssist(action: string): ManualAssistResult {
    return {
      supported: false,
      action,
      manualAssist: true,
      reason:
        'Patreon has no supported API contract for this action; complete it in the Patreon UI and record the result manually.',
    };
  }

  /** Fetch and normalize the creator's campaign identity. */
  async syncCampaign(): Promise<PatreonCampaign> {
    const url = buildUrl('/campaigns', {
      'fields[campaign]': CAMPAIGN_FIELDS.join(','),
    });
    const { status, body } = await this.transport.getJson(url, this.authorizationHeaders());
    if (status !== 200) {
      throw new Error(`patreon: syncCampaign failed with status ${status}`);
    }
    const root = asRecord(body);
    const data = asRecord(root.data);
    const attributes = asRecord(data.attributes);
    const providerCampaignId = asString(data.id);
    if (!providerCampaignId) {
      throw new Error('patreon: syncCampaign response missing campaign id');
    }
    const relationships = asRecord(data.relationships);
    const creatorData = asRecord(asRecord(relationships.creator).data);
    const creatorProviderId = asString(creatorData.id, this.auth.externalUserId ?? '');
    if (!creatorProviderId) {
      throw new Error('patreon: syncCampaign response missing creator id');
    }
    this.campaignId = providerCampaignId;
    return {
      providerCampaignId,
      creatorProviderId,
      name: asString(attributes.creation_name ?? attributes.name),
      createdAt: asString(attributes.created_at),
      publishedAt: asString(attributes.published_at) || undefined,
      patronCount: asNumber(attributes.patron_count),
    };
  }

  /**
   * Cursor-paginated membership sync. The cursor is opaque and replayed
   * verbatim; each page is claimed in the idempotency ledger so a retried page
   * cannot double-apply.
   */
  async syncMembers(cursor?: string): Promise<SyncPage<PatreonMembership>> {
    const campaignId = this.requireCampaignId();
    const params: Record<string, string> = {
      'fields[member]': MEMBER_FIELDS.join(','),
      include: MEMBER_INCLUDES.join(','),
    };
    if (cursor) params['page[cursor]'] = cursor;

    const url = buildUrl(`/campaigns/${encodeURIComponent(campaignId)}/members`, params);

    if (cursor) {
      const claimKey = `patreon:members:${campaignId}:${cursor}`;
      if (!this.ledger.claim(claimKey)) {
        throw new Error(`patreon: duplicate membership cursor ${cursor}`);
      }
    }

    const { status, body } = await this.transport.getJson(url, this.authorizationHeaders());
    if (status !== 200) {
      throw new Error(`patreon: syncMembers failed with status ${status}`);
    }
    return this.parseMembers(body);
  }

  /** Cursor-paginated post read sync. Read-only; never writes to Patreon. */
  async syncPosts(cursor?: string): Promise<SyncPage<PatreonPost>> {
    const campaignId = this.requireCampaignId();
    const params: Record<string, string> = {
      'fields[post]': POST_FIELDS.join(','),
    };
    if (cursor) params['page[cursor]'] = cursor;

    const url = buildUrl(`/campaigns/${encodeURIComponent(campaignId)}/posts`, params);

    if (cursor) {
      const claimKey = `patreon:posts:${campaignId}:${cursor}`;
      if (!this.ledger.claim(claimKey)) {
        throw new Error(`patreon: duplicate post cursor ${cursor}`);
      }
    }

    const { status, body } = await this.transport.getJson(url, this.authorizationHeaders());
    if (status !== 200) {
      throw new Error(`patreon: syncPosts failed with status ${status}`);
    }
    return this.parsePosts(body);
  }

  /** Register or recover the provider webhook, then verify it by readback. */
  async ensureWebhooks(webhookUri: string): Promise<{ webhookId: string; webhookSecret: string; webhookUri: string }> {
    const campaignId = this.requireCampaignId();
    const parsedUri = new URL(webhookUri);
    if (parsedUri.protocol !== 'https:' || parsedUri.username || parsedUri.password || parsedUri.search || parsedUri.hash) {
      throw new Error('patreon: webhook URI must be a clean HTTPS URL');
    }
    const uri = parsedUri.toString();
    const listUrl = buildUrl('/webhooks', { 'fields[webhook]': 'uri,secret,triggers,paused' });
    const existing = await this.transport.getJson(listUrl, this.authorizationHeaders());
    if (existing.status !== 200) throw new Error(`patreon: webhook lookup failed with status ${existing.status}`);
    const existingMatches = this.webhooksAtUri(existing.body, uri);
    if (existingMatches.length > 1) throw new Error('patreon: duplicate webhook registrations require operator cleanup');
    if (existingMatches.length === 1) return this.readWebhook(existingMatches[0], uri);

    const created = await this.transport.postJson(buildUrl('/webhooks', {}), {
      data: {
        type: 'webhook',
        attributes: { triggers: [...PATREON_WEBHOOK_TRIGGERS], uri },
        relationships: { campaign: { data: { type: 'campaign', id: campaignId } } },
      },
    }, this.authorizationHeaders());
    if (created.status !== 201 && created.status !== 200) {
      throw new Error(`patreon: webhook creation failed with status ${created.status}`);
    }

    // Recover safely if the provider accepted the POST but the response was
    // lost: retries read the remote registration before attempting creation.
    const readback = await this.transport.getJson(listUrl, this.authorizationHeaders());
    if (readback.status !== 200) throw new Error(`patreon: webhook readback failed with status ${readback.status}`);
    const matches = this.webhooksAtUri(readback.body, uri);
    if (matches.length !== 1) throw new Error('patreon: webhook registration could not be confirmed');
    return this.readWebhook(matches[0], uri);
  }

  /**
   * Verify and admit a signed webhook. Replay protection uses a stable payload
   * fingerprint because Patreon does not document a delivery-id header.
   */
  async handleWebhook(rawBody: string, signature: string, eventTypeHeader: string): Promise<WebhookVerification> {
    if (!this.webhookSecret) return { ok: false, reason: 'webhook_secret_unavailable' };
    const expected = this.sign(rawBody);
    if (!timingSafeEqual(expected, signature)) {
      return { ok: false, reason: 'signature_mismatch' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }

    const root = asRecord(parsed);
    const data = asRecord(root.data);
    if (!asString(data.id)) return { ok: false, reason: 'missing_resource_id' };
    const eventType = eventTypeHeader.trim();
    if (!(PATREON_WEBHOOK_TRIGGERS as readonly string[]).includes(eventType)) {
      return { ok: false, reason: 'unsupported_event_type' };
    }
    const payloadDigest = this.digest(rawBody);
    const deliveryFingerprint = createHash('sha256').update(`${eventType}\n${rawBody}`, 'utf8').digest('hex');

    if (this.ledger.seen(`patreon:event:${deliveryFingerprint}`)) {
      return { ok: false, reason: 'replay_rejected' };
    }

    const event: PatreonWebhookEvent = {
      deliveryFingerprint,
      eventType,
      receivedAt: new Date().toISOString(),
      payloadDigest,
    };

    // Claim before awaiting the handler so concurrent duplicate admissions are rejected locally.
    this.ledger.claim(`patreon:event:${deliveryFingerprint}`);
    if (this.onEvent) {
      await this.onEvent(event);
    }
    return { ok: true, event };
  }

  /** Remove the documented provider webhook before the application deletes its local binding. */
  async revoke(): Promise<void> {
    const webhookId = this.auth.extra?.patreonWebhookId;
    if (typeof webhookId === 'string' && webhookId.trim()) {
      const url = buildUrl(`/webhooks/${encodeURIComponent(webhookId)}`, {});
      const { status } = await this.transport.delete(url, this.authorizationHeaders());
      if (status !== 200 && status !== 204 && status !== 404) {
        throw new Error(`patreon: webhook deletion failed with status ${status}`);
      }
    }
    this.campaignId = undefined;
  }

  // ── internals ──

  private requireCampaignId(): string {
    if (!this.campaignId) {
      throw new Error('patreon: syncCampaign() must complete before member/post sync');
    }
    return this.campaignId;
  }

  private authorizationHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${requireAccessToken(this.auth)}`,
      'user-agent': 'FanThynks Creator OS',
    };
  }

  private webhooksAtUri(body: unknown, uri: string): Record<string, unknown>[] {
    const root = asRecord(body);
    const rows = Array.isArray(root.data) ? root.data : [];
    return rows.map(asRecord).filter(webhook => asString(asRecord(webhook.attributes).uri) === uri);
  }

  private readWebhook(webhook: Record<string, unknown>, uri: string): { webhookId: string; webhookSecret: string; webhookUri: string } {
    const attributes = asRecord(webhook.attributes);
    const webhookId = asString(webhook.id);
    const webhookSecret = asString(attributes.secret);
    const triggers = Array.isArray(attributes.triggers)
      ? attributes.triggers.filter((item): item is string => typeof item === 'string')
      : [];
    if (!webhookId || webhookSecret.length < 16 || attributes.paused === true ||
      !PATREON_WEBHOOK_TRIGGERS.every(trigger => triggers.includes(trigger))) {
      throw new Error('patreon: webhook readback is incomplete or paused');
    }
    return { webhookId, webhookSecret, webhookUri: uri };
  }

  private parseMembers(body: unknown): SyncPage<PatreonMembership> {
    const root = asRecord(body);
    const rows = Array.isArray(root.data) ? root.data : [];
    const included = Array.isArray(root.included) ? root.included : [];
    const tiersById = new Map<string, { id: string; title: string }>();
    for (const entry of included) {
      const rec = asRecord(entry);
      const attrs = asRecord(rec.attributes);
      const id = asString(rec.id);
      if (id) tiersById.set(id, { id, title: asString(attrs.title) });
    }

    const items: PatreonMembership[] = rows.map((row) => {
      const rec = asRecord(row);
      const attrs = asRecord(rec.attributes);
      const rels = asRecord(rec.relationships);
      const tierRel = asRecord(rels.currently_entitled_tiers);
      const tierData = tierRel.data;
      const firstTier = Array.isArray(tierData) ? asRecord(tierData[0]) : {};
      const tierId = asString(firstTier.id) || undefined;
      const status = asString(attrs.patron_status, 'pending') as PatreonMembership['status'];

      return {
        providerMemberId: asString(rec.id),
        providerCampaignId: this.campaignId ?? '',
        tierId,
        tierTitle: tierId ? tiersById.get(tierId)?.title : undefined,
        status,
        currentlyEntitledAmountCents: asNumber(attrs.currently_entitled_amount_cents),
        lastChargeStatus: asString(attrs.last_charge_status) || undefined,
      };
    });

    const meta = asRecord(root.meta);
    const pagination = asRecord(meta.pagination);
    const cursors = asRecord(pagination.cursors);
    const nextCursor = asString(cursors.next) || undefined;
    return nextCursor ? { items, nextCursor } : { items };
  }

  private parsePosts(body: unknown): SyncPage<PatreonPost> {
    const root = asRecord(body);
    const rows = Array.isArray(root.data) ? root.data : [];
    const items: PatreonPost[] = rows.map((row) => {
      const rec = asRecord(row);
      const attrs = asRecord(rec.attributes);
      return {
        providerPostId: asString(rec.id),
        providerCampaignId: this.campaignId ?? '',
        title: asString(attrs.title),
        isPublic: attrs.is_public === true,
        publishedAt: asString(attrs.published_at),
        url: asString(attrs.url) || undefined,
      };
    });

    const meta = asRecord(root.meta);
    const pagination = asRecord(meta.pagination);
    const cursors = asRecord(pagination.cursors);
    const nextCursor = asString(cursors.next) || undefined;
    return nextCursor ? { items, nextCursor } : { items };
  }

  /** Patreon signs the exact raw body with HMAC-MD5 and sends a hex digest. */
  private sign(rawBody: string): string {
    return createHmac('md5', this.webhookSecret!).update(rawBody, 'utf8').digest('hex');
  }

  private digest(rawBody: string): string {
    return createHash('sha256').update(rawBody, 'utf8').digest('hex');
  }
}

/** Constant-time string comparison to avoid signature oracle timing leaks. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
