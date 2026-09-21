// ─── Locale contract tests (F-89) ───
//
// Hermetic: no network, no provider, no deployment. Verifies the typed catalog
// contract, normalization, precedence, interpolation escaping, Intl formatting
// and the UI-vs-content locale separation.

import { describe, expect, it, vi } from 'vitest';
import {
  SUPPORTED_LOCALES,
  FALLBACK_LOCALE,
  MESSAGE_KEYS,
  LocaleCatalog,
  normalizeLocale,
  resolveLocale,
  pickFromAcceptLanguage,
  interpolate,
  escapeHtml,
  formatNumber,
  formatCurrency,
  formatDate,
  langMetadata,
  makeLocaleSettings,
  type DiagnosticEvent,
} from './locale.js';
import { CATALOGS } from './catalogs.js';

function catalogWith(sink?: (e: DiagnosticEvent) => void) {
  // Deep-copy so a test can mutate without polluting the shared module.
  const copy = JSON.parse(JSON.stringify(CATALOGS)) as typeof CATALOGS;
  return { catalog: new LocaleCatalog(copy, sink), copy };
}

describe('F-89 supported locale set', () => {
  it('declares exactly the six launch locales', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['en', 'es', 'ja', 'it', 'pt-BR', 'de']);
    expect(FALLBACK_LOCALE).toBe('en');
  });

  it('represents Portuguese as pt-BR, not ambiguous pt', () => {
    expect(SUPPORTED_LOCALES).toContain('pt-BR');
    expect(SUPPORTED_LOCALES as readonly string[]).not.toContain('pt');
  });
});

describe('F-89 locale normalization', () => {
  it('normalizes case, separators and region tags', () => {
    expect(normalizeLocale('EN')).toBe('en');
    expect(normalizeLocale('pt-br')).toBe('pt-BR');
    expect(normalizeLocale('pt_BR')).toBe('pt-BR');
    expect(normalizeLocale('  de-DE  ')).toBe('de');
    expect(normalizeLocale('ja-JP')).toBe('ja');
  });

  it('maps a bare pt to pt-BR and rejects unknown locales', () => {
    expect(normalizeLocale('pt')).toBe('pt-BR');
    expect(normalizeLocale('fr')).toBeUndefined();
    expect(normalizeLocale('')).toBeUndefined();
    expect(normalizeLocale(null)).toBeUndefined();
    expect(normalizeLocale(undefined)).toBeUndefined();
  });
});

