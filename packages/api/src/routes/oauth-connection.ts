// Persist OAuth credentials in the same encrypted, model-scoped connection
// contract used by the normal social-account API. Provider tokens never enter
// the database or the deployment .env file in plaintext.

import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { capabilityNames, resolveCapabilities } from '@axiom/worker';
import { modelOrgId, withOrgContext, writeAudit } from './helpers.js';

const EGRESS_PLANE_URL = process.env.EGRESS_PLANE_URL ?? 'http://127.0.0.1:3000';
const EGRESS_DEK_ID = process.env.EGRESS_DEK_ID ?? 'egress-dek';

export type OAuthPlatform = 'fanvue' | 'threads';

export type OAuthCredentialEnvelope = {
  accessToken: string;
  refreshToken?: string;
  externalUserId?: string;
  expiresAt?: number;
  extra?: Record<string, unknown>;
};

export type OAuthConnectionInput = {
  orgId: string;
  modelId: string;
  platform: OAuthPlatform;
  displayName: string;
  credentials: OAuthCredentialEnvelope;
  actorRef: string;
};

export type EncryptedCredentialEnvelope = {
  encToken: Uint8Array;
  encNonce: Uint8Array;
  dekId: string;
};

/** Ask the egress plane to encrypt the connector credential envelope. */
export async function encryptOAuthCredentials(
  credentials: OAuthCredentialEnvelope,
): Promise<EncryptedCredentialEnvelope> {
  const response = await fetch(`${EGRESS_PLANE_URL}/egress/encrypt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      plaintext: Buffer.from(JSON.stringify(credentials), 'utf8').toString('base64'),
      dek_id: EGRESS_DEK_ID,
    }),
    signal: AbortSignal.timeout(2000),
  });

  if (!response.ok) throw new Error('egress credential encryption failed');

  const body = (await response.json()) as {
    enc_creds?: string;
    enc_nonce?: string;
    dek_id?: string;
  };
  if (!body.enc_creds || !body.enc_nonce) {
    throw new Error('egress credential encryption returned an incomplete envelope');
  }

  return {
    encToken: new Uint8Array(Buffer.from(body.enc_creds, 'base64')),
    encNonce: new Uint8Array(Buffer.from(body.enc_nonce, 'base64')),
    dekId: body.dek_id ?? EGRESS_DEK_ID,
  };
}

/**
 * Validate the model ownership, encrypt the credentials, then create the
 * connection and audit entry under the owning org's RLS context.
 */
export async function persistOAuthConnection(
  input: OAuthConnectionInput,
): Promise<Record<string, unknown> | null> {
  const ownsModel = await withOrgContext(input.orgId, async (tx) => {
    return (await modelOrgId(tx, input.modelId)) === input.orgId;
  });
  if (!ownsModel) return null;

  const envelope = await encryptOAuthCredentials(input.credentials);
  const capabilities = capabilityNames(resolveCapabilities(input.platform));

  return withOrgContext(input.orgId, async (tx) => {
    // Re-check ownership in the write transaction so a deleted/reassigned
    // model cannot receive credentials between validation and insertion.
    if ((await modelOrgId(tx, input.modelId)) !== input.orgId) return null;

    const [row] = await tx
      .insert(schema.platformConnection)
      .values({
        orgId: input.orgId,
        modelId: input.modelId,
        platform: input.platform,
        displayName: input.displayName,
        encToken: envelope.encToken,
        encNonce: envelope.encNonce,
        dekId: envelope.dekId,
        capabilities,
        status: 'connected',
        connectedAt: new Date(),
      })
      .returning();

    if (!row) return null;
    await writeAudit(tx, input.orgId, input.actorRef, 'social.oauth.connect', row.id, {
      platform: input.platform,
      modelId: input.modelId,
      displayName: input.displayName,
    });
    return row as Record<string, unknown>;
  });
}

/** Load one org-owned connection for a provider-specific token operation. */
export async function loadOAuthConnection(orgId: string, connectionId: string) {
  return withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(schema.platformConnection)
      .where(
        and(
          eq(schema.platformConnection.id, connectionId),
          eq(schema.platformConnection.orgId, orgId),
        ),
      )
      .limit(1),
  );
}

/** Replace an existing connection envelope after a token rotation. */
export async function updateOAuthCredentials(
  orgId: string,
  connectionId: string,
  credentials: OAuthCredentialEnvelope,
  actorRef: string,
): Promise<boolean> {
  const envelope = await encryptOAuthCredentials(credentials);
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.platformConnection)
      .set({
        encToken: envelope.encToken,
        encNonce: envelope.encNonce,
        dekId: envelope.dekId,
        status: 'connected',
      })
      .where(
        and(
          eq(schema.platformConnection.id, connectionId),
          eq(schema.platformConnection.orgId, orgId),
        ),
      )
      .returning({
        id: schema.platformConnection.id,
        platform: schema.platformConnection.platform,
      });
    if (rows.length === 0) return false;
    await writeAudit(tx, orgId, actorRef, 'social.oauth.refresh', connectionId, {
      platform: rows[0].platform,
    });
    return true;
  });
}
