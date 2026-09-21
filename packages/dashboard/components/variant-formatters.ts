import { formatDate, formatNumber, type SupportedLocale } from '@axiom/core';

const TWO_DECIMAL_PLACES: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

export function formatVariantCount(value: number, locale: SupportedLocale): string {
  return formatNumber(value, locale);
}

export function formatVariantMetric(value: number, locale: SupportedLocale): string {
  return formatNumber(value, locale, TWO_DECIMAL_PLACES);
}

export function formatVariantPercentValue(value: number, locale: SupportedLocale): string {
  return formatNumber(value * 100, locale, TWO_DECIMAL_PLACES);
}

export function formatVariantPercent(value: number, locale: SupportedLocale): string {
  return `${formatVariantPercentValue(value, locale)}%`;
}

export function formatVariantCollectedAt(value: string, locale: SupportedLocale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : formatDate(date, locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
}
