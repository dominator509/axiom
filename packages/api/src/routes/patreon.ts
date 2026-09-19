// F-91 Patreon v2 integration.
//
// This route owns the model-scoped OAuth, normalized read/sync persistence and
// signed webhook ingress. It deliberately never exposes a publish action and
// never enters the generic SocialConnector publisher registry.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppBindings } from '../index.js';
import { normalizeAuthOrigin } from '@axiom/auth';
import { buildEgressFetch, resolveEgressProxy } from '@axiom/llm-gateway';
import { PATREON_CAPABILITY_NAMES } from '@axiom/connectors';
import { readBoundedResponseJson } from '@axiom/core';
import { schema } from '@axiom/db';
import { patreonConnectorForConnection } from '@axiom/worker';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { readBoundedText, RequestBodyTooLargeError } from '../webhook-body.js';
import {
  apiError,
  modelOrgId,
  requireOrg,
  statusTitle,
  withOrgContext,
  writeAudit,
} from './helpers.js';
import {
  clearOAuthStateCookie,
  getOAuthStateCookie,
  resolveOAuthCookieSecret,
  setOAuthStateCookie,
} from './oauth-state.js';
import { persistOAuthConnection } from './oauth-connection.js';

const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID?.trim() ?? '';
const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET?.trim() ?? '';
const APPLICATION_ORIGIN = normalizeAuthOrigin(
  process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3001',
);
const PATREON_REDIRECT_URI =
  process.env.PATREON_REDIRECT_URI ||
  new URL('/api/v1/connectors/patreon/callback', APPLICATION_ORIGIN).toString();
const PATREON_AUTHORIZE_URL = 'https://www.patreon.com/oauth2/authorize';
const PATREON_TOKEN_URL = 'https://www.patreon.com/api/oauth2/token';
const PATREON_SCOPES = [
  'identity',
  'campaigns',
  'identity.memberships',
  'campaigns.members',
  'campaigns.posts',
  'w:campaigns.webhook',
];
const OAUTH_STATE_COOKIE = 'axiom_patreon_oauth_state';
const OAUTH_COOKIE_PATH = '/api/v1/connectors/patreon';
const oauthStateKey = () => resolveOAuthCookieSecret();

const syncSchema = z.object({
  resource: z.enum(['campaign', 'members', 'posts']),
  cursor: z.string().trim().min(1).max(512).optional(),
}).strict();

const resourceSchema = z.enum(['campaign', 'members', 'posts']);
type PatreonResource = z.infer<typeof resourceSchema>;

const router = new Hono<AppBindings>();

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function browserConnectionRedirect(c: Context<AppBindings>, modelId: string) {
  if (!(c.req.header('accept') ?? '').includes('text/html')) return null;
  const destination = new URL(`/models/${encodeURIComponent(modelId)}/network`, APPLICATION_ORIGIN);
  destination.searchParams.set('oauth', 'connected');
  destination.searchParams.set('platform', 'patreon');
  return c.redirect(destination.toString(), 303);
}

async function loadPatreonConnection(orgId: string, connectionId: string) {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx.select().from(schema.platformConnection).where(and(
      eq(schema.platformConnection.orgId, orgId),
      eq(schema.platformConnection.id, connectionId),
      eq(schema.platformConnection.platform, 'patreon'),
    )).limit(1);
    return rows[0] ?? null;
  });
}

function connectionMetadata(connection: any) {
  return {
    id: connection.id,
    orgId: connection.orgId,
    modelId: connection.modelId,
    platform: 'patreon',
    displayName: connection.displayName,
    status: connection.status,
    capabilities: connection.capabilities ?? [...PATREON_CAPABILITY_NAMES],
    connectedAt: connection.connectedAt,
  };
}

async function writeSyncState(
  connection: any,
  resource: PatreonResource,
  lastCursor: string | null,
  nextCursor: string | null,
  error: string | null,
) {
  return withOrgContext(connection.orgId, async (tx) => {
    await tx.insert(schema.patreonSyncState).values({
      orgId: connection.orgId,
      modelId: connection.modelId,
      connectionId: connection.id,
      resource,
      lastCursor,
      nextCursor,
      lastSyncedAt: error ? null : new Date(),
      lastError: error,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [schema.patreonSyncState.connectionId, schema.patreonSyncState.resource],
      set: {
        lastCursor,
        nextCursor,
        lastSyncedAt: error ? null : new Date(),
        lastError: error,
        updatedAt: new Date(),
      },
    });
  });
}

