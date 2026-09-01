// ─── Connector bootstrap (worker startup) ───
// Registers deployment-scoped connectors for API metadata and compatibility.
// Publish/metrics executors resolve the encrypted platform_connection for the
// target instead of using these environment-backed instances. A missing env
// token still leaves the compatibility connector closed and harmless.

import { createConnector, register } from '@axiom/connectors';
import type { ConnectorAuth } from '@axiom/connectors';
import type { Platform } from '@axiom/core';

export interface ConnectorEnv {
  INSTAGRAM_ACCESS_TOKEN?: string;
  TIKTOK_ACCESS_TOKEN?: string;
  YOUTUBE_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN?: string;
  FACEBOOK_ACCESS_TOKEN?: string;
  REDDIT_ACCESS_TOKEN?: string;
  THREADS_ACCESS_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  SNAPCHAT_ACCESS_TOKEN?: string;
  FANVUE_ACCESS_TOKEN?: string;
  FANVUE_REFRESH_TOKEN?: string;
  FANVUE_CLIENT_ID?: string;
  FANVUE_CLIENT_SECRET?: string;
  FANVUE_TOKEN_EXPIRES_AT?: string;
  FANVUE_MODEL_ID?: string;
}

/** Register every real connector; a missing token is a valid (closed) state. */
export function registerConnectors(env: ConnectorEnv = process.env as ConnectorEnv): void {
  const token = (v?: string) => v ?? '';
  const registerEnvConnector = (platform: Platform, auth: ConnectorAuth) =>
    register(createConnector(platform, auth));
  registerEnvConnector('instagram', { accessToken: token(env.INSTAGRAM_ACCESS_TOKEN) });
  registerEnvConnector('tiktok', { accessToken: token(env.TIKTOK_ACCESS_TOKEN) });
  registerEnvConnector('youtube', { accessToken: token(env.YOUTUBE_ACCESS_TOKEN) });
  registerEnvConnector('x', { accessToken: token(env.X_ACCESS_TOKEN) });
  registerEnvConnector('facebook', { accessToken: token(env.FACEBOOK_ACCESS_TOKEN) });
  registerEnvConnector('reddit', { accessToken: token(env.REDDIT_ACCESS_TOKEN) });
  registerEnvConnector('threads', { accessToken: token(env.THREADS_ACCESS_TOKEN) });
  registerEnvConnector('discord', { accessToken: token(env.DISCORD_BOT_TOKEN) });
  registerEnvConnector('telegram', { accessToken: token(env.TELEGRAM_BOT_TOKEN) });
  registerEnvConnector('snapchat', { accessToken: token(env.SNAPCHAT_ACCESS_TOKEN) });
  registerEnvConnector('fanvue', {
    accessToken: token(env.FANVUE_ACCESS_TOKEN),
    refreshToken: env.FANVUE_REFRESH_TOKEN || undefined,
    expiresAt: env.FANVUE_TOKEN_EXPIRES_AT
      ? new Date(env.FANVUE_TOKEN_EXPIRES_AT).getTime() / 1000
      : undefined,
    externalUserId: env.FANVUE_MODEL_ID,
    extra: {
      clientId: env.FANVUE_CLIENT_ID || undefined,
      clientSecret: env.FANVUE_CLIENT_SECRET || undefined,
    },
  });
}
