import { and, eq, inArray } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { buildEgressFetch, resolveEgressProxy } from '@axiom/llm-gateway';
import {
  createConnector,
  type ConnectorAuth,
  type SocialConnector,
} from '@axiom/connectors';
import type { Platform } from '@axiom/core';

const EGRESS_PLANE_URL = process.env.EGRESS_PLANE_URL ?? 'http://127.0.0.1:3000';

type PlatformConnectionRow = InferSelectModel<typeof schema.platformConnection>;

export interface TargetConnectionRef {
  connectionId: string | null;
  platform: string;
}

export interface ResolvedTargetConnector {
  connection: PlatformConnectionRow;
  connector: SocialConnector;
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
export async function decryptConnectorAuth(connection: PlatformConnectionRow): Promise<ConnectorAuth> {
  const response = await fetch(`${EGRESS_PLANE_URL}/egress/decrypt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

  const body = (await response.json()) as { plaintext?: string };
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
  else if (typeof record.external_user_id === 'string') auth.externalUserId = record.external_user_id;
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
  const proxy = await resolveEgressProxy(modelId);
  if (!proxy) {
    throw new Error(`model ${modelId} has no healthy egress sidecar`);
  }
  const auth = await decryptConnectorAuth(connection);
  return {
    connection,
    connector: createConnector(asPlatform(target.platform), auth, buildEgressFetch(proxy)),
  };
}
