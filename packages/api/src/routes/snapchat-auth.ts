// Snapchat Public Profile API OAuth plus an explicit non-OAuth manual-assist
// connection. Automatic publishing is available only to an approved app.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AppBindings } from '../index.js';
import { normalizeAuthOrigin } from '@axiom/auth';
import { buildEgressFetch, resolveEgressBinding } from '@axiom/llm-gateway';
import { readBoundedResponseJson } from '@axiom/core';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext } from './helpers.js';
import {
  clearOAuthStateCookie,
  getOAuthStateCookie,
  resolveOAuthCookieSecret,
  setOAuthStateCookie,
} from './oauth-state.js';
import {
  decryptOAuthCredentials,
  loadOAuthConnection,
  persistOAuthConnection,
  updateOAuthCredentials,
} from './oauth-connection.js';

const APPLICATION_ORIGIN = normalizeAuthOrigin(process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3001');
const REDIRECT_URI = new URL('/api/v1/connectors/snapchat/callback', APPLICATION_ORIGIN).toString();
const OAUTH_STATE_COOKIE = 'axiom_snapchat_oauth_state';
const OAUTH_COOKIE_PATH = '/api/v1/connectors/snapchat';
const OAUTH_TIMEOUT_MS = 30_000;
const TOKEN_URL = 'https://accounts.snapchat.com/login/oauth2/access_token';
const manualSchema = z.object({ modelId: z.string().uuid(), username: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/) }).strict();
const router = new Hono<AppBindings>();

function clientId() { return process.env.SNAPCHAT_CLIENT_ID?.trim() ?? ''; }
function clientSecret() { return process.env.SNAPCHAT_CLIENT_SECRET?.trim() ?? ''; }

function browserRedirect(c: Context<AppBindings>, modelId: string) {
  if (!(c.req.header('accept') ?? '').includes('text/html')) return null;
  const destination = new URL(`/models/${encodeURIComponent(modelId)}/network`, APPLICATION_ORIGIN);
  destination.searchParams.set('oauth', 'connected');
  destination.searchParams.set('platform', 'snapchat');
  return c.redirect(destination.toString(), 303);
}

router.get('/authorize', async c => {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) return apiError(c, 503, statusTitle(503), 'Snapchat Public Profile API OAuth credentials are not configured');
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.query('modelId');
  if (!modelId) return apiError(c, 400, statusTitle(400), 'modelId query required');
  if ((await withOrgContext(orgId, tx => modelOrgId(tx, modelId))) !== orgId) return apiError(c, 404, statusTitle(404), 'model not found');

  const state = randomBytes(32).toString('base64url');
  setOAuthStateCookie(c, OAUTH_STATE_COOKIE, { state, orgId, modelId, issuedAt: Date.now() }, resolveOAuthCookieSecret(), OAUTH_COOKIE_PATH);
  const authorization = new URL('https://accounts.snapchat.com/login/oauth2/authorize');
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('client_id', id);
  authorization.searchParams.set('redirect_uri', REDIRECT_URI);
  authorization.searchParams.set('scope', 'snapchat-profile-api');
  authorization.searchParams.set('state', state);
  return c.redirect(authorization.toString(), 302);
});

router.post('/manual', zValidator('json', manualSchema), async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId, username } = c.req.valid('json');
  if ((await withOrgContext(orgId, tx => modelOrgId(tx, modelId))) !== orgId) return apiError(c, 404, statusTitle(404), 'model not found');
  const profileUrl = `https://www.snapchat.com/add/${encodeURIComponent(username)}`;
  const connection = await persistOAuthConnection({
    orgId,
    modelId,
    platform: 'snapchat',
    displayName: `Snapchat @${username}`,
    credentials: { accessToken: '', externalUserId: username, extra: { snapchatManualAssist: true, snapchatProfileUrl: profileUrl, snapchatUsername: username } },
    actorRef: `manual:snapchat:${c.get('userId') ?? 'unknown'}`,
    capabilities: ['publish', 'publish.manual_assist', 'publish.image', 'publish.video', 'publish.story'],
  });
  if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ status: 'success', platform: 'snapchat', mode: 'manual-assist', connectionId: connection.id });
});

