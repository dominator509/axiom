// ─── Threads OAuth & Webhook Routes ───
// Handles the OAuth authorization flow for Threads API:
//   GET  /authorize — redirect to Meta OAuth
//   GET  /callback — exchange code for token
//   GET  /delete — Meta data-deletion callback
//   POST /uninstall — Meta app-uninstall callback

import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import type { AppBindings } from '../index.js';
import { persistEnvValues } from '../credentials.js';
import { apiError, statusTitle } from './helpers.js';
import { clearOAuthStateCookie, getOAuthStateCookie, setOAuthStateCookie } from './oauth-state.js';

const THREADS_APP_ID = process.env.THREADS_CLIENT_ID || '';
const THREADS_APP_SECRET = process.env.THREADS_CLIENT_SECRET || '';
const REDIRECT_URI = new URL(
  '/api/v1/connectors/threads/callback',
  process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3001',
).toString();
const AXIOM_ENV_FILE = process.env.AXIOM_ENV_FILE || '/root/axiom/.env';
const OAUTH_STATE_COOKIE = 'axiom_threads_oauth_state';
const OAUTH_COOKIE_PATH = '/api/v1/connectors/threads';
const OAUTH_COOKIE_SECRET = process.env.BETTER_AUTH_SECRET || THREADS_APP_SECRET;

const router = new Hono<AppBindings>();

/**
 * Step 1: Redirect user to Meta OAuth authorization page.
 */
router.get('/authorize', (c) => {
  if (!THREADS_APP_ID) {
    return apiError(c, 500, statusTitle(500), 'Threads client ID not configured');
  }
  if (!THREADS_APP_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Threads client credentials not configured');
  }

  const authUrl = new URL('https://threads.net/oauth/authorize');
  authUrl.searchParams.set('client_id', THREADS_APP_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', 'threads_basic,threads_publish');
  authUrl.searchParams.set('response_type', 'code');
  const state = randomBytes(24).toString('base64url');
  setOAuthStateCookie(
    c,
    OAUTH_STATE_COOKIE,
    { state, issuedAt: Date.now() },
    OAUTH_COOKIE_SECRET,
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

  const pending = getOAuthStateCookie(c, OAUTH_STATE_COOKIE, OAUTH_COOKIE_SECRET);
  if (!state || !pending || pending.state !== state) {
    return apiError(c, 400, statusTitle(400), 'Invalid or missing state (CSRF check failed)');
  }
  clearOAuthStateCookie(c, OAUTH_STATE_COOKIE, OAUTH_COOKIE_PATH);

  try {
    // Exchange authorization code for a short-lived access token
    const tokenResp = await fetch('https://graph.threads.net/oauth/access_token', {
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
      access_token: string;
      user_id: string;
      token_type?: string;
      expires_in?: number;
    };

    const accessToken = tokenData.access_token;
    const threadsUserId = tokenData.user_id;

    // Exchange short-lived token for a long-lived token (60 days)
    const longLivedUrl = new URL('https://graph.threads.net/access_token');
    longLivedUrl.searchParams.set('grant_type', 'th_exchange_token');
    longLivedUrl.searchParams.set('client_secret', THREADS_APP_SECRET);
    longLivedUrl.searchParams.set('access_token', accessToken);
    const longLivedResp = await fetch(longLivedUrl);

    let finalToken = accessToken;
    if (longLivedResp.ok) {
      const longLivedData = (await longLivedResp.json()) as {
        access_token: string;
        expires_in?: number;
      };
      finalToken = longLivedData.access_token;
    }

    persistEnvValues(AXIOM_ENV_FILE, {
      THREADS_ACCESS_TOKEN: finalToken,
      THREADS_USER_ID: threadsUserId,
    });
    console.log(`Threads OAuth successful: user_id=${threadsUserId}; credentials persisted`);

    return c.json({
      status: 'success',
      platform: 'threads',
      userThreadsId: threadsUserId,
      message: 'Threads connected. Credentials stored in .env.',
    });
  } catch {
    console.error('Threads OAuth exchange or persistence failed');
    return apiError(c, 500, statusTitle(500), 'Threads OAuth exchange or persistence failed');
  }
});

/**
 * Threads Deletion webhook — Meta sends GET with a confirmation_code
 * when a user requests data deletion (GDPR). Echoes the code back
 * and provides a status URL.
 *
 * In Meta Dev Portal, set Delete Callback URL to:
 *   https://axiom.fanlynks.com/api/v1/connectors/threads/delete
 */
router.get('/delete', (c) => {
  const confirmationCode = c.req.query('confirmation_code');
  if (confirmationCode) {
    const statusUrl = `https://axiom.fanlynks.com/api/v1/connectors/threads/delete/status?id=${confirmationCode}`;
    return c.json({
      url: statusUrl,
      confirmation_code: confirmationCode,
    });
  }
  return apiError(c, 400, statusTitle(400), 'Missing confirmation_code');
});

/**
 * Threads Uninstall webhook — Meta sends POST when a user removes the app.
 *
 * In Meta Dev Portal, set Uninstall Callback URL to:
 *   https://axiom.fanlynks.com/api/v1/connectors/threads/uninstall
 */
router.post('/uninstall', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const userId = (payload as Record<string, unknown>)?.user_id || 'unknown';
  console.log(`[Threads] User uninstalled app: user_id=${userId}`);
  return c.json({ status: 'acknowledged', user_id: userId });
});

/**
 * Deletion status check — user-facing endpoint to check GDPR deletion progress.
 */
router.get('/delete/status', (c) => {
  const id = c.req.query('id');
  return c.json({
    id,
    status: 'pending',
    message: 'Deletion request received and is being processed.',
  });
});

export { router as threadsAuthRouter };
