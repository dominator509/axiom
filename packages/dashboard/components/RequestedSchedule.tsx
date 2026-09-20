'use client';

import { formatDate } from '@axiom/core';
import type { ContentBundle } from '@/lib/api';
import { useLocale } from './LocaleProvider';

export default function RequestedSchedule({ intent }: { intent: ContentBundle['publishIntent'] }) {
  const { locale, t } = useLocale();
  if (!intent) return null;
  if (intent.action !== 'schedule') return <p className="subtle">{t('review.immediatePublicationRequested')}</p>;
  const timestamp = intent.scheduledAt ? Date.parse(intent.scheduledAt) : NaN;
  if (!Number.isFinite(timestamp)) return <p role="alert">{t('review.invalidSavedSchedule')}</p>;
  const scheduledAt = new Date(timestamp);
  return <div className="card stack"><strong>{t('review.requestedSchedule', { platform: intent.platform })}</strong>
    <p><time dateTime={scheduledAt.toISOString()}>{t('review.utcTime', { value: formatDate(scheduledAt, locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) })}</time></p>
    <p className="subtle">{t('review.scheduleNotApproved')}</p>
  </div>;
}
