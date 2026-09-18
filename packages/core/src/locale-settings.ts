// ─── Persisted UI-locale preference (F-89) ───
//
// Mirrors the existing settings pattern: a user-scoped preference with an
// organization default. This module defines the persistence contract and the
// read path only — no database access, no migration is executed here.

import { normalizeLocale, type SupportedLocale } from './locale.js';

export interface UiLocalePreferenceRow {
  /** 'user' for an explicit choice, 'org' for the organization default. */
  scope: 'user' | 'org';
  /** Tenant/organization id. */
  orgId: string;
  /** Present only for scope='user'. */
  userId?: string;
  /** Raw stored tag; normalized on read. */
  locale: string;
  updatedAt: string;
}

/**
 * Build the SQL predicate that selects the applicable locale rows for a user.
 * Parameterized — no interpolation of caller values into SQL text.
 */
export function buildUiLocaleLookup(): {
  sql: string;
  params: (orgId: string, userId: string) => [string, string];
} {
  return {
    sql: [
      'SELECT scope, org_id, user_id, locale, updated_at',
      'FROM ui_locale_preference',
      'WHERE org_id = $1',
      "  AND (scope = 'org' OR (scope = 'user' AND user_id = $2))",
      'ORDER BY CASE scope WHEN \'user\' THEN 0 ELSE 1 END',
      'LIMIT 1',
    ].join('\n'),
    params: (orgId: string, userId: string) => [orgId, userId],
  };
}

/**
 * Choose the stored preference to apply, preferring an explicit user row over
 * an organization default. Unrecognized stored values are ignored (not coerced).
 */
export function selectStoredPreference(
  rows: UiLocalePreferenceRow[],
): { locale: SupportedLocale; scope: 'user' | 'org' } | undefined {
  const ordered = [...rows].sort((a, b) => (a.scope === 'user' ? -1 : 0) - (b.scope === 'user' ? -1 : 0));
  for (const row of ordered) {
    const normalized = normalizeLocale(row.locale);
    if (normalized) return { locale: normalized, scope: row.scope };
  }
  return undefined;
}

export interface UiLocaleUpsert {
  table: 'ui_locale_preference';
  scope: 'user' | 'org';
  orgId: string;
  userId?: string;
  locale: SupportedLocale;
}

/** Validate an upsert before it reaches any persistence layer. */
export function makeLocaleUpsert(
  scope: 'user' | 'org',
  orgId: string,
  locale: string,
  userId?: string,
): UiLocaleUpsert {
  const normalized = normalizeLocale(locale);
  if (!normalized) {
    throw new Error(`unsupported ui locale '${locale}'`);
  }
  if (!orgId) {
    throw new Error('ui locale preference requires an org id');
  }
  if (scope === 'user' && !userId) {
    throw new Error('user-scoped ui locale preference requires a user id');
  }
  return scope === 'user'
    ? { table: 'ui_locale_preference', scope, orgId, userId, locale: normalized }
    : { table: 'ui_locale_preference', scope, orgId, locale: normalized };
}
