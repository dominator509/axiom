import { describe, expect, it, vi } from 'vitest';
import { FacebookConnector } from './facebook.js';
import { DiscordConnector } from './discord.js';
import { InstagramConnector } from './instagram.js';
import { RedditConnector } from './reddit.js';
import { TelegramConnector } from './telegram.js';
import { XConnector } from './x.js';
import { YouTubeConnector } from './youtube.js';
import type { ConnectorAuth } from './types.js';

function transport(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

function auth(...grantedScopes: string[]): ConnectorAuth {
  return { accessToken: 'fixture-token', externalUserId: 'account-1', extra: { grantedScopes } };
}

describe('provider community operations', () => {
  it('normalizes and paginates Instagram comments through the Graph API', async () => {
    const fetchImpl = transport({ data: [{ id: 'comment-1', text: 'hello', username: 'fan', timestamp: '2026-01-01T00:00:00Z' }], paging: { cursors: { after: 'next' } } });
    const connector = new InstagramConnector(auth('instagram_manage_comments'), fetchImpl);
    expect(connector.capability().operations).toContain('comments.read');
    await expect(connector.executeOperation({ type: 'comments.read', postId: 'media-1' })).resolves.toEqual({
      type: 'comments',
      items: [{ id: 'comment-1', postId: 'media-1', text: 'hello', authorName: 'fan', createdAt: '2026-01-01T00:00:00Z' }],
      nextCursor: 'next',
    });
  });

  it('fails Instagram operations closed when comment scope was not granted', async () => {
    const fetchImpl = transport({ data: [] });
    const connector = new InstagramConnector(auth('instagram_content_publish'), fetchImpl);
    expect(connector.capability().operations).toEqual([]);
    await expect(connector.executeOperation({ type: 'comments.read', postId: 'media-1' })).rejects.toThrow(/permission was not granted/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('replies to a Facebook Page comment only with engagement permission', async () => {
    const fetchImpl = transport({ id: 'reply-1' });
    const connector = new FacebookConnector(auth('pages_manage_engagement'), fetchImpl);
    await expect(connector.executeOperation({ type: 'comments.reply', commentId: 'comment-1', text: 'Thanks!' })).resolves.toEqual({ type: 'mutation', success: true, remoteId: 'reply-1' });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('/comment-1/comments');
  });

  it('moderates YouTube comments through force-ssl and rejects block semantics', async () => {
    const fetchImpl = transport({});
    const connector = new YouTubeConnector(auth('https://www.googleapis.com/auth/youtube.force-ssl'), fetchImpl);
    expect(connector.capability().moderationActions).toEqual(['hide', 'delete', 'approve', 'reject']);
    await expect(connector.executeOperation({ type: 'comments.moderate', commentId: 'comment-1', action: 'reject' })).resolves.toEqual({ type: 'mutation', success: true, remoteId: 'comment-1' });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('moderationStatus=rejected');
    await expect(connector.executeOperation({ type: 'comments.moderate', commentId: 'comment-1', action: 'block' })).rejects.toThrow(/does not support/);
  });

  it('advertises only concrete moderation actions implemented by each provider', () => {
    expect(new InstagramConnector(auth('instagram_manage_comments')).capability().moderationActions).toEqual(['hide', 'delete', 'approve']);
    expect(new FacebookConnector(auth('pages_manage_engagement')).capability().moderationActions).toEqual(['hide', 'delete', 'approve']);
    expect(new RedditConnector(auth('modposts')).capability().moderationActions).toEqual(['hide', 'delete', 'approve', 'reject']);
    expect(new RedditConnector(auth('read')).capability().moderationActions).toEqual([]);
  });

  it('posts Reddit replies as form data with the submit scope', async () => {
    const fetchImpl = transport({ json: { data: { things: [{ data: { name: 't1_reply' } }] } } });
    const connector = new RedditConnector(auth('submit'), fetchImpl);
    await expect(connector.executeOperation({ type: 'comments.reply', commentId: 't1_parent', text: 'Thanks' })).resolves.toEqual({ type: 'mutation', success: true, remoteId: 't1_reply' });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(new URLSearchParams(init.body as string).get('thing_id')).toBe('t1_parent');
  });

  it('replies to an X post via the v2 replies field', async () => {
    const fetchImpl = transport({ data: { id: 'reply-2' } });
    const connector = new XConnector(auth('tweet.write'), fetchImpl);
    await expect(connector.executeOperation({ type: 'comments.reply', commentId: 'post-1', text: 'Reply' })).resolves.toEqual({ type: 'mutation', success: true, remoteId: 'reply-2' });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Reply', reply: { in_reply_to_tweet_id: 'post-1' } });
  });

  it('sends a Telegram bot message only with its granted send scope', async () => {
    const fetchImpl = transport({ ok: true, result: { message_id: 81, chat: { id: 42, type: 'private' } } });
    const connector = new TelegramConnector({
      accessToken: '123:bot-token',
      extra: { grantedScopes: ['telegram.sendMessage'] },
    }, fetchImpl);
    expect(connector.capability().operations).toEqual(['messages.send']);
    await expect(connector.executeOperation({ type: 'messages.send', recipientId: '42', text: 'Hello' })).resolves.toEqual({
      type: 'mutation', success: true, remoteId: '81',
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:bot-token/sendMessage');
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '42', text: 'Hello' });
  });

  it('restricts Discord webhook messages to the OAuth-bound channel and suppresses mentions', async () => {
    const fetchImpl = transport({ id: 'discord-message-1', channel_id: 'channel-1' });
    const connector = new DiscordConnector({
      accessToken: '',
      extra: { webhookUrl: 'https://discord.com/api/webhooks/12345/webhook-token', discordChannelId: 'channel-1' },
    }, fetchImpl);
    expect(connector.capability().operations).toEqual(['messages.send']);
    await expect(connector.executeOperation({ type: 'messages.send', recipientId: 'channel-1', text: '@everyone hello' })).resolves.toEqual({
      type: 'mutation', success: true, remoteId: 'discord-message-1',
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/webhooks/12345/webhook-token?wait=true');
    expect(JSON.parse(init.body as string)).toEqual({ content: '@everyone hello', allowed_mentions: { parse: [] } });
    await expect(connector.executeOperation({ type: 'messages.send', recipientId: 'another-channel', text: 'No' })).rejects.toThrow(/restricted to the connected channel/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends a Discord bot DM only after creating the recipient DM channel', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '333333333333333333' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '444444444444444444', channel_id: '333333333333333333' }), { status: 200 }));
    const connector = new DiscordConnector({
      accessToken: 'bot-token',
      extra: { discordBot: true, discordGuildId: '111111111111111111', discordChannelId: '222222222222222222', grantedScopes: ['messages.send'] },
    }, fetchImpl as unknown as typeof fetch);
    await expect(connector.executeOperation({ type: 'messages.send', recipientId: 'user:555555555555555555', text: '@everyone hello' }))
      .resolves.toEqual({ type: 'mutation', success: true, remoteId: '444444444444444444' });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://discord.com/api/v10/users/@me/channels', expect.objectContaining({ method: 'POST' }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://discord.com/api/v10/channels/333333333333333333/messages', expect.objectContaining({ method: 'POST' }));
    const [, sendInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(sendInit.body as string)).toMatchObject({ allowed_mentions: { parse: [] } });
  });

  it('advertises and executes Discord bot moderation only for the verified permission set', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ author: { id: '555555555555555555' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const connector = new DiscordConnector({
      accessToken: 'bot-token',
      extra: {
        discordBot: true,
        discordGuildId: '111111111111111111',
        discordChannelId: '222222222222222222',
        discordCanManageMessages: true,
        discordCanBanMembers: true,
        grantedScopes: ['comments.moderate'],
      },
    }, fetchImpl as unknown as typeof fetch);
    expect(connector.capability().moderationActions).toEqual(['delete', 'block']);
    await expect(connector.executeOperation({ type: 'comments.moderate', commentId: '666666666666666666', action: 'delete' }))
      .resolves.toMatchObject({ type: 'mutation', success: true });
    await expect(connector.executeOperation({ type: 'comments.moderate', commentId: '666666666666666666', action: 'block' }))
      .resolves.toEqual({ type: 'mutation', success: true, remoteId: '555555555555555555' });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://discord.com/api/v10/channels/222222222222222222/messages/666666666666666666', expect.objectContaining({ method: 'DELETE' }));
    expect(fetchImpl).toHaveBeenNthCalledWith(3, 'https://discord.com/api/v10/guilds/111111111111111111/bans/555555555555555555', expect.objectContaining({ method: 'PUT' }));
  });
});