async function saveCampaign(connection: any, campaign: Awaited<ReturnType<Awaited<ReturnType<typeof patreonConnectorForConnection>>['connector']['syncCampaign']>>) {
  await withOrgContext(connection.orgId, tx => tx.insert(schema.patreonCampaign).values({
    orgId: connection.orgId,
    modelId: connection.modelId,
    connectionId: connection.id,
    providerCampaignId: campaign.providerCampaignId,
    creatorProviderId: campaign.creatorProviderId,
    name: campaign.name,
    providerCreatedAt: campaign.createdAt || null,
    providerPublishedAt: campaign.publishedAt ?? null,
    patronCount: campaign.patronCount ?? null,
    syncedAt: new Date(),
  }).onConflictDoUpdate({
    target: [schema.patreonCampaign.connectionId, schema.patreonCampaign.providerCampaignId],
    set: {
      creatorProviderId: campaign.creatorProviderId,
      name: campaign.name,
      providerCreatedAt: campaign.createdAt || null,
      providerPublishedAt: campaign.publishedAt ?? null,
      patronCount: campaign.patronCount ?? null,
      syncedAt: new Date(),
    },
  }));
}

async function saveMembers(connection: any, items: Awaited<ReturnType<Awaited<ReturnType<typeof patreonConnectorForConnection>>['connector']['syncMembers']>>['items']) {
  await withOrgContext(connection.orgId, async tx => {
    for (const member of items) {
      await tx.insert(schema.patreonMembership).values({
        orgId: connection.orgId,
        modelId: connection.modelId,
        connectionId: connection.id,
        providerMemberId: member.providerMemberId,
        providerCampaignId: member.providerCampaignId,
        tierId: member.tierId ?? null,
        tierTitle: member.tierTitle ?? null,
        status: member.status,
        currentlyEntitledAmountCents: member.currentlyEntitledAmountCents ?? null,
        lastChargeStatus: member.lastChargeStatus ?? null,
        syncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [schema.patreonMembership.connectionId, schema.patreonMembership.providerMemberId],
        set: {
          providerCampaignId: member.providerCampaignId,
          tierId: member.tierId ?? null,
          tierTitle: member.tierTitle ?? null,
          status: member.status,
          currentlyEntitledAmountCents: member.currentlyEntitledAmountCents ?? null,
          lastChargeStatus: member.lastChargeStatus ?? null,
          syncedAt: new Date(),
        },
      });
    }
  });
}

async function savePosts(connection: any, items: Awaited<ReturnType<Awaited<ReturnType<typeof patreonConnectorForConnection>>['connector']['syncPosts']>>['items']) {
  await withOrgContext(connection.orgId, async tx => {
    for (const post of items) {
      await tx.insert(schema.patreonPost).values({
        orgId: connection.orgId,
        modelId: connection.modelId,
        connectionId: connection.id,
        providerPostId: post.providerPostId,
        providerCampaignId: post.providerCampaignId,
        title: post.title,
        isPublic: post.isPublic,
        providerPublishedAt: post.publishedAt || null,
        providerUrl: post.url ?? null,
        syncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [schema.patreonPost.connectionId, schema.patreonPost.providerPostId],
        set: {
          providerCampaignId: post.providerCampaignId,
          title: post.title,
          isPublic: post.isPublic,
          providerPublishedAt: post.publishedAt || null,
          providerUrl: post.url ?? null,
          syncedAt: new Date(),
        },
      });
    }
  });
}

router.get('/connectors/patreon/authorize', async c => {
  if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Patreon client credentials not configured');
  }
  const orgId = requireOrg(c);
  const modelId = c.req.query('modelId');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!modelId) return apiError(c, 400, statusTitle(400), 'modelId query required');
  const ownsModel = await withOrgContext(orgId, tx => modelOrgId(tx, modelId));
  if (ownsModel !== orgId) return apiError(c, 404, statusTitle(404), 'model not found');

  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(24));
  setOAuthStateCookie(c, OAUTH_STATE_COOKIE, {
    state, verifier, orgId, modelId, issuedAt: Date.now(),
  }, oauthStateKey(), OAUTH_COOKIE_PATH);

  const url = new URL(PATREON_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', PATREON_CLIENT_ID);
  url.searchParams.set('redirect_uri', PATREON_REDIRECT_URI);
  url.searchParams.set('scope', PATREON_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return c.redirect(url.toString(), 302);
});

