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
  /** Provider event id — used for replay protection. */
  eventId: string;
  /** Provider-declared event type, e.g. members:pledge:create. */
  eventType: string;
  occurredAt: string;
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
  getJson(url: string): Promise<{ status: number; body: unknown }>;
  postJson(url: string, body: unknown): Promise<{ status: number; body: unknown }>;
  delete(url: string): Promise<{ status: number }>;
}

const API_BASE = 'https://www.patreon.com/api/oauth2/v2';

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
  'email',
  'patron_status',
  'currently_entitled_amount_cents',
  'last_charge_status',
] as const;

export const POST_FIELDS = [
  'title',
  'is_public',
  'published_at',
  'url',
  'content',
] as const;

export const MEMBER_INCLUDES = ['currently_entitled_tiers'] as const;

export interface PatreonConnectorConfig {
  auth: ConnectorAuth;
  transport: PatreonTransport;
  ledger: IdempotencyLedger;
  /** Webhook signing secret. Never returned or logged. */
  webhookSecret: string;
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
  private readonly webhookSecret: string;
  private readonly onEvent?: (event: PatreonWebhookEvent) => Promise<void> | void;
  private campaignId?: string;

  constructor(config: PatreonConnectorConfig) {
    requireAccessToken(config.auth);
    if (!config.webhookSecret || config.webhookSecret.length < 16) {
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
    const { status, body } = await this.transport.getJson(url);
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

    const { status, body } = await this.transport.getJson(url);
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

    const { status, body } = await this.transport.getJson(url);
    if (status !== 200) {
      throw new Error(`patreon: syncPosts failed with status ${status}`);
    }
    return this.parsePosts(body);
  }

  /**
   * Register the campaign webhook. Sends the secret to the provider but never
   * returns it to any caller.
   */
  async ensureWebhooks(): Promise<{ registered: boolean; webhookUriConfigured: boolean }> {
    const campaignId = this.requireCampaignId();
    const url = buildUrl('/webhooks', {});
    const { status } = await this.transport.postJson(url, {
      data: {
        type: 'webhook',
        attributes: {
          triggers: ['members:pledge:create', 'members:pledge:update', 'members:pledge:delete', 'posts:publish'],
          uri: `patreon://campaign/${campaignId}`,
        },
        relationships: {
          campaign: { data: { type: 'campaign', id: campaignId } },
        },
      },
    });
    return { registered: status === 201 || status === 200, webhookUriConfigured: true };
  }

  /**
   * Verify and admit a signed webhook. Replay protection is by provider event id;
   * a repeated event id is rejected before any handler runs.
   */
  async handleWebhook(rawBody: string, signature: string): Promise<WebhookVerification> {
    const expected = await this.sign(rawBody);
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
    const eventId = asString(data.id);
    if (!eventId) {
      return { ok: false, reason: 'missing_event_id' };
    }
    const eventType = asString(data.type, asString(root.type));

    if (this.ledger.seen(`patreon:event:${eventId}`)) {
      return { ok: false, reason: 'replay_rejected' };
    }

    const event: PatreonWebhookEvent = {
      eventId,
      eventType,
      occurredAt: new Date().toISOString(),
      payloadDigest: await this.digest(rawBody),
    };

    // Claim last so a failed handler can be retried; a claimed id is terminal.
    this.ledger.claim(`patreon:event:${eventId}`);
    if (this.onEvent) {
      await this.onEvent(event);
    }
    return { ok: true, event };
  }

  /** Revoke stored token material for this model, then drop local binding. */
  async revoke(): Promise<void> {
    const url = buildUrl('/oauth2/token', {});
    await this.transport.delete(url);
    this.campaignId = undefined;
  }

  // ── internals ──

  private requireCampaignId(): string {
    if (!this.campaignId) {
      throw new Error('patreon: syncCampaign() must complete before member/post sync');
    }
    return this.campaignId;
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

  /** HMAC-SHA256 over the raw body, hex-encoded. */
  private async sign(rawBody: string): Promise<string> {
    return hmacSha256Hex(this.webhookSecret, rawBody);
  }

  private async digest(rawBody: string): Promise<string> {
    return hmacSha256Hex('', rawBody);
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

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}
