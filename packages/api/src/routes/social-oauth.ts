// Model-scoped OAuth onboarding for the providers whose connector contracts
// already exist. Authorization state is sealed in an HttpOnly cookie, all
// provider traffic uses that model's healthy egress route, and tokens are
// encrypted before a connection row is written.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { normalizeAuthOrigin } from '@axiom/auth';
import { readBoundedResponseJson } from '@axiom/core';
import { buildEgressFetch, resolveEgressBinding } from '@axiom/llm-gateway';
import type { AppBindings } from '../index.js';
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
  type OAuthPlatform,
} from './oauth-connection.js';

type SocialOAuthPlatform = 'tiktok' | 'x' | 'youtube' | 'reddit' | 'instagram' | 'facebook' | 'discord';
type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  scopes?: string;
  open_id?: string;
  user_id?: string;
  webhook?: { id?: string; token?: string; channel_id?: string; guild_id?: string; name?: string };
};
type ProviderProfile = {
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  separator: ',' | ' ';
  authorizeUrl: string;
  tokenUrl: string;
  pkce: boolean;
  clientSecretRequired?: boolean;
  authorizeExtra?: (url: URL) => void;
  tokenRequest: (args: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    verifier?: string;
  }) => { headers: Record<string, string>; body: URLSearchParams };
  refreshRequest?: (args: { refreshToken: string; clientId: string; clientSecret: string }) => {
    headers: Record<string, string>;
    body: URLSearchParams;
  };
  identify: (args: {
    fetch: typeof fetch;
    accessToken: string;
    token: TokenResponse;
  }) => Promise<{ id: string; name: string; accessToken?: string; extra?: Record<string, unknown> }>;
};

const GOOGLE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const GOOGLE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const GOOGLE_READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const USER_AGENT = 'AXIOM-FanvueCRM/1.0 (social connector; contact: support@fanthynks.com)';
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_content_publish',
  'instagram_manage_insights',
];

function metaGraphVersion(): string {
  const version = process.env.META_GRAPH_API_VERSION?.trim() ?? '';
  if (!/^v\d{1,3}\.\d{1,2}$/.test(version)) {
    throw new Error('META_GRAPH_API_VERSION must be configured as a supported Graph API version');
  }
  return version;
}

