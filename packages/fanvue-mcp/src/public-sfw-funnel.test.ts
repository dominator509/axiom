import { describe, expect, it } from 'vitest';
import {
  buildPublicSfwReply,
  isPrivateCommunityInvite,
  parsePublicSfwDraft,
  publicSfwReplyDelayMs,
  PUBLIC_SFW_SYSTEM_PROMPT,
  validatePublicSfwReply,
} from './public-sfw-funnel.js';

describe('public SFW funnel contracts', () => {
  it('parses bounded JSON and requires explicit invite intent', () => {
    expect(parsePublicSfwDraft('{"reply":"Thanks for stopping by!","includeInvite":false}'))
      .toEqual({ reply: 'Thanks for stopping by!', includeInvite: false });
    expect(parsePublicSfwDraft('{"reply":"Where can I join?","includeInvite":true}'))
      .toEqual({ reply: 'Where can I join?', includeInvite: true });
    expect(parsePublicSfwDraft('```json\n{"reply":"Hi","includeInvite":true}\n```')).toBeNull();
    expect(parsePublicSfwDraft('{"reply":"https://bad.example","includeInvite":true}')).toBeNull();
    expect(parsePublicSfwDraft('{"reply":"Hi","includeInvite":"true"}')).toBeNull();
  });

  it('permits only HTTPS Discord and private Telegram invite URLs', () => {
    expect(isPrivateCommunityInvite('https://discord.gg/Invite-Code')).toBe(true);
    expect(isPrivateCommunityInvite('https://discord.com/invite/Invite-Code')).toBe(true);
    expect(isPrivateCommunityInvite('https://t.me/+abcDEF_123456')).toBe(true);
    expect(isPrivateCommunityInvite('https://t.me/joinchat/abcDEF_123456')).toBe(true);
    expect(isPrivateCommunityInvite('http://discord.gg/Invite-Code')).toBe(false);
    expect(isPrivateCommunityInvite('https://t.me/publicchannel')).toBe(false);
    expect(isPrivateCommunityInvite('https://discord.gg/Invite-Code?next=https://bad.example')).toBe(false);
    expect(isPrivateCommunityInvite('https://user:pass@discord.gg/Invite-Code')).toBe(false);
  });

  it('injects only explicit invites and sends only ToS-clean SFW replies', () => {
    const inviteUrl = 'https://discord.gg/Invite-Code';
    expect(buildPublicSfwReply({ reply: 'Thanks!', includeInvite: false }, inviteUrl)).toBe('Thanks!');
    const withInvite = buildPublicSfwReply({ reply: 'Here you go.', includeInvite: true }, inviteUrl);
    expect(withInvite).toContain(inviteUrl);
    expect(validatePublicSfwReply(withInvite, 'x')).toBe(true);
    expect(validatePublicSfwReply('Thanks, check https://bad.example', 'x')).toBe(false);
    expect(validatePublicSfwReply('This is an erotic topic', 'reddit')).toBe(false);
    expect(validatePublicSfwReply('Thanks!', 'tiktok')).toBe(false);
  });

  it('keeps the queue delay between two and eight minutes', () => {
    expect(publicSfwReplyDelayMs(0)).toBe(120_000);
    expect(publicSfwReplyDelayMs(0.5)).toBeGreaterThanOrEqual(120_000);
    expect(publicSfwReplyDelayMs(0.5)).toBeLessThanOrEqual(480_000);
    expect(publicSfwReplyDelayMs(1)).toBe(480_000);
    expect(PUBLIC_SFW_SYSTEM_PROMPT).toContain('SFW-only');
    expect(PUBLIC_SFW_SYSTEM_PROMPT).toContain('untrusted context');
  });
});
