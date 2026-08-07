// ─── Connector bootstrap (worker startup) ───
// Registers the real platform connectors into the shared registry so the
// publish.target and metrics.poll executors can dispatch. Tokens come from
// env (mirrors initRelay's adapter wiring); absent tokens mean the connector
// still registers and its publish() call fails closed at the API (→ DLQ),
// which is the honest behavior for an unconfigured platform.

import { register } from '@axiom/connectors';
import {
  InstagramConnector,
  TikTokConnector,
  YouTubeConnector,
  XConnector,
  FacebookConnector,
  RedditConnector,
  ThreadsConnector,
  DiscordConnector,
  TelegramConnector,
  SnapchatConnector,
  FanvueConnector,
} from '@axiom/connectors';

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
  register(new InstagramConnector({ accessToken: token(env.INSTAGRAM_ACCESS_TOKEN) }));
  register(new TikTokConnector({ accessToken: token(env.TIKTOK_ACCESS_TOKEN) }));
  register(new YouTubeConnector({ accessToken: token(env.YOUTUBE_ACCESS_TOKEN) }));
  register(new XConnector({ accessToken: token(env.X_ACCESS_TOKEN) }));
  register(new FacebookConnector({ accessToken: token(env.FACEBOOK_ACCESS_TOKEN) }));
  register(new RedditConnector({ accessToken: token(env.REDDIT_ACCESS_TOKEN) }));
  register(new ThreadsConnector({ accessToken: token(env.THREADS_ACCESS_TOKEN) }));
  register(new DiscordConnector({ accessToken: token(env.DISCORD_BOT_TOKEN) }));
  register(new TelegramConnector({ accessToken: token(env.TELEGRAM_BOT_TOKEN) }));
  register(new SnapchatConnector({ accessToken: token(env.SNAPCHAT_ACCESS_TOKEN) }));
  register(new FanvueConnector({
    accessToken: token(env.FANVUE_ACCESS_TOKEN),
    refreshToken: env.FANVUE_REFRESH_TOKEN || undefined,
    expiresAt: env.FANVUE_TOKEN_EXPIRES_AT ? new Date(env.FANVUE_TOKEN_EXPIRES_AT).getTime() / 1000 : undefined,
    externalUserId: env.FANVUE_MODEL_ID,
    extra: {
      clientId: env.FANVUE_CLIENT_ID || undefined,
      clientSecret: env.FANVUE_CLIENT_SECRET || undefined,
    },
  }));
}
