// ─── Weekly operator digest card localization (F-89) ───
//
// Pure contract tests: no database, no network, no filesystem.
// Proves the operator-visible digest card renders through the shared six-locale
// catalog with an org-scoped UI locale, English fallback when no valid org
// preference exists, locale-aware number/date formatting under an explicit UTC
// policy, and that provider data values are preserved rather than translated.

import { describe, expect, it } from 'vitest';
import { LocaleCatalog, SUPPORTED_LOCALES, type DiagnosticEvent } from './locale.js';
import { CATALOGS } from './catalogs.js';
import { renderDigestCard, renderViralInsightCard, resolveOrgDigestLocale, type DigestCardInput } from './digest-card.js';
import type { UiLocalePreferenceRow } from './locale-settings.js';

const DIGEST_KEYS = [
  'digest.card.title',
  'digest.card.description',
  'digest.card.notWeeklyGain',
  'digest.card.exemplars',
  'digest.card.topPlatformUnavailable',
  'digest.card.avgEngagement',
] as const;

function input(overrides: Partial<DigestCardInput> = {}): DigestCardInput {
  return {
    weekStart: '2026-08-03T00:00:00.000Z',
    posts: 5,
    views: 1200,
    avgEngagement: 0.052,
    topPlatform: 'fanvue',
    viralPosts: 1,
    strongPosts: 2,
    ...overrides,
  };
}

function row(overrides: Partial<UiLocalePreferenceRow> = {}): UiLocalePreferenceRow {
  return { scope: 'org', orgId: 'org-1', locale: 'de', updatedAt: '', ...overrides };
}

describe('resolveOrgDigestLocale', () => {
  it('resolves the organization preference for an unattended digest card', () => {
    expect(resolveOrgDigestLocale([row({ locale: 'ja' })])).toEqual({ locale: 'ja', source: 'org' });
  });

  it('ignores a user-scoped row; only the org default applies to an unattended card', () => {
    expect(resolveOrgDigestLocale([row({ scope: 'user', userId: 'u1', locale: 'es' })])).toEqual({
      locale: 'en',
      source: 'default',
    });
  });

  it('falls back to English when no preference row exists', () => {
    expect(resolveOrgDigestLocale([])).toEqual({ locale: 'en', source: 'default' });
    expect(resolveOrgDigestLocale(undefined)).toEqual({ locale: 'en', source: 'default' });
  });

  it('falls back to English for an unrecognized or malformed stored value', () => {
    expect(resolveOrgDigestLocale([row({ locale: 'xx-YY' })])).toEqual({ locale: 'en', source: 'default' });
    expect(resolveOrgDigestLocale([row({ locale: '' })])).toEqual({ locale: 'en', source: 'default' });
    expect(resolveOrgDigestLocale([row({ locale: 'klingon' })])).toEqual({ locale: 'en', source: 'default' });
  });

  it('normalizes an alias region tag to its canonical launch locale', () => {
    expect(resolveOrgDigestLocale([row({ locale: 'pt' })])).toEqual({ locale: 'pt-BR', source: 'org' });
    expect(resolveOrgDigestLocale([row({ locale: 'pt_BR' })])).toEqual({ locale: 'pt-BR', source: 'org' });
  });
});