router.get('/connectors/patreon/callback', async c => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  if (error) return apiError(c, 400, statusTitle(400), `Patreon auth error: ${error}`);
  if (!code) return apiError(c, 400, statusTitle(400), 'Missing authorization code');
  const pending = getOAuthStateCookie(c, OAUTH_STATE_COOKIE, oauthStateKey());
  if (!state || !pending || pending.state !== state || !pending.verifier) {
    return apiError(c, 400, statusTitle(400), 'Invalid or missing state (CSRF check failed)');
  }
  if (!pending.orgId || !pending.modelId) {
    return apiError(c, 400, statusTitle(400), 'OAuth state has no model connection target');
  }
  clearOAuthStateCookie(c, OAUTH_STATE_COOKIE, OAUTH_COOKIE_PATH);
  if (!PATREON_CLIENT_ID || !PATREON_CLIENT_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Patreon client credentials not configured');
  }

  try {
    const proxy = await resolveEgressProxy(pending.modelId);
    if (!proxy) return apiError(c, 503, statusTitle(503), 'Patreon token exchange unavailable: model egress binding is unhealthy');
    const egressFetch = buildEgressFetch(proxy);
    const response = await egressFetch(PATREON_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: PATREON_CLIENT_ID,
        client_secret: PATREON_CLIENT_SECRET,
        redirect_uri: PATREON_REDIRECT_URI,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const tokenData = await readBoundedResponseJson<Record<string, unknown>>(response);
    if (!response.ok) return apiError(c, 502, statusTitle(502), 'Patreon token exchange failed');
    const accessToken = typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
    if (!accessToken) return apiError(c, 502, statusTitle(502), 'Patreon token exchange returned no access token');
    const refreshToken = typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : undefined;
    const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : undefined;
    const externalUserId = typeof tokenData.user_id === 'string'
      ? tokenData.user_id
      : typeof tokenData.sub === 'string' ? tokenData.sub : undefined;
    const connection = await persistOAuthConnection({
      orgId: pending.orgId,
      modelId: pending.modelId,
      platform: 'patreon',
      displayName: externalUserId ? `Patreon ${externalUserId}` : 'Patreon community',
      credentials: {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(externalUserId ? { externalUserId } : {}),
        ...(expiresIn ? { expiresAt: Math.floor(Date.now() / 1000) + expiresIn } : {}),
        extra: { patreonWebhookSecret: randomBytes(32).toString('hex') },
      },
      actorRef: 'oauth:patreon',
      capabilities: [...PATREON_CAPABILITY_NAMES],
    });
    if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');
    const redirect = browserConnectionRedirect(c, pending.modelId);
    if (redirect) return redirect;
    return c.json({ success: true, platform: 'patreon', connectionId: connection.id, message: 'Patreon connected.' });
  } catch {
    console.error('Patreon token exchange or encrypted connection persistence failed');
    return apiError(c, 502, statusTitle(502), 'Patreon token exchange or connection persistence failed');
  }
});

router.get('/connectors/patreon/status', async c => {
  const orgId = requireOrg(c);
  const connectionId = c.req.query('connectionId');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!connectionId) return apiError(c, 400, statusTitle(400), 'connectionId query required');
  const connection = await loadPatreonConnection(orgId, connectionId);
  if (!connection) return apiError(c, 404, statusTitle(404), 'Patreon connection not found');
  const data = await withOrgContext(orgId, async tx => {
    const [campaigns, members, posts, sync, webhooks] = await Promise.all([
      tx.select({ count: sql<number>`count(*)` }).from(schema.patreonCampaign).where(eq(schema.patreonCampaign.connectionId, connectionId)),
      tx.select({ count: sql<number>`count(*)` }).from(schema.patreonMembership).where(eq(schema.patreonMembership.connectionId, connectionId)),
      tx.select({ count: sql<number>`count(*)` }).from(schema.patreonPost).where(eq(schema.patreonPost.connectionId, connectionId)),
      tx.select().from(schema.patreonSyncState).where(eq(schema.patreonSyncState.connectionId, connectionId)).orderBy(desc(schema.patreonSyncState.updatedAt)),
      tx.select().from(schema.patreonWebhookEvent).where(eq(schema.patreonWebhookEvent.connectionId, connectionId)).orderBy(desc(schema.patreonWebhookEvent.receivedAt)).limit(1),
    ]);
    return {
      connection: connectionMetadata(connection),
      counts: { campaigns: Number(campaigns[0]?.count ?? 0), members: Number(members[0]?.count ?? 0), posts: Number(posts[0]?.count ?? 0) },
      sync,
      lastWebhook: webhooks[0] ?? null,
      deniedActions: ['publish', 'media_upload', 'direct_message', 'payout', 'analytics_revenue', 'member_removal'],
    };
  });
  return c.json({ data });
});

router.get('/connectors/patreon/data', async c => {
  const orgId = requireOrg(c);
  const connectionId = c.req.query('connectionId');
  const resource = resourceSchema.safeParse(c.req.query('resource'));
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!connectionId) return apiError(c, 400, statusTitle(400), 'connectionId query required');
  if (!resource.success) return apiError(c, 400, statusTitle(400), 'resource must be campaign, members or posts');
  const connection = await loadPatreonConnection(orgId, connectionId);
  if (!connection) return apiError(c, 404, statusTitle(404), 'Patreon connection not found');
  const table = resource.data === 'campaign'
    ? schema.patreonCampaign
    : resource.data === 'members' ? schema.patreonMembership : schema.patreonPost;
  const rows = await withOrgContext(orgId, tx => tx.select().from(table).where(eq(table.connectionId, connectionId)).orderBy(desc(table.syncedAt)).limit(100));
  return c.json({ data: rows, meta: { bounded: true, limit: 100 } });
});

