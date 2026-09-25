'use client';

import { useEffect, useState } from 'react';
import { useLocale } from './LocaleProvider';

export function formatLocalDateTime(value: string, locale: string, timeZone?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export default function LocalDateTime({ value, fallback }: { value: string; fallback: string }) {
  const { locale } = useLocale();
  const [display, setDisplay] = useState(fallback);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setDisplay(formatLocalDateTime(value, locale, timeZone));
  }, [locale, value]);

  return <time dateTime={value}>{display}</time>;
}
