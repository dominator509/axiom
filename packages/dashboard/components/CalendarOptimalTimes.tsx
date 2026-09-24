import Link from 'next/link';
import { formatNumber, learningContextBucket } from '@axiom/core';
import type { PerformancePattern } from './PerformancePatterns';
import { useLocale } from './LocaleProvider';

const timeLabels: Record<string, string> = {
  'learn-v1:scheduled-utc-0': '00:00–05:59 UTC',
  'learn-v1:scheduled-utc-1': '06:00–11:59 UTC',
  'learn-v1:scheduled-utc-2': '12:00–17:59 UTC',
  'learn-v1:scheduled-utc-3': '18:00–23:59 UTC',
};
const timeLabelKeys: Record<string, string> = {
  'learn-v1:scheduled-utc-0': 'calendar.timeWindow.0',
  'learn-v1:scheduled-utc-1': 'calendar.timeWindow.1',
  'learn-v1:scheduled-utc-2': 'calendar.timeWindow.2',
  'learn-v1:scheduled-utc-3': 'calendar.timeWindow.3',
};
function legacyTimeContext(context: string): string | null {
  const bucket = learningContextBucket(context);
  return bucket === null || bucket === 'unknown' ? null : `learn-v1:scheduled-utc-${bucket}`;
}

export interface CalendarTimeSuggestion {
  platform: string;
  window: string;
  sampleSize: number;
  meanScore: number;
}

export function deriveCalendarTimeSuggestions(input?: { groups?: PerformancePattern[]; minimumSample?: number }, labelForContext: (context: string) => string = context => timeLabels[legacyTimeContext(context) ?? context]): CalendarTimeSuggestion[] {
  if (!input || !Array.isArray(input.groups)) return [];
  const candidateMinimum = input.minimumSample;
  const minimum = typeof candidateMinimum === 'number'
    && Number.isSafeInteger(candidateMinimum)
    && candidateMinimum > 0
    ? candidateMinimum
    : 3;
  return input.groups
    .filter(group => legacyTimeContext(group.context) !== null && Number.isSafeInteger(group.sampleSize) && group.sampleSize >= minimum && Number.isFinite(group.meanScore))
    .sort((left, right) => right.meanScore - left.meanScore || right.sampleSize - left.sampleSize)
    .slice(0, 4)
    .map(group => ({ platform: group.platform, window: labelForContext(group.context), sampleSize: group.sampleSize, meanScore: group.meanScore }));
}

export default function CalendarOptimalTimes({ modelId, patterns }: { modelId: string; patterns?: { groups: PerformancePattern[]; minimumSample: number } }) {
  const { locale, t } = useLocale();
  const suggestions = deriveCalendarTimeSuggestions(patterns, context => {
    const normalized = legacyTimeContext(context) ?? context;
    return t(timeLabelKeys[normalized] ?? normalized);
  });
  const scoreFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return <section className="card stack" aria-label={t('calendar.observedSuggestionsAria')}>
    <h3>{t('calendar.observedTimeSuggestions')}</h3>
    <p className="subtle">{t('calendar.advisoryWindows')}</p>
    {suggestions.length === 0
      ? <p>{t('calendar.noVerifiedWindow')}</p>
      : <div className="grid">{suggestions.map(suggestion => <article className="card stack" key={`${suggestion.platform}:${suggestion.window}`}>
        <strong>{suggestion.platform} · {suggestion.window}</strong>
        <span>{t('calendar.verifiedExemplarsScore', { sampleSize: formatNumber(suggestion.sampleSize, locale), score: scoreFormatter.format(suggestion.meanScore) })}</span>
      </article>)}</div>}
    <Link href={`/models/${encodeURIComponent(modelId)}/analytics`}>{t('calendar.reviewEvidence')}</Link>
  </section>;
}