router.post('/refresh', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const connectionId = c.req.query('connectionId');
  if (!connectionId) return apiError(c, 400, statusTitle(400), 'connectionId query required');

  const [connection] = await loadOAuthConnection(orgId, connectionId);
  if (!connection || connection.platform !== 'snapchat') {
    return apiError(c, 404, statusTitle(404), 'connection not found');
  }
  if ((await withOrgContext(orgId, tx => modelOrgId(tx, connection.modelId))) !== orgId) {
    return apiError(c, 404, statusTitle(404), 'model not found');
  }

  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) {
    return apiError(c, 503, statusTitle(503), 'Snapchat Public Profile API OAuth credentials are not configured');
  }

  try {
    const credentials = await decryptOAuthCredentials(connection);
    if (credentials.extra?.snapchatManualAssist === true || !credentials.refreshToken) {
      return apiError(c, 409, statusTitle(409), 'Snapchat account requires reconnecting instead of token refresh');
    }
    const binding = await resolveEgressBinding(connection.modelId);
    if (!binding) return apiError(c, 503, statusTitle(503), 'Snapchat refresh requires healthy model egress');
    const tokenResponse = await buildEgressFetch(binding)(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: credentials.refreshToken,
        client_id: id,
        client_secret: secret,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) {
      return apiError(c, 502, statusTitle(502), 'Snapchat token refresh failed; reconnect if the provider revoked access');
    }
    const tokens = await readBoundedResponseJson<{
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    }>(tokenResponse);
    if (!tokens.access_token) return apiError(c, 502, statusTitle(502), 'Snapchat refresh returned no access token');

    const grantedScopes = tokens.scope?.split(/\s+/).filter(Boolean);
    const updated = await updateOAuthCredentials(orgId, connectionId, {
      ...credentials,
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      ...(typeof tokens.expires_in === 'number' ? { expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in } : {}),
      extra: {
        ...(credentials.extra ?? {}),
        ...(grantedScopes && grantedScopes.length > 0 ? { grantedScopes } : {}),
      },
    }, c.get('userId') ?? 'system');
    if (!updated) return apiError(c, 404, statusTitle(404), 'connection not found');
    return c.json({ status: 'success', platform: 'snapchat', refreshed: true });
  } catch {
    console.error('Snapchat token refresh or encrypted persistence failed');
    return apiError(c, 502, statusTitle(502), 'Snapchat token refresh failed');
  }
});

router.get('/callback', async c => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const providerError = c.req.query('error');
  if (providerError) return apiError(c, 400, statusTitle(400), 'Snapchat authorization was not completed');
  if (!code || !state) return apiError(c, 400, statusTitle(400), 'Snapchat callback requires code and state');
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) return apiError(c, 503, statusTitle(503), 'Snapchat Public Profile API OAuth credentials are not configured');
  const pending = getOAuthStateCookie(c, OAUTH_STATE_COOKIE, resolveOAuthCookieSecret());
  if (!pending || pending.state !== state || !pending.orgId || !pending.modelId) return apiError(c, 400, statusTitle(400), 'Invalid or expired Snapchat OAuth state');
  clearOAuthStateCookie(c, OAUTH_STATE_COOKIE, OAUTH_COOKIE_PATH);

  try {
    const binding = await resolveEgressBinding(pending.modelId);
    if (!binding) return apiError(c, 503, statusTitle(503), 'Snapchat token exchange requires healthy model egress');
    const egressFetch = buildEgressFetch(binding);
    const tokenResponse = await egressFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: id, client_secret: secret, code, redirect_uri: REDIRECT_URI }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) return apiError(c, 502, statusTitle(502), `Snapchat token exchange returned HTTP ${tokenResponse.status}`);
    const tokens = await readBoundedResponseJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }>(tokenResponse);
    if (!tokens.access_token || !tokens.refresh_token || tokens.scope?.split(' ').includes('snapchat-profile-api') !== true) {
      return apiError(c, 502, statusTitle(502), 'Snapchat token response omitted required profile scope or token material');
    }

    const profileResponse = await egressFetch('https://businessapi.snapchat.com/v1/public_profiles/my_profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    if (!profileResponse.ok) return apiError(c, 502, statusTitle(502), `Snapchat profile verification returned HTTP ${profileResponse.status}`);
    const profileResult = await readBoundedResponseJson<{
      request_status?: string;
      public_profile?: { id?: string; display_name?: string; snap_user_name?: string };
    }>(profileResponse);
    const profile = profileResult.public_profile;
    if (profileResult.request_status !== 'SUCCESS' || !profile?.id) return apiError(c, 502, statusTitle(502), 'Snapchat did not confirm an authorized Public Profile');

    const connection = await persistOAuthConnection({
      orgId: pending.orgId,
      modelId: pending.modelId,
      platform: 'snapchat',
      displayName: profile.display_name || `Snapchat @${profile.snap_user_name ?? profile.id}`,
      credentials: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        externalUserId: profile.snap_user_name ?? profile.id,
        expiresAt: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600),
        extra: {
          grantedScopes: tokens.scope.split(/\s+/).filter(Boolean),
          snapchatProfileId: profile.id,
          ...(profile.snap_user_name ? { snapchatUsername: profile.snap_user_name, snapchatProfileUrl: `https://www.snapchat.com/add/${encodeURIComponent(profile.snap_user_name)}` } : {}),
          snapchatClientId: id,
          snapchatClientSecret: secret,
        },
      },
      actorRef: 'oauth:snapchat',
      capabilities: ['publish', 'publish.image', 'publish.video', 'publish.story', 'read.insights'],
    });
    if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');
    const browser = browserRedirect(c, pending.modelId);
    if (browser) return browser;
    return c.json({ status: 'success', platform: 'snapchat', connectionId: connection.id, profile: { id: profile.id, displayName: profile.display_name ?? null } });
  } catch {
    console.error('Snapchat OAuth exchange or encrypted connection persistence failed');
    return apiError(c, 502, statusTitle(502), 'Snapchat OAuth exchange or connection persistence failed');
  }
});

export { router as snapchatAuthRouter };
