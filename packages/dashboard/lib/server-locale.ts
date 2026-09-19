import { CATALOGS, LocaleCatalog, normalizeLocale, type MessageKey, type SupportedLocale } from '@axiom/core';
import { api } from './api';

const catalog = new LocaleCatalog(CATALOGS);

/**
 * Resolve the persisted dashboard locale for server-rendered pages.
 *
 * Server components cannot consume the client LocaleProvider directly. This
 * helper uses the same authenticated preference endpoint and catalog, while
 * failing closed to English when a page is rendered before a session or when
 * the preference request is unavailable.
 */
export async function getServerLocale(): Promise<{
  locale: SupportedLocale;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  dateTime: (value: string | Date) => string;
}> {
  let locale: SupportedLocale = 'en';
  try {
    const snapshot = await api.uiLocale.get();
    locale = normalizeLocale(snapshot.data.locale) ?? 'en';
  } catch {
    // English is the safe fallback for an unauthenticated/unavailable request.
  }

  const intl = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  return {
    locale,
    t: (key, values) => catalog.t(locale, key, values),
    dateTime: (value) => intl.format(typeof value === 'string' ? new Date(value) : value),
  };
}
