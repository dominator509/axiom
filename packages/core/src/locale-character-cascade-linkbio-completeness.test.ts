import { expect, it } from 'vitest';
import { MESSAGE_KEYS, SUPPORTED_LOCALES, LocaleCatalog, type DiagnosticEvent } from './locale.js';
import { CATALOGS } from './catalogs.js';

/**
 * Keys introduced by the F-89 character-cascade + native link-in-bio
 * localization slice (CharacterLockEditor, CascadeTemplateManager,
 * LinkbioPanel). Every key must be present and non-empty in all six launch
 * locales, and every one must be a real translation rather than an English
 * fallback for a non-English locale.
 */
const SLICE_KEYS = [
  'characterLock.editorAria',
  'characterLock.label',
  'characterLock.description',
  'characterLock.saving',
  'characterLock.checkSameSave',
  'characterLock.save',
  'characterLock.reloadProfile',
  'characterLock.saved',
  'characterLock.conflict',
  'characterLock.unconfirmed',
  'cascade.intro',
  'cascade.empty',
  'cascade.disable',
  'cascade.enable',
  'cascade.delete',
  'cascade.expandSchedule',
  'cascade.createLegend',
  'cascade.templateName',
  'cascade.stepLabel',
  'cascade.minutesAfterBase',
  'cascade.removeStep',
  'cascade.addStep',
  'cascade.save',
  'cascade.roleRequired',
  'cascade.expandLegend',
  'cascade.bundleId',
  'cascade.bundleIdPlaceholder',
  'cascade.baseTime',
  'cascade.expandNote',
  'cascade.retry',
  'cascade.error.validation',
  'cascade.error.notAccepted',
  'cascade.error.notConfirmed',
  'cascade.error.unconfirmedResponse',
  'cascade.error.expandInputs',
  'cascade.error.expandTargets',
  'cascade.saved',
  'cascade.expandedOne',
  'cascade.expandedMany',
  'cascade.disabledMessage',
  'cascade.enabledMessage',
  'cascade.deleted',
  'cascade.confirmExpand',
  'cascade.confirmDelete',
  'linkbio.kind',
  'linkbio.primary',
  'linkbio.clicks',
  'linkbio.disable',
  'linkbio.nativeLinks',
  'linkbio.noLinks',
  'linkbio.remove',
  'linkbio.linkLabel',
  'linkbio.linkUrl',
  'linkbio.labelPlaceholder',
  'linkbio.urlPlaceholder',
  'linkbio.addLink',
  'linkbio.saveLinks',
  'linkbio.retry',
  'linkbio.enableNative',
  'linkbio.roleRequiredEdit',
  'linkbio.roleRequired',
  'linkbio.error.enableFailed',
  'linkbio.error.unconfirmed',
  'linkbio.error.notConfirmed',
  'linkbio.error.labelAndUrlRequired',
  'linkbio.error.limits',
  'linkbio.error.httpsRequired',
];

/** Every placeholder a key uses, so interpolation parity can be checked. */
const PLACEHOLDERS: Record<string, string[]> = {
  'characterLock.description': ['version'],
  'cascade.stepLabel': ['index'],
  'cascade.expandedMany': ['count'],
  'cascade.disabledMessage': ['name'],
  'cascade.enabledMessage': ['name'],
  'cascade.confirmExpand': ['name'],
  'cascade.confirmDelete': ['name'],
};

it('every new character/cascade/linkbio key is in the typed key set', () => {
  for (const key of SLICE_KEYS) expect(MESSAGE_KEYS).toContain(key);
});

it('all six catalogs define every slice key with a non-empty translation', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of SLICE_KEYS) {
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

it('construction fails loud if a catalog drops one of the slice keys', () => {
  const copy = JSON.parse(JSON.stringify(CATALOGS)) as Record<string, Record<string, string>>;
  delete copy.ja['cascade.save'];
  expect(() => new LocaleCatalog(copy as never)).toThrow(/cascade\.save/);
});

it('no slice key falls back to English for a non-English locale', () => {
  const events: DiagnosticEvent[] = [];
  const catalog = new LocaleCatalog(CATALOGS, (event) => events.push(event));
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    for (const key of SLICE_KEYS) catalog.t(locale, key);
  }
  expect(events.filter((e) => e.type === 'missing_translation' || e.type === 'missing_key')).toEqual([]);
});

/** Locale-neutral keys whose value is a technical token, not prose. */
const LOCALE_NEUTRAL_KEYS = new Set(['linkbio.urlPlaceholder']);

it('no slice key is left as an untranslated duplicate of its English text outside en', () => {
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    for (const key of SLICE_KEYS) {
      if (LOCALE_NEUTRAL_KEYS.has(key)) continue;
      const english = CATALOGS.en[key];
      if (english.length < 8) continue;
      expect(CATALOGS[locale][key], `${locale}:${key} equals English`).not.toBe(english);
    }
  }
});

it('interpolated slice keys keep their placeholders in every locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const [key, names] of Object.entries(PLACEHOLDERS)) {
      for (const name of names) {
        expect(CATALOGS[locale][key], `${locale}:${key}`).toContain(`{${name}}`);
      }
    }
  }
});

it('interpolated slice keys escape caller values', () => {
  const catalog = new LocaleCatalog(CATALOGS);
  for (const locale of SUPPORTED_LOCALES) {
    const escaped = catalog.t(locale, 'cascade.disabledMessage', { name: '<script>&"' });
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    // A key with no placeholder must not swallow an unused value.
    expect(catalog.t(locale, 'cascade.save', { name: 'ignored' })).toBe(CATALOGS[locale]['cascade.save']);
  }
});