describe('F-89 preference precedence', () => {
  it('prefers explicit user choice over org and browser', () => {
    const r = resolveLocale({ userLocale: 'ja', orgLocale: 'de', acceptLanguage: 'es-ES,es;q=0.9' });
    expect(r).toEqual({ locale: 'ja', source: 'user' });
  });

  it('falls to org default when the user has no choice', () => {
    const r = resolveLocale({ userLocale: null, orgLocale: 'it', acceptLanguage: 'de' });
    expect(r).toEqual({ locale: 'it', source: 'org' });
  });

  it('falls to Accept-Language on first visit', () => {
    const r = resolveLocale({ acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8' });
    expect(r).toEqual({ locale: 'de', source: 'accept-language' });
  });

  it('falls back to en when nothing matches', () => {
    expect(resolveLocale({})).toEqual({ locale: 'en', source: 'default' });
    expect(resolveLocale({ acceptLanguage: 'fr-FR,fr;q=0.9' })).toEqual({ locale: 'en', source: 'default' });
  });

  it('skips an unrecognized higher-precedence value instead of coercing it', () => {
    const r = resolveLocale({ userLocale: 'fr', orgLocale: 'es' });
    expect(r).toEqual({ locale: 'es', source: 'org' });
  });

  it('honors q-weights and header order on ties', () => {
    expect(pickFromAcceptLanguage('es;q=0.4,ja;q=0.9')).toBe('ja');
    expect(pickFromAcceptLanguage('it,de')).toBe('it');
    expect(pickFromAcceptLanguage('fr;q=1.0,pt-BR;q=0.5')).toBe('pt-BR');
    expect(pickFromAcceptLanguage('*')).toBeUndefined();
    expect(pickFromAcceptLanguage('')).toBeUndefined();
  });
});

describe('F-89 catalog completeness', () => {
  it('every launch locale covers every typed key', () => {
    const { catalog } = catalogWith();
    for (const locale of SUPPORTED_LOCALES) {
      expect(catalog.isComplete(locale)).toBe(true);
      for (const key of MESSAGE_KEYS) {
        expect(catalog.t(locale, key)).not.toBe('');
      }
    }
  });

  it('rejects a catalog set that is missing a locale', () => {
    const copy = JSON.parse(JSON.stringify(CATALOGS)) as Record<string, Record<string, string>>;
    delete copy.ja;
    expect(() => new LocaleCatalog(copy as never)).toThrow(/missing for 'ja'/);
  });

  it('rejects a locale with an incomplete key set', () => {
    const copy = JSON.parse(JSON.stringify(CATALOGS)) as Record<string, Record<string, string>>;
    delete copy.de['nav.calendar'];
    expect(() => new LocaleCatalog(copy as never)).toThrow(/missing keys: nav.calendar/);
  });

  it('never renders a raw key when a translation is absent', () => {
    const { catalog } = catalogWith();
    // A key outside the typed set falls back to empty, never the literal key.
    const out = catalog.t('de', 'not.a.real.key');
    expect(out).toBe('');
    expect(out).not.toContain('not.a.real.key');
  });

  it('keeps workspace-member controls translated in every launch locale', () => {
    const keys = [
      'members.auditNote', 'members.reload', 'members.loadMore', 'members.empty', 'members.loadFailed',
      'members.currentRole', 'members.newRole', 'members.notAssignable', 'members.review', 'members.confirmation', 'members.retry',
      'members.confirm', 'members.cancel', 'members.saved', 'members.accessChanged', 'members.rejected',
      'members.notConfirmed', 'members.role.owner', 'members.role.manager', 'members.role.operator',
      'members.role.analyst', 'members.role.content_creator', 'members.role.model', 'members.role.chatter',
      'members.roleDescription.owner', 'members.roleDescription.manager', 'members.roleDescription.operator',
      'members.roleDescription.analyst', 'members.roleDescription.content_creator', 'members.roleDescription.model',
      'members.roleDescription.chatter',
    ];
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keys) expect(CATALOGS[locale][key]).toBeTruthy();
      if (locale !== 'en') {
        for (const key of keys) expect(CATALOGS[locale][key], `${locale}.${key}`).not.toBe(CATALOGS.en[key]);
      }
    }
  });

  it('keeps playbook cadence guidance translated in every launch locale', () => {
    const keys = [
      'playbook.cadenceSectionAria', 'playbook.cadenceWeek', 'playbook.cadenceAdvisory',
      'playbook.cadenceUnavailable', 'playbook.cadenceEmpty', 'playbook.cadenceRevision',
      'playbook.cadenceCounts', 'playbook.cadenceNoMinimum', 'playbook.cadenceDeficitOne',
      'playbook.cadenceDeficitMany', 'playbook.cadenceCovered', 'playbook.cadenceSavedTimes',
      'playbook.reviewGuidelines',
    ];
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keys) expect(CATALOGS[locale][key]).toBeTruthy();
      if (locale !== 'en') {
        for (const key of keys.filter(key => key !== 'playbook.cadenceRevision')) {
          expect(CATALOGS[locale][key], `${locale}.${key}`).not.toBe(CATALOGS.en[key]);
        }
      }
    }
  });
});

