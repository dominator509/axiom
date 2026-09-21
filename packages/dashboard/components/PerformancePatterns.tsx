'use client';

import { formatNumber, learningContextBucket, parseLearningArm } from '@axiom/core';
import { useLocale } from './LocaleProvider';

export interface PerformancePattern {
  platform: string; arm: string; context: string; mediaFormat?: string; tosVerdict?: string;
  publishedHourUtc?: number | null; sampleSize: number; meanScore: number;
}
const times: Record<string, string> = {
  'learn-v1:scheduled-utc-0': '00:00–05:59 UTC', 'learn-v1:scheduled-utc-1': '06:00–11:59 UTC',
  'learn-v1:scheduled-utc-2': '12:00–17:59 UTC', 'learn-v1:scheduled-utc-3': '18:00–23:59 UTC',
  'learn-v1:scheduled-utc-unknown': 'Scheduled time unknown',
};
const timeLabel = (context: string, unknownLabel: string, scheduledUnknown: string) => {
  const bucket = learningContextBucket(context);
  if (bucket === 'unknown') return scheduledUnknown;
  if (bucket === null) return unknownLabel;
  return times[`learn-v1:scheduled-utc-${bucket}`] ?? unknownLabel;
};
const hourBucket = (hour: number | null | undefined, unavailableLabel: string) => {
  if (hour === null || hour === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) return unavailableLabel;
  const start = Math.floor(hour / 6) * 6;
  return `${String(start).padStart(2, '0')}:00–${String(start + 5).padStart(2, '0')}:59 UTC`;
};
export default function PerformancePatterns({ patterns }: { patterns?: { groups: PerformancePattern[]; truncated: boolean; minimumSample: number } }) {
  const { locale, t } = useLocale();
  return <section className="card stack" aria-label={t('dashboard.performance.ariaLabel')}>
    <h3>{t('dashboard.performance.title')}</h3>
    <p className="subtle">{t('dashboard.performance.description')}</p>
    {!patterns ? <p>{t('dashboard.performance.patternsUnavailable')}</p> : patterns.groups.length === 0 ? <p>{t('dashboard.performance.patternsNotEnough', { count: formatNumber(patterns.minimumSample, locale) })}</p> : <div className="grid">{patterns.groups.map(group => {
      const parsed = parseLearningArm(group.arm);
      const length = parsed?.captionLength ?? 'unknown';
      const kind = parsed?.captionShape ?? 'statement';
      const richEvidence = parsed?.version === 'learn-v2'
        ? ` · ${parsed.hookType ?? t('dashboard.performance.unknownFormat')} ${t('dashboard.performance.hook')} · ${parsed.format ?? t('dashboard.performance.unknownFormat')} ${t('dashboard.performance.format')}${parsed.timingBucket ? ` · ${parsed.timingBucket} ${t('dashboard.performance.timing')}` : ''}`
        : '';
      return <article className="card stack" key={`${group.platform}:${group.arm}:${group.context}:${group.mediaFormat ?? 'unknown'}:${group.tosVerdict ?? 'unavailable'}:${group.publishedHourUtc ?? 'unknown'}`}>
        <h4>{group.platform} · {length} caption · {kind === 'question' ? t('dashboard.performance.questionMark') : t('dashboard.performance.noQuestionMark')}{richEvidence}</h4>
        <p>{timeLabel(group.context, t('dashboard.performance.unknownScheduledTime'), t('dashboard.performance.scheduledTimeUnknown'))}</p>
        <p>{t('dashboard.performance.recordedMedia')}: {group.mediaFormat && group.mediaFormat !== 'unknown' ? group.mediaFormat : t('dashboard.performance.unknownFormat')} · {t('dashboard.performance.published')}: {hourBucket(group.publishedHourUtc, t('dashboard.performance.publicationTimeUnavailable'))}</p>
        <p>{t('dashboard.performance.tosVerdict')}: {group.tosVerdict && group.tosVerdict !== 'unavailable' ? group.tosVerdict : t('model.unavailable')}</p>
        <p>{t('dashboard.performance.labeledExemplars', { count: formatNumber(group.sampleSize, locale) })} · {t('dashboard.performance.meanRelativeScore', { score: formatNumber(group.meanScore, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</p>
      </article>;
    })}</div>}
    {patterns?.truncated && <p>{t('dashboard.performance.showingTopGroups')}</p>}
    <p className="subtle">{t('dashboard.performance.exploratoryDisclaimer')}</p>
  </section>;
}
