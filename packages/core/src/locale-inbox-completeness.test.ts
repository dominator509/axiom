import { expect, it } from 'vitest';
import { MESSAGE_KEYS, SUPPORTED_LOCALES, LocaleCatalog, type DiagnosticEvent } from './locale.js';
import { CATALOGS } from './catalogs.js';

/**
 * Keys introduced by the F-89 authenticated Inbox + delivery-review slice.
 * Every key must be present and non-empty in all six launch locales.
 */
const NEW_KEYS = [
  'inbox.accessUnavailable',
  'inbox.accessUnavailableDescription',
  'inbox.back',
  'inbox.title',
  'inbox.description',
  'inbox.invalidSelection',
  'inbox.reloadChoices',
  'inbox.loadFailed',
  'inbox.accountUnavailable',
  'inbox.messagesLoadFailed',
  'inbox.noAccount',
  'inbox.noAccountContact',
  'inbox.accountLabel',
  'inbox.selectAccount',
  'inbox.loadConversations',
  'inbox.lastRetrieved',
  'inbox.snapshotNote',
  'inbox.refreshPage',
  'inbox.backToConversations',
  'inbox.emptyKindPage',
  'inbox.conversations',
  'inbox.messages',
  'inbox.read',
  'inbox.unread',
  'inbox.unreadMessages',
  'inbox.muted',
  'inbox.gifAttachment',
  'inbox.mediaAttachment',
  'inbox.noText',
  'inbox.noLastMessage',
  'inbox.openConversation',
  'inbox.timeUnavailable',
  'inbox.readByRecipient',
  'inbox.notReadByRecipient',
  'inbox.noTextInMessage',
  'inbox.mediaItems',
  'inbox.gifPreviewUnavailable',
  'inbox.payToViewPrice',
  'inbox.purchased',
  'inbox.noPurchase',
  'inbox.tipSource',
  'inbox.sentByTeamMember',
  'inbox.sentThroughApp',
  'inbox.pagesAria',
  'inbox.previousPage',
  'inbox.page',
  'inbox.nextPage',
  'inbox.reviews.summary',
  'inbox.reviews.disclaimer',
  'inbox.reviews.load',
  'inbox.reviews.loadOlder',
  'inbox.reviews.empty',
  'inbox.reviews.reportedSent',
  'inbox.reviews.unresolved',
  'inbox.reviews.operatorMessageId',
  'inbox.reviews.historyLoadFailed',
  'inbox.reviews.legend',
  'inbox.reviews.conclusionLabel',
  'inbox.reviews.stillUnresolved',
  'inbox.reviews.observedSent',
  'inbox.reviews.providerUuidLabel',
  'inbox.reviews.noteLabel',
  'inbox.reviews.guidance',
  'inbox.reviews.retry',
  'inbox.reviews.record',
  'inbox.reviews.saveNotConfirmed',
  'inbox.reviews.recorded',
];

it('every new inbox key is in the typed key set', () => {
  for (const key of NEW_KEYS) expect(MESSAGE_KEYS).toContain(key);
});

it('all six catalogs define every new inbox key with a non-empty translation', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of NEW_KEYS) {
      const value = CATALOGS[locale][key];
      expect(typeof value, `${locale}:${key}`).toBe('string');
      expect((value ?? '').length, `${locale}:${key}`).toBeGreaterThan(0);
    }
  }
});

it('each catalog is complete against the full typed key set', () => {
  const catalog = new LocaleCatalog(CATALOGS);
  for (const locale of SUPPORTED_LOCALES) expect(catalog.isComplete(locale)).toBe(true);
});

it('construction fails loud if a catalog drops one of the new inbox keys', () => {
  const copy = JSON.parse(JSON.stringify(CATALOGS)) as Record<string, Record<string, string>>;
  delete copy.ja['inbox.title'];
  expect(() => new LocaleCatalog(copy as never)).toThrow(/inbox\.title/);
});

it('no new inbox key falls back to English for a non-English locale', () => {
  const events: DiagnosticEvent[] = [];
  const catalog = new LocaleCatalog(CATALOGS, (event) => events.push(event));
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    for (const key of NEW_KEYS) catalog.t(locale, key);
  }
  expect(events.filter((e) => e.type === 'missing_translation' || e.type === 'missing_key')).toEqual([]);
});

it('interpolated inbox keys escape caller values and leave unknown placeholders intact', () => {
  const catalog = new LocaleCatalog(CATALOGS);
  for (const locale of SUPPORTED_LOCALES) {
    const escaped = catalog.t(locale, 'inbox.sentByTeamMember', { value: '<script>&"\'' });
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    // A key that has no placeholder must not swallow an unused value.
    expect(catalog.t(locale, 'inbox.title', { value: 'ignored' })).toBe(CATALOGS[locale]['inbox.title']);
  }
});