const PROVIDERS: Record<SocialOAuthPlatform, ProviderProfile> = {
  tiktok: {
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    scopes: ['user.info.basic', 'video.publish', 'video.upload', 'video.list'],
    separator: ',',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    pkce: false,
    tokenRequest: ({ code, clientId, clientSecret, redirectUri }) => ({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    }),
    refreshRequest: ({ refreshToken, clientId, clientSecret }) => ({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
    }),
    identify: async ({ fetch, accessToken, token }) => {
      const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error('TikTok profile lookup failed');
      const body = await readBoundedResponseJson<{ data?: { user?: { open_id?: string; display_name?: string; username?: string } } }>(response);
      const user = body.data?.user;
      const id = user?.open_id ?? token.open_id;
      if (!id) throw new Error('TikTok profile response omitted the account ID');
      return { id, name: user?.display_name || (user?.username ? `@${user.username}` : `TikTok ${id}`), extra: user?.username ? { username: user.username } : undefined };
    },
  },
  x: {
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    scopes: ['users.read', 'tweet.read', 'tweet.write', 'tweet.moderate.write', 'media.write', 'offline.access'],
    separator: ' ',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    pkce: true,
    clientSecretRequired: false,
    tokenRequest: ({ code, clientId, clientSecret, redirectUri, verifier }) => ({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(clientSecret ? { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` } : {}),
      },
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier ?? '',
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    }),
    refreshRequest: ({ refreshToken, clientId, clientSecret }) => ({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(clientSecret ? { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` } : {}),
      },
      body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }),
    }),
    identify: async ({ fetch, accessToken }) => {
      const response = await fetch('https://api.x.com/2/users/me?user.fields=name,username', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error('X profile lookup failed');
      const body = await readBoundedResponseJson<{ data?: { id?: string; name?: string; username?: string } }>(response);
      const user = body.data;
      if (!user?.id) throw new Error('X profile response omitted the account ID');
      return { id: user.id, name: user.name || (user.username ? `@${user.username}` : `X ${user.id}`), extra: user.username ? { username: user.username } : undefined };
    },
  },
  youtube: {
    clientIdEnv: 'YOUTUBE_CLIENT_ID',
    clientSecretEnv: 'YOUTUBE_CLIENT_SECRET',
    scopes: [GOOGLE_READ_SCOPE, GOOGLE_UPLOAD_SCOPE, GOOGLE_ANALYTICS_SCOPE, 'https://www.googleapis.com/auth/youtube.force-ssl'],
    separator: ' ',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    pkce: true,
    authorizeExtra: (url) => {
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('include_granted_scopes', 'true');
      url.searchParams.set('prompt', 'consent');
    },
    tokenRequest: ({ code, clientId, clientSecret, redirectUri, verifier }) => ({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier ?? '',
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    }),
    refreshRequest: ({ refreshToken, clientId, clientSecret }) => ({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
    }),
    identify: async ({ fetch, accessToken }) => {
      const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error('YouTube channel lookup failed');
      const body = await readBoundedResponseJson<{ items?: Array<{ id?: string; snippet?: { title?: string } }> }>(response);
      const channel = body.items?.[0];
      if (!channel?.id) throw new Error('YouTube channel lookup returned no authorized channel');
      return { id: channel.id, name: channel.snippet?.title || `YouTube ${channel.id}` };
    },
  },
  reddit: {
    clientIdEnv: 'REDDIT_CLIENT_ID',
    clientSecretEnv: 'REDDIT_CLIENT_SECRET',
    scopes: ['identity', 'submit', 'read', 'modposts'],
    separator: ' ',
    authorizeUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    pkce: false,
    authorizeExtra: (url) => url.searchParams.set('duration', 'permanent'),
    tokenRequest: ({ code, clientId, clientSecret, redirectUri }) => ({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    }),
    refreshRequest: ({ refreshToken, clientId, clientSecret }) => ({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    }),
    identify: async ({ fetch, accessToken }) => {
      const response = await fetch('https://oauth.reddit.com/api/v1/me', {
        headers: { authorization: `Bearer ${accessToken}`, 'user-agent': USER_AGENT },
      });
      if (!response.ok) throw new Error('Reddit profile lookup failed');
      const user = await readBoundedResponseJson<{ id?: string; name?: string }>(response);
      if (!user.id || !user.name) throw new Error('Reddit profile response omitted the account identity');
      return { id: user.id, name: `u/${user.name}`, extra: { username: user.name } };
    },
  },
  instagram: {
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    scopes: META_SCOPES,
    separator: ',',
    authorizeUrl: 'https://www.facebook.com/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/oauth/access_token',
    pkce: false,
    tokenRequest: ({ code, clientId, clientSecret, redirectUri }) => ({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    }),
    identify: async ({ fetch, accessToken }) => {
      const version = metaGraphVersion();
      const url = new URL(`https://graph.facebook.com/${version}/me/accounts`);
      url.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username}');
      const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('Meta Page lookup failed');
      const body = await readBoundedResponseJson<{ data?: Array<{ id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string } }> }>(response);
      const pages = (body.data ?? []).filter((page) => page.id && page.access_token && page.instagram_business_account?.id);
      if (pages.length !== 1) throw new Error(pages.length === 0 ? 'No linked professional Instagram account was found' : 'Meta login has multiple linked Pages; explicit Page selection is required');
      const page = pages[0];
      return {
        id: page.instagram_business_account!.id!,
        name: page.instagram_business_account?.username ? `@${page.instagram_business_account.username}` : `Instagram ${page.instagram_business_account!.id}`,
        accessToken: page.access_token,
        extra: { metaPageId: page.id, ...(page.instagram_business_account?.username ? { username: page.instagram_business_account.username } : {}) },
      };
    },
  },
  facebook: {
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    scopes: META_SCOPES,
    separator: ',',
    authorizeUrl: 'https://www.facebook.com/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/oauth/access_token',
    pkce: false,
    tokenRequest: ({ code, clientId, clientSecret, redirectUri }) => ({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    }),
    identify: async ({ fetch, accessToken }) => {
      const version = metaGraphVersion();
      const url = new URL(`https://graph.facebook.com/${version}/me/accounts`);
      url.searchParams.set('fields', 'id,name,access_token');
      const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('Facebook Page lookup failed');
      const body = await readBoundedResponseJson<{ data?: Array<{ id?: string; name?: string; access_token?: string }> }>(response);
      const pages = (body.data ?? []).filter((page) => page.id && page.access_token);
      if (pages.length !== 1) throw new Error(pages.length === 0 ? 'No manageable Facebook Page was found' : 'Meta login has multiple Pages; explicit Page selection is required');
      const page = pages[0];
      return { id: page.id!, name: page.name || `Facebook Page ${page.id}`, accessToken: page.access_token };
    },
  },
  discord: {
    clientIdEnv: 'DISCORD_CLIENT_ID',
    clientSecretEnv: 'DISCORD_CLIENT_SECRET',
    scopes: ['webhook.incoming'],
    separator: ' ',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    pkce: false,
    tokenRequest: ({ code, clientId, clientSecret, redirectUri }) => ({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    }),
    identify: async ({ token }) => {
      const webhook = token.webhook;
      if (!webhook?.id || !webhook.token || !webhook.channel_id) throw new Error('Discord did not return an incoming webhook');
      return {
        id: webhook.channel_id,
        name: webhook.name ? `Discord ${webhook.name}` : `Discord channel ${webhook.channel_id}`,
        accessToken: '',
        extra: { webhookUrl: `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`, discordWebhookId: webhook.id, discordChannelId: webhook.channel_id, ...(webhook.guild_id ? { discordGuildId: webhook.guild_id } : {}) },
      };
    },
  },
};

