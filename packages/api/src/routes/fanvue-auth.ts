// ─── Fanvue OAuth Routes (PKCE, per api.fanvue.com implementation guide) ───
//   GET /authorize — generate PKCE verifier/challenge, redirect to Fanvue login
//   GET /callback  — verify state, exchange code + verifier for tokens, persist
//                    an encrypted org/model-scoped platform connection
//   POST /refresh  — rotate the token for one org/model-scoped connection

import { Hono } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import type { AppBindings } from '../index.js';
import { connectorForConnection } from '@axiom/worker';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext } from './helpers.js';
import { clearOAuthStateCookie, getOAuthStateCookie, setOAuthStateCookie } from './oauth-state.js';
import {
  loadOAuthConnection,
  persistOAuthConnection,
  updateOAuthCredentials,
} from './oauth-connection.js';

const FANVUE_CLIENT_ID = process.env.FANVUE_CLIENT_ID || '';
const FANVUE_CLIENT_SECRET = process.env.FANVUE_CLIENT_SECRET || '';
const FANVUE_REDIRECT_URI =
  process.env.FANVUE_REDIRECT_URI ||
  new URL(
    '/api/v1/connectors/fanvue/callback',
    process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3001',
  ).toString();
const FANVUE_AUTH_URL = 'https://auth.fanvue.com/oauth2/auth';
const FANVUE_TOKEN_URL = 'https://auth.fanvue.com/oauth2/token';
// Default scopes per Fanvue docs: read:self, read:chat, plus the write scopes
// the publish/upload/metrics paths require (write:post, write:media, read:post,
// read:insights, read:fan). The connector's publish() needs write:post +
// write:media; fetchMetrics needs read:post.
const FANVUE_SCOPES = [
  'openid',
  'offline_access',
  'offline',
  'read:self',
  'read:chat',
  'read:post',
  'write:post',
  'write:media',
  'read:insights',
  'read:fan',
];

const OAUTH_STATE_COOKIE = 'axiom_fanvue_oauth_state';
const OAUTH_COOKIE_PATH = '/api/v1/connectors/fanvue';
const OAUTH_COOKIE_SECRET = process.env.BETTER_AUTH_SECRET || FANVUE_CLIENT_SECRET;

const router = new Hono<AppBindings>();

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(createHash('sha256').update(verifier).digest());
}

/**
 * GET /authorize — start the OAuth flow: build PKCE challenge and redirect to Fanvue.
 */
