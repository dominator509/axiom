// ─── Threads OAuth & Webhook Routes ───
// Handles the OAuth authorization flow for Threads API:
//   GET  /authorize — redirect to Meta OAuth
//   GET  /callback — exchange code for token
//   GET  /delete — Meta data-deletion callback
//   POST /uninstall — Meta app-uninstall callback

import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const THREADS_APP_ID = process.env.THREADS_CLIENT_ID || '';
const THREADS_APP_SECRET = process.env.THREADS_CLIENT_SECRET || '';
const REDIRECT_URI = 'https://axiom.fanlynks.com/api/v1/auth/threads/callback';

const router = new Hono<AppBindings>();

/**
 * Step 1: Redirect user to Meta OAuth authorization page.
 */
router.get('/authorize', (c) => {
  if (!THREADS_APP_ID) {
    return c.json({ error: 'Threads client ID not configured' }, 500);
  }

  const authUrl = new URL('https://threads.net/oauth/authorize');
  authUrl.searchParams.set('client_id', THREADS_APP_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', 'threads_basic,threads_publish');
  authUrl.searchParams.set('response_type', 'code');

  return c.redirect(authUrl.toString(), 302);
});

/**
 * Step 2: Handle OAuth callback — exchange code for access token.
 */
router.get('/callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  if (error) {
    return c.json({ error: `OAuth error: ${error} — ${errorDescription || ''}` }, 400);
  }

  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
  }

  if (!THREADS_APP_ID || !THREADS_APP_SECRET) {
    return c.json({ error: 'Threads client credentials not configured' }, 500);
  }

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
      const errorBody = await tokenResp.text();
      return c.json({ error: `Token exchange failed: HTTP ${tokenResp.status} — ${errorBody}` }, 502);
    }

    const tokenData = await tokenResp.json() as {
      access_token: string;
      user_id: string;
      token_type?: string;
      expires_in?: number;
    };

    const accessToken = tokenData.access_token;
    const threadsUserId = tokenData.user_id;

    // Exchange short-lived token for a long-lived token (60 days)
    const longLivedResp = await fetch(
      `https://graph.threads.net/access_token` +
      `?grant_type=th_exchange_token` +
      `&client_secret=${THREADS_APP_SECRET}` +
      `&access_token=${accessToken}`,
    );

    let finalToken = accessToken;
    if (longLivedResp.ok) {
      const longLivedData = await longLivedResp.json() as { access_token: string; expires_in?: number };
      finalToken = longLivedData.access_token;
    }

    console.log(`Threads OAuth successful: user_id=${threadsUserId}, token=${finalToken.slice(0, 8)}...`);

    return c.json({
      status: 'success',
      platform: 'threads',
      userThreadsId: threadsUserId,
      message: 'Threads connected. Store THREADS_ACCESS_TOKEN and THREADS_USER_ID in .env',
      tokenPreview: finalToken.slice(0, 12) + '...',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: `Threads OAuth failed: ${message}` }, 500);
  }
});

/**
 * Threads Deletion webhook — Meta sends GET with a confirmation_code
 * when a user requests data deletion (GDPR). Echoes the code back
 * and provides a status URL.
 *
 * In Meta Dev Portal, set Delete Callback URL to:
 *   https://axiom.fanlynks.com/api/v1/auth/threads/delete
 */
router.get('/delete', (c) => {
  const confirmationCode = c.req.query('confirmation_code');
  if (confirmationCode) {
    const statusUrl = `https://axiom.fanlynks.com/api/v1/auth/threads/delete/status?id=${confirmationCode}`;
    return c.json({
      url: statusUrl,
      confirmation_code: confirmationCode,
    });
  }
  return c.json({ error: 'Missing confirmation_code' }, 400);
});

/**
 * Threads Uninstall webhook — Meta sends POST when a user removes the app.
 *
 * In Meta Dev Portal, set Uninstall Callback URL to:
 *   https://axiom.fanlynks.com/api/v1/auth/threads/uninstall
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