const APPLICATION_ORIGIN = normalizeAuthOrigin(process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3001');
const OAUTH_COOKIE_PATH = '/api/v1/connectors';
const router = new Hono<AppBindings>();
const oauthStateKey = () => resolveOAuthCookieSecret();

function isUserPlatform(value: string): value is SocialOAuthPlatform {
  return Object.hasOwn(PROVIDERS, value);
}

function redirectUri(platform: SocialOAuthPlatform): string {
  return new URL(`/api/v1/connectors/${platform}/callback`, APPLICATION_ORIGIN).toString();
}

function parseGrantedScopes(token: TokenResponse, allowedScopes: readonly string[], separator: ',' | ' '): string[] {
  // Callback query parameters are browser-controlled and cannot establish
  // authorization. Only persist provider-token response scopes, restricted to
  // the exact grants AXIOM requested for this provider.
  const source = token.scope ?? token.scopes ?? '';
  return [...new Set(source.split(separator).map((scope) => scope.trim()).filter((scope) => allowedScopes.includes(scope)))];
}

function browserConnectionRedirect(c: Context<AppBindings>, modelId: string, platform: string) {
  if (!(c.req.header('accept') ?? '').includes('text/html')) return null;
  const target = new URL(`/models/${encodeURIComponent(modelId)}/network`, APPLICATION_ORIGIN);
  target.searchParams.set('oauth', 'connected');
  target.searchParams.set('platform', platform);
  return c.redirect(target.toString(), 303);
}

router.get('/:platform/authorize', async (c) => {
  const platform = c.req.param('platform');
  if (!isUserPlatform(platform)) return apiError(c, 404, statusTitle(404), 'OAuth provider is not supported');
  const profile = PROVIDERS[platform];
  const clientId = process.env[profile.clientIdEnv]?.trim() ?? '';
  const clientSecret = process.env[profile.clientSecretEnv]?.trim() ?? '';
  if (!clientId || (profile.clientSecretRequired !== false && !clientSecret)) {
    return apiError(c, 503, statusTitle(503), `${platform} OAuth credentials are not configured`);
  }
  const orgId = requireOrg(c);
  const modelId = c.req.query('modelId');
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!modelId) return apiError(c, 400, statusTitle(400), 'modelId query required');
  if ((await withOrgContext(orgId, (tx) => modelOrgId(tx, modelId))) !== orgId) return apiError(c, 404, statusTitle(404), 'model not found');

  const state = randomBytes(32).toString('base64url');
  const verifier = profile.pkce ? randomBytes(32).toString('base64url') : undefined;
  const challenge = verifier ? createHash('sha256').update(verifier).digest('base64url') : undefined;
  setOAuthStateCookie(c, `axiom_${platform}_oauth_state`, { state, ...(verifier ? { verifier } : {}), orgId, modelId, issuedAt: Date.now() }, oauthStateKey(), OAUTH_COOKIE_PATH);
  let authorizeUrl = profile.authorizeUrl;
  if (platform === 'instagram' || platform === 'facebook') {
    try { authorizeUrl = `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth`; }
    catch { return apiError(c, 503, statusTitle(503), 'Meta Graph API version is not configured'); }
  }
  const url = new URL(authorizeUrl);
  url.searchParams.set(platform === 'tiktok' ? 'client_key' : 'client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri(platform));
  url.searchParams.set('scope', profile.scopes.join(profile.separator));
  url.searchParams.set('state', state);
  if (challenge) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  profile.authorizeExtra?.(url);
  return c.redirect(url.toString(), 302);
});

router.get('/:platform/callback', async (c) => {
  const platformValue = c.req.param('platform');
  if (!isUserPlatform(platformValue)) return apiError(c, 404, statusTitle(404), 'OAuth provider is not supported');
  const platform = platformValue;
  const profile = PROVIDERS[platform];
  const state = c.req.query('state');
  const code = c.req.query('code');
  const providerError = c.req.query('error');
  if (providerError) return apiError(c, 400, statusTitle(400), `${platform} authorization was not completed`);
  if (!state || !code) return apiError(c, 400, statusTitle(400), 'OAuth callback requires code and state');
  const pending = getOAuthStateCookie(c, `axiom_${platform}_oauth_state`, oauthStateKey());
  if (!pending || pending.state !== state || !pending.orgId || !pending.modelId) return apiError(c, 400, statusTitle(400), 'Invalid or expired OAuth state');
  clearOAuthStateCookie(c, `axiom_${platform}_oauth_state`, OAUTH_COOKIE_PATH);
  const clientId = process.env[profile.clientIdEnv]?.trim() ?? '';
  const clientSecret = process.env[profile.clientSecretEnv]?.trim() ?? '';
  if (!clientId || (profile.clientSecretRequired !== false && !clientSecret)) {
    return apiError(c, 503, statusTitle(503), `${platform} OAuth credentials are not configured`);
  }

  try {
    const binding = await resolveEgressBinding(pending.modelId);
    if (!binding) return apiError(c, 503, statusTitle(503), `${platform} token exchange requires healthy model egress`);
    const egressFetch = buildEgressFetch(binding);
    const request = profile.tokenRequest({ code, clientId, clientSecret, redirectUri: redirectUri(platform), verifier: pending.verifier });
    const tokenUrl = platform === 'instagram' || platform === 'facebook'
      ? `https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token`
      : profile.tokenUrl;
    const tokenResponse = await egressFetch(tokenUrl, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!tokenResponse.ok) return apiError(c, 502, statusTitle(502), `${platform} token exchange failed`);
    const token = await readBoundedResponseJson<TokenResponse>(tokenResponse);
    if (!token.access_token) return apiError(c, 502, statusTitle(502), `${platform} token exchange returned no access token`);
    const identity = await profile.identify({ fetch: egressFetch, accessToken: token.access_token, token });
    const grantedScopes = parseGrantedScopes(token, profile.scopes, profile.separator);
    const connection = await persistOAuthConnection({
      orgId: pending.orgId,
      modelId: pending.modelId,
      platform: platform as OAuthPlatform,
      displayName: identity.name,
      credentials: {
        accessToken: identity.accessToken ?? token.access_token,
        ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
        externalUserId: identity.id,
        ...(typeof token.expires_in === 'number' ? { expiresAt: Math.floor(Date.now() / 1000) + token.expires_in } : {}),
        extra: {
          grantedScopes,
          ...(identity.extra ?? {}),
        },
      },
      actorRef: `oauth:${platform}`,
    });
    if (!connection) return apiError(c, 404, statusTitle(404), 'model not found');
    const browser = browserConnectionRedirect(c, pending.modelId, platform);
    if (browser) return browser;
    return c.json({ status: 'success', platform, connectionId: connection.id, displayName: identity.name, grantedScopes });
  } catch {
    console.error(`${platform} OAuth exchange, identity verification, or encrypted persistence failed`);
    return apiError(c, 502, statusTitle(502), `${platform} OAuth connection failed`);
  }
});

router.post('/:platform/refresh', async (c) => {
  const platform = c.req.param('platform');
  if (!isUserPlatform(platform)) return apiError(c, 404, statusTitle(404), 'OAuth provider is not supported');
  const profile = PROVIDERS[platform];
  if (!profile.refreshRequest) {
    return apiError(c, 409, statusTitle(409), `${platform} requires reconnecting instead of token refresh`);
  }
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const connectionId = c.req.query('connectionId');
  if (!connectionId) return apiError(c, 400, statusTitle(400), 'connectionId query required');

  const [connection] = await loadOAuthConnection(orgId, connectionId);
  if (!connection || connection.platform !== platform) return apiError(c, 404, statusTitle(404), 'connection not found');
  if ((await withOrgContext(orgId, (tx) => modelOrgId(tx, connection.modelId))) !== orgId) {
    return apiError(c, 404, statusTitle(404), 'model not found');
  }
  const clientId = process.env[profile.clientIdEnv]?.trim() ?? '';
  const clientSecret = process.env[profile.clientSecretEnv]?.trim() ?? '';
  if (!clientId || (profile.clientSecretRequired !== false && !clientSecret)) {
    return apiError(c, 503, statusTitle(503), `${platform} OAuth credentials are not configured`);
  }

  try {
    const binding = await resolveEgressBinding(connection.modelId);
    if (!binding) return apiError(c, 503, statusTitle(503), `${platform} refresh requires healthy model egress`);
    const credentials = await decryptOAuthCredentials(connection);
    if (!credentials.refreshToken) return apiError(c, 409, statusTitle(409), `${platform} account requires reconnecting`);
    const request = profile.refreshRequest({ refreshToken: credentials.refreshToken, clientId, clientSecret });
    const response = await buildEgressFetch(binding)(profile.tokenUrl, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return apiError(c, 502, statusTitle(502), `${platform} token refresh failed; reconnect if the provider revoked access`);
    }
    const token = await readBoundedResponseJson<TokenResponse>(response);
    if (!token.access_token) return apiError(c, 502, statusTitle(502), `${platform} refresh returned no access token`);
    const refreshedScopes = parseGrantedScopes(token, profile.scopes, profile.separator);
    const updated = await updateOAuthCredentials(orgId, connectionId, {
      ...credentials,
      accessToken: token.access_token,
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      ...(typeof token.expires_in === 'number' ? { expiresAt: Math.floor(Date.now() / 1000) + token.expires_in } : {}),
      extra: {
        ...(credentials.extra ?? {}),
        ...(refreshedScopes.length > 0 ? { grantedScopes: refreshedScopes } : {}),
      },
    }, c.get('userId') ?? 'system');
    if (!updated) return apiError(c, 404, statusTitle(404), 'connection not found');
    return c.json({ status: 'success', platform, refreshed: true });
  } catch {
    console.error(`${platform} OAuth refresh or encrypted persistence failed`);
    return apiError(c, 502, statusTitle(502), `${platform} OAuth connection refresh failed`);
  }
});

export { router as socialOAuthRouter };
