// ─── Threads OAuth & Webhook Routes ───
// Handles the OAuth authorization flow for Threads API:
//   GET  /authorize — redirect to Meta OAuth
//   GET  /callback — exchange code for token
//   GET  /delete — Meta data-deletion callback
//   POST /uninstall — Meta app-uninstall callback
//
// The callbacks stay fail-closed until a durable provider-lifecycle processor
// exists. Returning success without deleting local data would falsely satisfy
// Meta's contract and leave a remote account connected in AXIOM.

import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import type { AppBindings } from '../index.js';
import { normalizeAuthOrigin } from '@axiom/auth';
import { buildEgressFetch, resolveEgressProxy } from '@axiom/llm-gateway';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext } from './helpers.js';
import {
  clearOAuthStateCookie,
  getOAuthStateCookie,
  resolveOAuthCookieSecret,
  setOAuthStateCookie,
} from './oauth-state.js';
import { persistOAuthConnection } from './oauth-connection.js';

const THREADS_APP_ID = process.env.THREADS_CLIENT_ID || '';
const THREADS_APP_SECRET = process.env.THREADS_CLIENT_SECRET || '';
const APPLICATION_ORIGIN = normalizeAuthOrigin(
  process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3001',
);
const REDIRECT_URI = new URL('/api/v1/connectors/threads/callback', APPLICATION_ORIGIN).toString();
const OAUTH_STATE_COOKIE = 'axiom_threads_oauth_state';
const OAUTH_COOKIE_PATH = '/api/v1/connectors/threads';
// Resolve on request so build-time OpenAPI generation can import the route
// without requiring runtime deployment secrets.
const oauthStateKey = () => resolveOAuthCookieSecret();

function deletionStatusUrl(confirmationCode: string): string {
  const url = new URL('/api/v1/connectors/threads/delete/status', APPLICATION_ORIGIN);
  url.searchParams.set('id', confirmationCode);
  return url.toString();
}

const router = new Hono<AppBindings>();

/**
 * Step 1: Redirect user to Meta OAuth authorization page.
 */
