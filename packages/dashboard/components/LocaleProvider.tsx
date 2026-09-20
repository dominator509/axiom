'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  CATALOGS,
  CONSENT_CATALOGS,
  FANVUE_ANALYTICS_CATALOGS,
  NETWORK_CHILD_CONTROLS_CATALOGS,
  LocaleCatalog,
  PLATFORM_AFFILIATE_CATALOGS,
  PROFILE_NETWORK_LIFECYCLE_CATALOGS,
  REVIEW_CATALOGS,
  SUPPORTED_LOCALES,
  type MessageKey,
  type SupportedLocale,
} from '@axiom/core';

const catalog = new LocaleCatalog(
  Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      {
        ...CATALOGS[locale],
        ...CONSENT_CATALOGS[locale],
        ...FANVUE_ANALYTICS_CATALOGS[locale],
        ...NETWORK_CHILD_CONTROLS_CATALOGS[locale],
        ...PLATFORM_AFFILIATE_CATALOGS[locale],
        ...PROFILE_NETWORK_LIFECYCLE_CATALOGS[locale],
        ...REVIEW_CATALOGS[locale],
      },
    ]),
  ) as typeof CATALOGS,
);

interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: MessageKey | string, values?: Record<string, string | number>) => string;
}

const defaultValue: LocaleContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  t: (key, values) => catalog.t('en', key, values),
};

const LocaleContext = createContext<LocaleContextValue>(defaultValue);

export default function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: SupportedLocale;
  children?: React.ReactNode;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => catalog.t(locale, key, values),
    }),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
