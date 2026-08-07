// ─── Fanvue OAuth Routes (PKCE, per api.fanvue.com implementation guide) ───
//   GET /authorize — generate PKCE verifier/challenge, redirect to Fanvue login
//   GET /callback  — verify state, exchange code + verifier for tokens, persist to .env

import { Hono } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import type { AppBindings } from '../index.js';
import { apiError, statusTitle } from './helpers.js';

const FANVUE_CLIENT_ID = process.env.FANVUE_CLIENT_ID || '';
const FANVUE_CLIENT_SECRET = process.env.FANVUE_CLIENT_SECRET || '';
const FANVUE_REDIRECT_URI = process.env.FANVUE_REDIRECT_URI || 'https://66.94.123.250/api/v1/connectors/fanvue/callback';
const AXIOM_ENV_FILE = process.env.AXIOM_ENV_FILE || '/root/axiom/.env';

const FANVUE_AUTH_URL = 'https://auth.fanvue.com/oauth2/auth';
const FANVUE_TOKEN_URL = 'https://auth.fanvue.com/oauth2/token';
// Default scopes per Fanvue docs: openid + offline_access + offline + read:self + read:chat
const FANVUE_SCOPES = ['openid', 'offline_access', 'offline', 'read:self', 'read:chat'];

// In-memory PKCE verifier store, keyed by state (single-operator deployment)
const verifierStore = new Map<string, { verifier: string; createdAt: number }>();
const VERIFIER_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

function persistEnvToken(accessToken: string, refreshToken: string, expiresIn: number): void {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  let env = '';
  try {
    env = readFileSync(AXIOM_ENV_FILE, 'utf8');
  } catch {
    env = '';
  }

  const lines = env.split('\n');
  const upsert = (key: string, value: string) => {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  };

  upsert('FANVUE_ACCESS_TOKEN', accessToken);
  upsert('FANVUE_REFRESH_TOKEN', refreshToken);
  upsert('FANVUE_TOKEN_EXPIRES_AT', expiresAt);

  try {
    writeFileSync(AXIOM_ENV_FILE, lines.join('\n'), { mode: 0o600 });
    chmodSync(AXIOM_ENV_FILE, 0o600);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Fanvue: failed to persist tokens to .env:', msg);
  }
}

/**
 * GET /authorize — start the OAuth flow: build PKCE challenge and redirect to Fanvue.
 */
router.get('/authorize', (c) => {
  if (!FANVUE_CLIENT_ID) {
    return apiError(c, 500, statusTitle(500), 'Fanvue client ID not configured');
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = base64URLEncode(randomBytes(16));
  verifierStore.set(state, { verifier, createdAt: Date.now() });

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
 * GET /callback — handle OAuth redirect from Fanvue, exchange code for tokens, persist them.
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

  if (!state || !verifierStore.has(state)) {
    return apiError(c, 400, statusTitle(400), 'Invalid or missing state (CSRF check failed)');
  }

  const entry = verifierStore.get(state)!;
  verifierStore.delete(state); // one-time use
  if (Date.now() - entry.createdAt > VERIFIER_TTL_MS) {
    return apiError(c, 400, statusTitle(400), 'Authorization flow expired, please start again');
  }

  if (!FANVUE_CLIENT_ID || !FANVUE_CLIENT_SECRET) {
    return apiError(c, 500, statusTitle(500), 'Fanvue client credentials not configured');
  }

  try {
    // Exchange the auth code for tokens (client_secret_basic per Fanvue docs)
    const basicAuth = Buffer.from(`${FANVUE_CLIENT_ID}:${FANVUE_CLIENT_SECRET}`).toString('base64');

    const resp = await fetch(FANVUE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: FANVUE_REDIRECT_URI,
        code_verifier: entry.verifier,
      }),
    });

    const tokens: Record<string, unknown> = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      console.error('Fanvue token exchange failed:', tokens);
      return apiError(c, 400, statusTitle(400), 'Token exchange failed', { token_response: tokens });
    }

    const accessToken = typeof tokens['access_token'] === 'string' ? tokens['access_token'] : '';
    const refreshToken = typeof tokens['refresh_token'] === 'string' ? tokens['refresh_token'] : '';
    const expiresIn = typeof tokens['expires_in'] === 'number' ? tokens['expires_in'] : 3600;

    if (accessToken) {
      persistEnvToken(accessToken, refreshToken, expiresIn);
      console.log('Fanvue tokens acquired and persisted to .env');
    } else {
      console.error('Fanvue token exchange succeeded but no access_token in response:', tokens);
    }

    return c.json({
      success: true,
      message: 'Fanvue connected. Tokens stored in .env.',
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      expiresIn,
      tokenPreview: accessToken ? `${accessToken.slice(0, 12)}...` : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Fanvue token exchange error:', msg);
    return apiError(c, 500, statusTitle(500), 'Token exchange error', { cause: msg });
  }
});

export { router as fanvueAuthRouter };
