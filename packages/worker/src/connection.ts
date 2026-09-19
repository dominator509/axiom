import { and, eq, inArray } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { buildEgressFetch, resolveEgressProxy } from '@axiom/llm-gateway';
import {
  createConnector,
  FanvueConnector,
  PatreonCommunityConnector,
  type ConnectorAuth,
  type SocialConnector,
  type PatreonTransport,
} from '@axiom/connectors';
import { DEFAULT_EGRESS_PLANE_URL, readBoundedResponseJson, type Platform } from '@axiom/core';
import { inboxMediaMetadata } from './inbox-media.js';

const EGRESS_PLANE_URL = process.env.EGRESS_PLANE_URL ?? DEFAULT_EGRESS_PLANE_URL;
const EGRESS_PLANE_HEADERS: Record<string, string> = process.env.EGRESS_PLANE_TOKEN?.trim()
  ? { 'x-egress-plane-token': process.env.EGRESS_PLANE_TOKEN.trim() }
  : {};

type PlatformConnectionRow = InferSelectModel<typeof schema.platformConnection>;

export interface TargetConnectionRef {
  connectionId: string | null;
  platform: string;
}

export interface ResolvedTargetConnector {
  connection: PlatformConnectionRow;
  connector: SocialConnector;
}

export interface ResolvedPatreonConnector {
  connection: PlatformConnectionRow;
  connector: PatreonCommunityConnector;
}

/**
 * Build a connector for an already-resolved tenant connection. Provider
 * traffic remains bound to the model's healthy egress sidecar, including
 * disconnect/revocation calls initiated by the API.
 */
export async function connectorForConnection(
  connection: PlatformConnectionRow,
): Promise<ResolvedTargetConnector> {
  const platform = asPlatform(connection.platform);
  const proxy = await resolveEgressProxy(connection.modelId);
  if (!proxy) {
    throw new Error(`model ${connection.modelId} has no healthy egress sidecar`);
  }
  const auth = await decryptConnectorAuth(connection);
  return {
    connection,
    connector: createConnector(platform, auth, buildEgressFetch(proxy)),
  };
}

/**
 * Resolve the read/sync-only Patreon community connector. Patreon is kept out
 * of the SocialConnector registry so generic publish paths cannot select it.
 */
