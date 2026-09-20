import {
  CATALOGS,
  CONSENT_CATALOGS,
  FAN_CRM_CATALOGS,
  LocaleCatalog,
  normalizeLocale,
  REVIEW_CATALOGS,
  SUPPORTED_LOCALES,
  type ConsentMessageKey,
  type FanCrmMessageKey,
  type MessageKey,
  type ReviewMessageKey,
  type SupportedLocale,
} from '@axiom/core';
import { api } from './api';

const catalog = new LocaleCatalog(
  Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      {
        ...CATALOGS[locale],
        ...REVIEW_CATALOGS[locale],
        ...CONSENT_CATALOGS[locale],
        ...FAN_CRM_CATALOGS[locale],
      },
    ]),
  ) as typeof CATALOGS,
);

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
  t: (
    key: MessageKey | ReviewMessageKey | ConsentMessageKey | FanCrmMessageKey,
    values?: Record<string, string | number>,
  ) => string;
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