router.get('/authorize', async (c) => {
  if (!THREADS_APP_ID) {
    return apiError(c, 500, statusTitle(500), 'Threads client ID not configured');
  }
  if (!THREADS_APP_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Threads client credentials not configured');
  }
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.query('modelId');
  if (!modelId) return apiError(c, 400, statusTitle(400), 'modelId query required');
  const ownsModel = await withOrgContext(orgId, (tx) => modelOrgId(tx, modelId));
  if (ownsModel !== orgId) return apiError(c, 404, statusTitle(404), 'model not found');

  const authUrl = new URL('https://threads.net/oauth/authorize');
  authUrl.searchParams.set('client_id', THREADS_APP_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set(
    'scope',
    'threads_basic,threads_content_publish,threads_manage_insights',
  );
  authUrl.searchParams.set('response_type', 'code');
  const state = randomBytes(24).toString('base64url');
  setOAuthStateCookie(
    c,
    OAUTH_STATE_COOKIE,
    { state, orgId, modelId, issuedAt: Date.now() },
    oauthStateKey(),
    OAUTH_COOKIE_PATH,
  );
  authUrl.searchParams.set('state', state);

  return c.redirect(authUrl.toString(), 302);
});

/**
 * Step 2: Handle OAuth callback — exchange code for access token.
 */
router.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  if (error) {
    return apiError(c, 400, statusTitle(400), `OAuth error: ${error} — ${errorDescription || ''}`);
  }

  if (!code) {
    return apiError(c, 400, statusTitle(400), 'Missing authorization code');
  }

  if (!THREADS_APP_ID || !THREADS_APP_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Threads client credentials not configured');
  }

  const pending = getOAuthStateCookie(c, OAUTH_STATE_COOKIE, oauthStateKey());
  if (!state || !pending || pending.state !== state) {
    return apiError(c, 400, statusTitle(400), 'Invalid or missing state (CSRF check failed)');
  }
  if (!pending.orgId || !pending.modelId) {
    return apiError(c, 400, statusTitle(400), 'OAuth state has no model connection target');
  }
  clearOAuthStateCookie(c, OAUTH_STATE_COOKIE, OAUTH_COOKIE_PATH);

  try {
    const egressProxy = await resolveEgressProxy(pending.modelId);
    if (!egressProxy) {
      return apiError(
        c,
        503,
        statusTitle(503),
        'Threads token exchange unavailable: model egress binding is unhealthy',
      );
    }
    const egressFetch = buildEgressFetch(egressProxy);

    // Exchange authorization code for a short-lived access token
    const tokenResp = await egressFetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: THREADS_APP_ID,
        client_secret: THREADS_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });

    if (!tokenResp.ok) {
      return apiError(c, 502, statusTitle(502), `Token exchange failed: HTTP ${tokenResp.status}`);
    }

    const tokenData = (await tokenResp.json()) as {
      access_token?: string;
      user_id?: string;
      token_type?: string;
      expires_in?: number;
    };

    const accessToken = tokenData.access_token;
    const threadsUserId = tokenData.user_id;
    if (!accessToken || !threadsUserId) {
      return apiError(c, 502, statusTitle(502), 'Token exchange returned incomplete credentials');
    }

    // Exchange short-lived token for a long-lived token (60 days)
    const longLivedUrl = new URL('https://graph.threads.net/access_token');
    longLivedUrl.searchParams.set('grant_type', 'th_exchange_token');
    longLivedUrl.searchParams.set('client_secret', THREADS_APP_SECRET);
    longLivedUrl.searchParams.set('access_token', accessToken);
    const longLivedResp = await egressFetch(longLivedUrl);

    let finalToken = accessToken;
    let expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
    if (longLivedResp.ok) {
      const longLivedData = (await longLivedResp.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (longLivedData.access_token) finalToken = longLivedData.access_token;
      if (typeof longLivedData.expires_in === 'number') expiresIn = longLivedData.expires_in;
    }

    const connection = await persistOAuthConnection({
      orgId: pending.orgId,
      modelId: pending.modelId,
      platform: 'threads',
      displayName: `Threads ${threadsUserId}`,
      credentials: {
        accessToken: finalToken,
        externalUserId: threadsUserId,
        expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      },
      actorRef: 'oauth:threads',
    });
    if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');

    return c.json({
      status: 'success',
      platform: 'threads',
      userThreadsId: threadsUserId,
      connectionId: connection.id,
      message: 'Threads connected.',
      expiresIn,
    });
  } catch {
    console.error('Threads OAuth exchange or encrypted connection persistence failed');
    return apiError(
      c,
      502,
      statusTitle(502),
      'Threads OAuth exchange or connection persistence failed',
    );
  }
});

/**
 * Threads Deletion webhook — Meta sends GET with a confirmation_code
 * when a user requests data deletion (GDPR). Echoes the code back
 * and provides a status URL.
 *
 * In Meta Dev Portal, set Delete Callback URL to the deployed
 * BETTER_AUTH_URL origin plus /api/v1/connectors/threads/delete.
 */
router.get('/delete', (c) => {
  const confirmationCode = c.req.query('confirmation_code');
  if (confirmationCode) {
    return c.json({
      url: deletionStatusUrl(confirmationCode),
      confirmation_code: confirmationCode,
    });
  }
  return apiError(c, 400, statusTitle(400), 'Missing confirmation_code');
});

/**
 * Threads Uninstall webhook — Meta sends POST when a user removes the app.
 *
 * In Meta Dev Portal, set Uninstall Callback URL to the deployed
 * BETTER_AUTH_URL origin plus /api/v1/connectors/threads/uninstall.
 *
 * AXIOM does not yet have a durable provider-lifecycle processor that can
 * resolve the encrypted connection by provider user id and revoke it. Do not
 * acknowledge this callback as handled; a successful response would make the
 * provider stop retrying while leaving the local connection active.
 */
router.post('/uninstall', (c) =>
  apiError(
    c,
    503,
    statusTitle(503),
    'Threads uninstall processing is unavailable; no local connection was changed',
  ),
);

/**
 * Deletion status check — user-facing endpoint to check GDPR deletion progress.
 *
 * A durable deletion record/processor is not present, so this endpoint must
 * not report a permanently pending request as if work had been accepted.
 */
router.get('/delete/status', (c) => {
  const id = c.req.query('id');
  if (!id) return apiError(c, 400, statusTitle(400), 'id query required');
  return apiError(
    c,
    503,
    statusTitle(503),
    'Threads data-deletion processing is unavailable; no deletion was confirmed',
    { id },
  );
});

export { router as threadsAuthRouter };
