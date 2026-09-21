import { SUPPORTED_LOCALES, type Catalog, type SupportedLocale } from './locale.js';
import { CATALOGS as BASE_CATALOGS } from './locale-catalogs.js';
import { DASHBOARD_REMAINING_CATALOGS } from './dashboard-remaining-catalog.js';

/**
 * The single runtime catalog exposed to the application.
 *
 * The large generated catalog remains the base source, while small feature
 * catalogs are mounted here so feature work does not require editing the
 * generated file. Consumers still receive one complete Catalog per locale.
 */
export const CATALOGS: Record<SupportedLocale, Catalog> = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [
    locale,
    { ...BASE_CATALOGS[locale], ...DASHBOARD_REMAINING_CATALOGS[locale] },
  ]),
) as Record<SupportedLocale, Catalog>;