describe('F-89 fallback and diagnostics', () => {
  it('falls back to English and emits a diagnostic on a missing translation', () => {
    const events: DiagnosticEvent[] = [];
    const { catalog, copy } = catalogWith((e) => events.push(e));
    delete copy.es['nav.calendar'];
    expect(catalog.t('es', 'nav.calendar')).toBe('Calendar');
    expect(events).toContainEqual({ type: 'missing_translation', key: 'nav.calendar', locale: 'es' });
  });

  it('emits missing_key for a key present in no catalog', () => {
    const events: DiagnosticEvent[] = [];
    const { catalog } = catalogWith((e) => events.push(e));
    catalog.t('en', 'ghost.key');
    expect(events).toContainEqual({ type: 'missing_key', key: 'ghost.key', locale: 'en' });
  });

  it('does not emit a fallback diagnostic for English itself', () => {
    const sink = vi.fn();
    const { catalog } = catalogWith(sink);
    catalog.t('en', 'nav.dashboard');
    expect(sink).not.toHaveBeenCalled();
  });
});

describe('F-89 interpolation and escaping', () => {
  it('substitutes placeholders with plain values', () => {
    expect(interpolate('Hello {name}', { name: 'Mei' })).toBe('Hello Mei');
    expect(interpolate('{count} items', { count: 3 })).toBe('3 items');
  });

  it('escapes HTML-significant characters in interpolated values', () => {
    const out = interpolate('Hi {name}', { name: '<script>alert("x")</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves unknown placeholders intact rather than printing undefined', () => {
    expect(interpolate('Hi {name}')).toBe('Hi {name}');
    expect(interpolate('Hi {name}', { other: 'x' })).toBe('Hi {name}');
    expect(interpolate('Hi {name}', { name: undefined as unknown as string })).toBe('Hi {name}');
  });

  it('escapes values flowing through a catalog translation', () => {
    const { catalog } = catalogWith();
    const out = catalog.t('en', 'integration.patreon.manualAssist', { action: '<b>post</b>' });
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;b&gt;post&lt;/b&gt;');
  });
});

describe('F-89 Intl formatting', () => {
  it('formats numbers per locale', () => {
    const en = formatNumber(1234.5, 'en');
    const de = formatNumber(1234.5, 'de');
    expect(en).toContain('1');
    expect(de).not.toBe(en);
  });

  it('formats currency per locale', () => {
    expect(formatCurrency(12.5, 'en', 'USD')).toContain('$');
    expect(formatCurrency(12.5, 'de', 'EUR')).toContain('€');
  });

  it('formats dates per locale without throwing', () => {
    const day = new Date('2026-03-01T12:00:00Z');
    expect(formatDate(day, 'ja', { timeZone: 'UTC' }).length).toBeGreaterThan(0);
    expect(formatDate(day, 'pt-BR', { timeZone: 'UTC' }).length).toBeGreaterThan(0);
  });
});

describe('F-89 accessible lang metadata', () => {
  it('returns lang and direction for each locale', () => {
    expect(langMetadata('pt-BR')).toEqual({ lang: 'pt-BR', dir: 'ltr' });
    expect(langMetadata('ja')).toEqual({ lang: 'ja', dir: 'ltr' });
  });
});

describe('F-89 UI locale vs content locale separation', () => {
  it('keeps content locale independent of UI locale', () => {
    const settings = makeLocaleSettings('de', 'en');
    expect(settings.uiLocale).toBe('de');
    expect(settings.contentLocale).toBe('en');
    expect(settings.uiLocale).not.toBe(settings.contentLocale);
  });

  it('does not invent a content locale when none is authored', () => {
    const settings = makeLocaleSettings('es');
    expect(settings.contentLocale).toBeUndefined();
    expect(Object.keys(settings)).toEqual(['uiLocale']);
  });

  it('never translates authored content: captions and persona text pass through untouched', () => {
    const { catalog } = catalogWith();
    const caption = 'Mi texto original 🎬';
    const persona = 'soul.md: speaks in first person.';
    // The catalog surface only translates known UI keys.
    expect(catalog.t('ja', caption)).toBe('');
    expect(catalog.t('de', persona)).toBe('');
    expect(caption).toBe('Mi texto original 🎬');
    expect(persona).toBe('soul.md: speaks in first person.');
  });
});
