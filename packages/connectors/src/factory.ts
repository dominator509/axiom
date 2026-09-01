import type { Platform } from '@axiom/core';
import type { ConnectorAuth, SocialConnector } from './types.js';
import { InstagramConnector } from './instagram.js';
import { TikTokConnector } from './tiktok.js';
import { YouTubeConnector } from './youtube.js';
import { XConnector } from './x.js';
import { FacebookConnector } from './facebook.js';
import { RedditConnector } from './reddit.js';
import { ThreadsConnector } from './threads.js';
import { DiscordConnector } from './discord.js';
import { TelegramConnector } from './telegram.js';
import { SnapchatConnector } from './snapchat.js';
import { FanvueConnector } from './fanvue.js';

/**
 * Construct a connector with the credential and HTTP client for one
 * connection. The registry is intentionally deployment-global and therefore
 * must not be used for tenant-scoped publish or metrics work.
 */
export function createConnector(
  platform: Platform,
  auth: ConnectorAuth,
  fetchImpl: typeof fetch = globalThis.fetch,
): SocialConnector {
  switch (platform) {
    case 'instagram':
      return new InstagramConnector(auth, fetchImpl);
    case 'tiktok':
      return new TikTokConnector(auth, fetchImpl);
    case 'youtube':
      return new YouTubeConnector(auth, fetchImpl);
    case 'x':
      return new XConnector(auth, fetchImpl);
    case 'facebook':
      return new FacebookConnector(auth, fetchImpl);
    case 'reddit':
      return new RedditConnector(auth, fetchImpl);
    case 'threads':
      return new ThreadsConnector(auth, fetchImpl);
    case 'discord':
      return new DiscordConnector(auth, fetchImpl);
    case 'telegram':
      return new TelegramConnector(auth, fetchImpl);
    case 'snapchat':
      return new SnapchatConnector(auth, fetchImpl);
    case 'fanvue':
      return new FanvueConnector(auth, fetchImpl);
    default: {
      const exhaustive: never = platform;
      throw new Error(`Unsupported connector platform '${exhaustive}'`);
    }
  }
}