router.post('/connectors/patreon/sync', zValidator('json', syncSchema), async c => {
  const orgId = requireOrg(c);
  const connectionId = c.req.query('connectionId');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!connectionId) return apiError(c, 400, statusTitle(400), 'connectionId query required');
  const connection = await loadPatreonConnection(orgId, connectionId);
  if (!connection) return apiError(c, 404, statusTitle(404), 'Patreon connection not found');
  const body = c.req.valid('json');
  try {
    const existingState = await withOrgContext(orgId, tx => tx.select().from(schema.patreonSyncState).where(and(
      eq(schema.patreonSyncState.connectionId, connectionId),
      eq(schema.patreonSyncState.resource, body.resource),
    )).limit(1));
    if (body.cursor && existingState[0]?.lastCursor === body.cursor) {
      return c.json({ data: {
        resource: body.resource,
        count: 0,
        nextCursor: existingState[0].nextCursor ?? null,
        replay: true,
      } });
    }
    const { connector } = await patreonConnectorForConnection(connection);
    let count = 0;
    let nextCursor: string | undefined;
    if (body.resource === 'campaign') {
      const campaign = await connector.syncCampaign();
      await saveCampaign(connection, campaign);
      count = 1;
    } else {
      const campaign = await connector.syncCampaign();
      await saveCampaign(connection, campaign);
      if (body.resource === 'members') {
        const page = await connector.syncMembers(body.cursor);
        await saveMembers(connection, page.items);
        count = page.items.length;
        nextCursor = page.nextCursor;
      } else {
        const page = await connector.syncPosts(body.cursor);
        await savePosts(connection, page.items);
        count = page.items.length;
        nextCursor = page.nextCursor;
      }
    }
    await writeSyncState(connection, body.resource, body.cursor ?? null, nextCursor ?? null, null);
    await withOrgContext(orgId, tx => writeAudit(tx, orgId, c.get('userId') ?? 'system', 'patreon.sync', connectionId, { resource: body.resource, count }));
    return c.json({ data: { resource: body.resource, count, nextCursor: nextCursor ?? null } });
  } catch {
    await writeSyncState(connection, body.resource, body.cursor ?? null, null, 'provider sync failed').catch(() => undefined);
    return apiError(c, 502, statusTitle(502), 'Patreon sync failed; no provider payload was returned');
  }
});

/** Public provider callback. HMAC is the authorization boundary; no session is required. */
router.post('/webhooks/patreon/:orgId/:connectionId', async c => {
  const orgId = c.req.param('orgId');
  const connectionId = c.req.param('connectionId');
  const signature = c.req.header('x-patreon-signature');
  if (!signature) return apiError(c, 401, statusTitle(401), 'Patreon signature required');
  const connection = await loadPatreonConnection(orgId, connectionId);
  if (!connection) return apiError(c, 404, statusTitle(404), 'Patreon connection not found');
  let rawBody: string;
  try {
    rawBody = await readBoundedText(c.req.raw);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'Patreon webhook body too large');
    return apiError(c, 400, statusTitle(400), 'Patreon webhook body could not be read');
  }
  try {
    const { connector } = await patreonConnectorForConnection(connection);
    const verified = await connector.handleWebhook(rawBody, signature);
    if (!verified.ok) {
      if (verified.reason === 'replay_rejected') return c.json({ accepted: false, replay: true });
      return apiError(c, 401, statusTitle(401), 'Patreon webhook verification failed');
    }
    const event = verified.event!;
    const inserted = await withOrgContext(orgId, async tx => {
      const rows = await tx.insert(schema.patreonWebhookEvent).values({
        orgId,
        modelId: connection.modelId,
        connectionId,
        providerEventId: event.eventId,
        eventType: event.eventType || 'unknown',
        occurredAt: new Date(event.occurredAt),
        payloadDigest: event.payloadDigest,
        receivedAt: new Date(),
      }).onConflictDoNothing({ target: [schema.patreonWebhookEvent.connectionId, schema.patreonWebhookEvent.providerEventId] }).returning({ id: schema.patreonWebhookEvent.id });
      if (rows.length > 0) {
        await writeAudit(tx, orgId, 'patreon:webhook', 'patreon.webhook', rows[0].id, { eventType: event.eventType });
      }
      return rows.length > 0;
    });
    return c.json({ accepted: inserted, replay: !inserted }, inserted ? 202 : 200);
  } catch {
    return apiError(c, 502, statusTitle(502), 'Patreon webhook processing failed; provider should retry');
  }
});

export { router as patreonRouter };
