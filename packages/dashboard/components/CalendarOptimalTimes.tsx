import Link from 'next/link';
import type { PerformancePattern } from './PerformancePatterns';

const timeLabels: Record<string, string> = {
  'learn-v1:scheduled-utc-0': '00:00–05:59 UTC',
  'learn-v1:scheduled-utc-1': '06:00–11:59 UTC',
  'learn-v1:scheduled-utc-2': '12:00–17:59 UTC',
  'learn-v1:scheduled-utc-3': '18:00–23:59 UTC',
};

export interface CalendarTimeSuggestion {
  platform: string;
  window: string;
  sampleSize: number;
  meanScore: number;
}

export function deriveCalendarTimeSuggestions(input?: { groups?: PerformancePattern[]; minimumSample?: number }): CalendarTimeSuggestion[] {
  if (!input || !Array.isArray(input.groups)) return [];
  const candidateMinimum = input.minimumSample;
  const minimum = typeof candidateMinimum === 'number'
    && Number.isSafeInteger(candidateMinimum)
    && candidateMinimum > 0
    ? candidateMinimum
    : 3;
  return input.groups
    .filter(group => timeLabels[group.context] && Number.isSafeInteger(group.sampleSize) && group.sampleSize >= minimum && Number.isFinite(group.meanScore))
    .sort((left, right) => right.meanScore - left.meanScore || right.sampleSize - left.sampleSize)
    .slice(0, 4)
    .map(group => ({ platform: group.platform, window: timeLabels[group.context], sampleSize: group.sampleSize, meanScore: group.meanScore }));
}

export default function CalendarOptimalTimes({ modelId, patterns }: { modelId: string; patterns?: { groups: PerformancePattern[]; minimumSample: number } }) {
  const suggestions = deriveCalendarTimeSuggestions(patterns);
  return <section className="card stack" aria-label="Observed calendar time suggestions">
    <h3>Observed time suggestions</h3>
    <p className="subtle">These are advisory windows from verified published exemplars. They do not schedule, publish, or imply causal lift.</p>
    {suggestions.length === 0
      ? <p>No verified time window is strong enough to suggest yet. Review the performance evidence as it accumulates.</p>
      : <div className="grid">{suggestions.map(suggestion => <article className="card stack" key={`${suggestion.platform}:${suggestion.window}`}>
        <strong>{suggestion.platform} · {suggestion.window}</strong>
        <span>{suggestion.sampleSize} verified exemplars · mean relative score {suggestion.meanScore.toFixed(2)}</span>
      </article>)}</div>}
    <Link href={`/models/${encodeURIComponent(modelId)}/analytics`}>Review the evidence behind these windows</Link>
  </section>;
}