router.get('/authorize', async (c) => {
  if (!FANVUE_CLIENT_ID) {
    return apiError(c, 500, statusTitle(500), 'Fanvue client ID not configured');
  }
  if (!FANVUE_CLIENT_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Fanvue client credentials not configured');
  }
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.query('modelId');
  if (!modelId) return apiError(c, 400, statusTitle(400), 'modelId query required');
  const ownsModel = await withOrgContext(orgId, (tx) => modelOrgId(tx, modelId));
  if (ownsModel !== orgId) return apiError(c, 404, statusTitle(404), 'model not found');

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = base64URLEncode(randomBytes(16));
  setOAuthStateCookie(
    c,
    OAUTH_STATE_COOKIE,
    { state, verifier, orgId, modelId, issuedAt: Date.now() },
    OAUTH_COOKIE_SECRET,
    OAUTH_COOKIE_PATH,
  );

  const authUrl = new URL(FANVUE_AUTH_URL);
  authUrl.searchParams.set('client_id', FANVUE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', FANVUE_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', FANVUE_SCOPES.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return c.redirect(authUrl.toString(), 302);
});

/**
 * GET /callback — handle OAuth redirect from Fanvue, exchange code for tokens,
 * then persist an encrypted connection for the model bound to the sealed state.
 * Receives ?code=...&state=... from auth.fanvue.com
 */
router.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return apiError(c, 400, statusTitle(400), `Fanvue auth error: ${error}`);
  }

  if (!code) {
    return apiError(c, 400, statusTitle(400), 'Missing authorization code');
  }

  const pending = getOAuthStateCookie(c, OAUTH_STATE_COOKIE, OAUTH_COOKIE_SECRET);
  if (!state || !pending || pending.state !== state || !pending.verifier) {
    return apiError(c, 400, statusTitle(400), 'Invalid or missing state (CSRF check failed)');
  }
  if (!pending.orgId || !pending.modelId) {
    return apiError(c, 400, statusTitle(400), 'OAuth state has no model connection target');
  }

  clearOAuthStateCookie(c, OAUTH_STATE_COOKIE, OAUTH_COOKIE_PATH);

  if (!FANVUE_CLIENT_ID || !FANVUE_CLIENT_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Fanvue client credentials not configured');
  }

  try {
    // Exchange the auth code for tokens (client_secret_basic per Fanvue docs)
    const basicAuth = Buffer.from(`${FANVUE_CLIENT_ID}:${FANVUE_CLIENT_SECRET}`).toString('base64');

    const resp = await fetch(FANVUE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: FANVUE_REDIRECT_URI,
        code_verifier: pending.verifier,
      }),
    });

    const tokens: Record<string, unknown> = (await resp.json()) as Record<string, unknown>;

    if (!resp.ok) {
      console.error('Fanvue token exchange failed', { status: resp.status });
      return apiError(c, 400, statusTitle(400), 'Token exchange failed');
    }

    const accessToken = typeof tokens['access_token'] === 'string' ? tokens['access_token'] : '';
    const refreshToken = typeof tokens['refresh_token'] === 'string' ? tokens['refresh_token'] : '';
    const expiresIn = typeof tokens['expires_in'] === 'number' ? tokens['expires_in'] : 3600;

    if (!accessToken) {
      console.error('Fanvue token exchange succeeded without an access token');
      return apiError(c, 502, statusTitle(502), 'Token exchange returned no access token');
    }

    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const externalUserId =
      typeof tokens['user_id'] === 'string'
        ? tokens['user_id']
        : typeof tokens['user_uuid'] === 'string'
          ? tokens['user_uuid']
          : typeof tokens['sub'] === 'string'
            ? tokens['sub']
            : undefined;
    const connection = await persistOAuthConnection({
      orgId: pending.orgId,
      modelId: pending.modelId,
      platform: 'fanvue',
      displayName: externalUserId ? `Fanvue ${externalUserId}` : 'Fanvue',
      credentials: {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        externalUserId,
        expiresAt,
        extra: { clientId: FANVUE_CLIENT_ID, clientSecret: FANVUE_CLIENT_SECRET },
      },
      actorRef: 'oauth:fanvue',
    });
    if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');

    return c.json({
      success: true,
      message: 'Fanvue connected.',
      connectionId: connection.id,
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      expiresIn,
    });
  } catch {
    console.error('Fanvue token exchange or encrypted connection persistence failed');
    return apiError(c, 502, statusTitle(502), 'Token exchange or connection persistence failed');
  }
});

/**
 * POST /refresh?connectionId=... — exchange one connection's refresh token for
 * a fresh access token and persist the rotated encrypted envelope.
 * Access tokens are short-lived (~1 hour), so this keeps the deployment live
 * without a browser round-trip. Uses client_secret_basic per the Ory token
 * endpoint (client_secret_post is rejected by the server).
 *
 */
router.post('/refresh', async (c) => {
  if (!FANVUE_CLIENT_ID || !FANVUE_CLIENT_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Fanvue client credentials not configured');
  }

  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const connectionId = c.req.query('connectionId');
  if (!connectionId) return apiError(c, 400, statusTitle(400), 'connectionId query required');

  const connections = await loadOAuthConnection(orgId, connectionId);
  const connection = connections[0];
  if (!connection) return apiError(c, 404, statusTitle(404), 'connection not found');
  if (connection.platform !== 'fanvue') {
    return apiError(c, 400, statusTitle(400), 'connection is not a Fanvue account');
  }

  try {
    const { connector } = await connectorForConnection(connection);
    const refresh = (
      connector as unknown as {
        refreshAccessToken?: () => Promise<{ expiresAt: number }>;
      }
    ).refreshAccessToken;
    if (!refresh) {
      return apiError(c, 400, statusTitle(400), 'Fanvue connection has no refresh capability');
    }
    await refresh.call(connector);

    const saved = await updateOAuthCredentials(
      orgId,
      connectionId,
      connector.auth,
      c.get('userId') ?? 'system',
    );
    if (!saved) return apiError(c, 404, statusTitle(404), 'connection not found');

    return c.json({
      success: true,
      message: 'Fanvue connection refreshed.',
      expiresAt: connector.auth.expiresAt,
    });
  } catch {
    console.error('Fanvue connection refresh or encrypted persistence failed');
    return apiError(c, 502, statusTitle(502), 'Fanvue connection refresh failed');
  }
});

export { router as fanvueAuthRouter };