export async function patreonConnectorForConnection(
  connection: PlatformConnectionRow,
): Promise<ResolvedPatreonConnector> {
  if (connection.platform !== 'patreon') {
    throw new Error('connection is not a Patreon account');
  }
  const proxy = await resolveEgressProxy(connection.modelId);
  if (!proxy) throw new Error(`model ${connection.modelId} has no healthy egress sidecar`);
  const auth = await decryptConnectorAuth(connection);
  const webhookSecret = auth.extra?.patreonWebhookSecret;
  if (typeof webhookSecret !== 'string' || webhookSecret.length < 16) {
    throw new Error('Patreon connection has no valid webhook secret');
  }
  const egressFetch = buildEgressFetch(proxy);
  const json = async (url: string, init?: RequestInit) => {
    const response = await egressFetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    let body: unknown;
    try {
      body = await readBoundedResponseJson<unknown>(response);
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  };
  const transport: PatreonTransport = {
    getJson: (url) => json(url),
    postJson: (url, body) => json(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    delete: async (url) => ({ status: (await json(url, { method: 'DELETE' })).status }),
  };
  return {
    connection,
    connector: new PatreonCommunityConnector({
      auth,
      transport,
      ledger: createConnectionLedger(),
      webhookSecret,
    }),
  };
}

/** Request-local replay guard; durable webhook/sync claims are stored by the API. */
function createConnectionLedger() {
  const seen = new Set<string>();
  return {
    claim(key: string): boolean {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    seen(key: string): boolean { return seen.has(key); },
  };
}

/** Financial reads share publishing's exact model-egress and encrypted credential boundary. */
export async function earningsForConnection(connection: PlatformConnectionRow) {
  if (connection.platform !== 'fanvue') throw new Error('Earnings are only supported for Fanvue');
  const { connector } = await connectorForConnection(connection);
  if (!(connector instanceof FanvueConnector)) throw new Error('Fanvue connector unavailable');
  return connector.fetchEarningsSummary();
}

/** Read-only inbox access: never mark read, publish, or send a message. */
export async function inboxForConnection(connection: PlatformConnectionRow, page: number, userUuid?: string) {
  if (connection.platform !== 'fanvue') throw new Error('Inbox is only supported for Fanvue');
  const { connector } = await connectorForConnection(connection);
  if (!(connector instanceof FanvueConnector)) throw new Error('Fanvue connector unavailable');
  return userUuid
    ? { kind: 'messages' as const, ...await connector.fetchChatMessages(userUuid, page, 25) }
    : { kind: 'chats' as const, ...await connector.fetchChats(page, 25) };
}

/** Resolve attachment metadata within the exact creator account and message.
 * Signed provider URLs stay server-side; this is not a byte-preview endpoint.
 */
export async function inboxMediaForConnection(connection: PlatformConnectionRow, userUuid: string, messageUuid: string, mediaUuids: string[]) {
  if (connection.platform !== 'fanvue') throw new Error('Inbox media is only supported for Fanvue');
  const { connector } = await connectorForConnection(connection);
  if (!(connector instanceof FanvueConnector)) throw new Error('Fanvue connector unavailable');
  const media = await connector.fetchMessageMedia(userUuid, messageUuid, mediaUuids);
  return inboxMediaMetadata(media, messageUuid, mediaUuids);
}

export async function inboxPreviewForConnection(connection: PlatformConnectionRow, userUuid: string, messageUuid: string,
  mediaUuid: string, variant: 'main' | 'thumbnail' | 'thumbnail_gallery' | 'blurred', range?: string) {
  if (connection.platform !== 'fanvue') throw new Error('Inbox preview is only supported for Fanvue');
  const { connector } = await connectorForConnection(connection);
  if (!(connector instanceof FanvueConnector)) throw new Error('Fanvue connector unavailable');
  return { kind: 'preview' as const, ...await connector.fetchMessagePreview(userUuid, messageUuid, mediaUuid, variant, range) };
}

/** Resolve healthy model egress and credentials without dispatching a reply. */
export async function prepareReplySender(connection: PlatformConnectionRow) {
  if (connection.platform !== 'fanvue') throw new Error('Replies are only supported for Fanvue');
  const { connector } = await connectorForConnection(connection);
  if (!(connector instanceof FanvueConnector)) throw new Error('Fanvue connector unavailable');
  return (counterpartUuid: string, text: string, beforeDispatch: () => Promise<void>) =>
    connector.sendTextReply(counterpartUuid, text, beforeDispatch);
}

/** Resolve a stored platform identifier without allowing arbitrary dispatch. */
export function asPlatform(value: string): Platform {
  const platforms: readonly Platform[] = [
    'instagram',
    'tiktok',
    'x',
    'youtube',
    'reddit',
    'threads',
    'discord',
    'telegram',
    'facebook',
    'snapchat',
    'fanvue',
  ];
  if (!platforms.includes(value as Platform)) {
    throw new Error(`unsupported target platform '${value}'`);
  }
  return value as Platform;
}

/**
 * Find the connection belonging to the job's org and model. Existing targets
 * created before connection_id was populated may resolve only when there is
 * exactly one active connection for that model/platform; ambiguity fails
 * closed instead of selecting another account.
 */
export async function resolvePlatformConnection(
  tx: any,
  orgId: string,
  modelId: string,
  target: TargetConnectionRef,
): Promise<PlatformConnectionRow> {
  const platform = asPlatform(target.platform);
  const conditions = [
    eq(schema.platformConnection.orgId, orgId),
    eq(schema.platformConnection.modelId, modelId),
    eq(schema.platformConnection.platform, platform),
    inArray(schema.platformConnection.status, ['connected', 'active']),
  ];
  if (target.connectionId) {
    conditions.push(eq(schema.platformConnection.id, target.connectionId));
  }

  const rows = await tx
    .select()
    .from(schema.platformConnection)
    .where(and(...conditions))
    .orderBy(schema.platformConnection.connectedAt);

  if (rows.length === 0) {
    throw new Error(
      `no active ${platform} connection for model ${modelId} in organization ${orgId}`,
    );
  }
  if (!target.connectionId && rows.length > 1) {
    throw new Error(
      `target.connectionId is required: model ${modelId} has multiple active ${platform} connections`,
    );
  }
  return rows[0] as PlatformConnectionRow;
}

/**
 * Decrypt the connection envelope through the egress plane. The plaintext
 * payload is either a raw access token or JSON containing ConnectorAuth
 * fields, so provider identifiers and connector-specific values remain in
 * the same encrypted envelope as the token.
 */
export async function decryptConnectorAuth(
  connection: PlatformConnectionRow,
): Promise<ConnectorAuth> {
  const response = await fetch(`${EGRESS_PLANE_URL}/egress/decrypt`, {
    method: 'POST',
    headers: { ...EGRESS_PLANE_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({
      enc_token: Buffer.from(connection.encToken as Uint8Array).toString('base64'),
      enc_nonce: Buffer.from(connection.encNonce as Uint8Array).toString('base64'),
      dek_id: connection.dekId,
    }),
    signal: AbortSignal.timeout(2000),
  });

  if (!response.ok) {
    // Do not copy a remote error body into worker logs: the egress plane is
    // trusted, but its response must never become a credential disclosure
    // channel if an upstream or proxy misbehaves.
    throw new Error(`connection credential decrypt failed: HTTP ${response.status}`);
  }

  const body = await readBoundedResponseJson<{ plaintext?: string }>(response);
  if (!body.plaintext) throw new Error('connection credential decrypt returned no plaintext');

  const plaintext = Buffer.from(body.plaintext, 'base64').toString('utf8');
  return parseConnectorAuth(plaintext);
}

/** Parse the encrypted credential contract without exposing its contents in errors/logs. */
export function parseConnectorAuth(plaintext: string): ConnectorAuth {
  const value = plaintext.trim();
  if (!value) throw new Error('stored connector credential is empty');

  let parsed: unknown = value;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    // A non-JSON envelope is the backwards-compatible raw access-token form.
  }

  if (typeof parsed === 'string') {
    if (!parsed) throw new Error('stored connector credential is empty');
    return { accessToken: parsed };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('stored connector credential must be a token or auth object');
  }

  const record = parsed as Record<string, unknown>;
  const accessToken =
    typeof record.accessToken === 'string'
      ? record.accessToken
      : typeof record.access_token === 'string'
        ? record.access_token
        : '';
  if (!accessToken) throw new Error('stored connector credential has no access token');

  const auth: ConnectorAuth = { accessToken };
  if (typeof record.refreshToken === 'string') auth.refreshToken = record.refreshToken;
  else if (typeof record.refresh_token === 'string') auth.refreshToken = record.refresh_token;
  if (typeof record.externalUserId === 'string') auth.externalUserId = record.externalUserId;
  else if (typeof record.external_user_id === 'string')
    auth.externalUserId = record.external_user_id;
  if (typeof record.expiresAt === 'number') auth.expiresAt = record.expiresAt;
  else if (typeof record.expires_at === 'number') auth.expiresAt = record.expires_at;
  if (record.extra && typeof record.extra === 'object' && !Array.isArray(record.extra)) {
    auth.extra = record.extra as Record<string, unknown>;
  }
  return auth;
}

/**
 * Resolve the tenant connection and bind all provider traffic to the model's
 * healthy egress sidecar. A missing sidecar is a hard failure for publishing
 * and metrics; no host/global fetch fallback is allowed on this path.
 */
export async function connectorForTarget(
  tx: any,
  orgId: string,
  modelId: string,
  target: TargetConnectionRef,
): Promise<ResolvedTargetConnector> {
  const connection = await resolvePlatformConnection(tx, orgId, modelId, target);
  return connectorForConnection(connection);
}