describe('renderDigestCard', () => {
  it('renders every launch locale without falling back to English', () => {
    const events: DiagnosticEvent[] = [];
    const catalog = new LocaleCatalog(CATALOGS, (event) => events.push(event));
    for (const locale of SUPPORTED_LOCALES) {
      const card = renderDigestCard(locale, input());
      expect(card.locale).toBe(locale);
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
      // Every rendered key resolves inside the requested locale.
      for (const key of DIGEST_KEYS) catalog.t(locale, key);
    }
    expect(events.filter((e) => e.type === 'missing_translation' || e.type === 'missing_key')).toEqual([]);
  });

  it('formats counts, percentages and the window date through the locale, pinned to UTC', () => {
    const de = renderDigestCard('de', input());
    // German grouping uses a dot: 1.200 rather than 1,200.
    expect(de.description).toContain('1.200');
    // German decimal comma for the two-decimal percentage.
    expect(de.description).toContain('5,20');
    // German medium date for 2026-08-03 in UTC.
    expect(de.title).toContain('03.08.2026');

    const en = renderDigestCard('en', input());
    expect(en.description).toContain('1,200');
    expect(en.description).toContain('5.20');
    expect(en.title).toContain('Aug 3, 2026');
  });

  it('never uses the host locale for numbers (explicit locale argument)', () => {
    const ja = renderDigestCard('ja', input({ views: 1200 }));
    expect(ja.description).toMatch(/1,200/);
    const pt = renderDigestCard('pt-BR', input({ views: 1200 }));
    expect(pt.description).toMatch(/1\.200/);
  });

  it('preserves the semantic disclosure that totals are not weekly gains', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const card = renderDigestCard(locale, input());
      expect(card.description).toContain(CATALOGS[locale]['digest.card.notWeeklyGain']);
    }
  });

  it('preserves verified-exemplar counts and labels', () => {
    const card = renderDigestCard('en', input({ viralPosts: 3, strongPosts: 4 }));
    expect(card.description).toContain('3 viral / 4 strong');
    expect(card.description).toContain('current labels');
  });

  it('keeps provider-authored platform names as data, untranslated', () => {
    const fr = renderDigestCard('de', input({ topPlatform: 'OnlyFans' }));
    expect(fr.description).toContain('OnlyFans');
  });

  it('renders a localized literal when no top platform is available', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const card = renderDigestCard(locale, input({ topPlatform: 'n/a' }));
      expect(card.description).toContain(CATALOGS[locale]['digest.card.topPlatformUnavailable']);
    }
  });

  it('escapes provider data so it can never inject markup', () => {
    const card = renderDigestCard('en', input({ topPlatform: '<script>alert(1)</script>' }));
    expect(card.description).not.toContain('<script>');
    expect(card.description).toContain('&lt;script&gt;');
  });

  it('each non-English digest translation actually differs from English', () => {
    const identicalAcrossAll: string[] = [];
    for (const key of DIGEST_KEYS) {
      const en = CATALOGS.en[key];
      const others = SUPPORTED_LOCALES.filter((l) => l !== 'en').map((l) => CATALOGS[l][key]);
      if (others.every((value) => value === en)) identicalAcrossAll.push(key);
    }
    // No digest key may be satisfied by copying the English string.
    expect(identicalAcrossAll).toEqual([]);
  });

  it('every digest card key exists in all six locales with a non-empty translation', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of DIGEST_KEYS) {
        const value = CATALOGS[locale][key];
        expect(typeof value, `${locale}:${key}`).toBe('string');
        expect((value ?? '').length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('each catalog remains complete against the full typed key set', () => {
    const catalog = new LocaleCatalog(CATALOGS);
    for (const locale of SUPPORTED_LOCALES) expect(catalog.isComplete(locale)).toBe(true);
  });

  it('construction fails loud if a catalog drops one of the digest card keys', () => {
    const copy = JSON.parse(JSON.stringify(CATALOGS)) as Record<string, Record<string, string>>;
    delete copy.it['digest.card.title'];
    expect(() => new LocaleCatalog(copy as never)).toThrow(/digest\.card\.title/);
  });
});

describe('renderViralInsightCard', () => {
  const groups = [{
    platform: 'fanvue',
    learningArm: 'v2:short:question',
    learningContext: 'learn-v2:scheduled-utc-2',
    sampleSize: 4,
    meanScore: 1.25,
    publishedHourUtc: 19,
  }];

  it('renders the bounded evidence summary in every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const card = renderViralInsightCard(locale, { groups, totalSamples: 4 });
      expect(card.locale).toBe(locale);
      expect(card.title).toBe(CATALOGS[locale]['dashboard.performance.title']);
      expect(card.description).toContain('fanvue');
      expect(card.description).toContain('v2:short:question');
      expect(card.description).not.toMatch(/conversion|conversión|conversione|コンバージョン|Konversion/i);
    }
  });

  it('fails closed to an unavailable timing label when timing evidence is absent', () => {
    const card = renderViralInsightCard('en', {
      groups: [{ ...groups[0], publishedHourUtc: null }],
      totalSamples: 4,
    });
    expect(card.description).toContain(CATALOGS.en['dashboard.performance.scheduledTimeUnknown']);
  });
});
