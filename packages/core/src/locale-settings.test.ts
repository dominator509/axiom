// ─── Persisted UI locale preference tests (F-89) ───
//
// Pure contract tests: no database, no migration execution, no network.

import { describe, expect, it } from 'vitest';
import {
  buildUiLocaleLookup,
  selectStoredPreference,
  makeLocaleUpsert,
  type UiLocalePreferenceRow,
} from './locale-settings.js';

function row(overrides: Partial<UiLocalePreferenceRow>): UiLocalePreferenceRow {
  return {
    scope: 'org',
    orgId: 'org-1',
    locale: 'en',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('F-89 ui locale lookup', () => {
  it('parameterizes org and user ids rather than interpolating SQL', () => {
    const lookup = buildUiLocaleLookup();
    expect(lookup.sql).toContain('$1');
    expect(lookup.sql).toContain('$2');
    expect(lookup.params('org-1', 'user-1')).toEqual(['org-1', 'user-1']);
    expect(lookup.sql).not.toContain('org-1');
  });

  it('orders explicit user rows ahead of the organization default', () => {
    const lookup = buildUiLocaleLookup();
    expect(lookup.sql.indexOf("WHEN 'user'")).toBeGreaterThan(-1);
    expect(lookup.sql).toContain('LIMIT 1');
  });
});

describe('F-89 stored preference selection', () => {
  it('prefers an explicit user row over the org default', () => {
    const chosen = selectStoredPreference([
      row({ scope: 'org', locale: 'de' }),
      row({ scope: 'user', userId: 'user-1', locale: 'ja' }),
    ]);
    expect(chosen).toEqual({ locale: 'ja', scope: 'user' });
  });

  it('uses the org default when no user row exists', () => {
    const chosen = selectStoredPreference([row({ scope: 'org', locale: 'pt-br' })]);
    expect(chosen).toEqual({ locale: 'pt-BR', scope: 'org' });
  });

  it('ignores an unrecognized stored locale rather than coercing it', () => {
    const chosen = selectStoredPreference([
      row({ scope: 'user', userId: 'user-1', locale: 'fr' }),
      row({ scope: 'org', locale: 'es' }),
    ]);
    expect(chosen).toEqual({ locale: 'es', scope: 'org' });
  });

  it('returns undefined when nothing is stored', () => {
    expect(selectStoredPreference([])).toBeUndefined();
  });
});

describe('F-89 locale preference validation', () => {
  it('normalizes and validates a user-scoped upsert', () => {
    expect(makeLocaleUpsert('user', 'org-1', 'pt_br', 'user-1')).toEqual({
      table: 'ui_locale_preference',
      scope: 'user',
      orgId: 'org-1',
      userId: 'user-1',
      locale: 'pt-BR',
    });
  });

  it('validates an org-scoped upsert without a user id', () => {
    const upsert = makeLocaleUpsert('org', 'org-1', 'DE');
    expect(upsert).toEqual({ table: 'ui_locale_preference', scope: 'org', orgId: 'org-1', locale: 'de' });
    expect('userId' in upsert).toBe(false);
  });

  it('rejects an unsupported locale', () => {
    expect(() => makeLocaleUpsert('user', 'org-1', 'fr', 'user-1')).toThrow(/unsupported ui locale/);
  });

  it('rejects a user-scoped upsert without a user id', () => {
    expect(() => makeLocaleUpsert('user', 'org-1', 'en')).toThrow(/requires a user id/);
  });

  it('rejects a missing org id', () => {
    expect(() => makeLocaleUpsert('org', '', 'en')).toThrow(/requires an org id/);
  });
});

describe('F-89 tenant isolation of locale preferences', () => {
  it('keeps rows from different orgs independent', () => {
    const orgA = selectStoredPreference([row({ scope: 'org', orgId: 'org-a', locale: 'de' })]);
    const orgB = selectStoredPreference([row({ scope: 'org', orgId: 'org-b', locale: 'ja' })]);
    expect(orgA?.locale).toBe('de');
    expect(orgB?.locale).toBe('ja');
    expect(orgA).not.toEqual(orgB);
  });
});
