export interface PerformancePattern {
  platform: string; arm: string; context: string; mediaFormat?: string; tosVerdict?: string;
  publishedHourUtc?: number | null; sampleSize: number; meanScore: number;
}
const times: Record<string, string> = {
  'learn-v1:scheduled-utc-0': '00:00–05:59 UTC', 'learn-v1:scheduled-utc-1': '06:00–11:59 UTC',
  'learn-v1:scheduled-utc-2': '12:00–17:59 UTC', 'learn-v1:scheduled-utc-3': '18:00–23:59 UTC',
  'learn-v1:scheduled-utc-unknown': 'Scheduled time unknown',
};
const hourBucket = (hour: number | null | undefined) => {
  if (hour === null || hour === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) return 'Publication time unavailable';
  const start = Math.floor(hour / 6) * 6;
  return `${String(start).padStart(2, '0')}:00–${String(start + 5).padStart(2, '0')}:59 UTC`;
};
export default function PerformancePatterns({ patterns }: { patterns?: { groups: PerformancePattern[]; truncated: boolean; minimumSample: number } }) {
  return <section className="card stack" aria-label="Observed performance patterns">
    <h3>What’s working: observed patterns</h3>
    <p className="subtle">Grouped verified exemplars for this talent only. Caption length and question marks describe the recorded caption; time is its scheduled UTC bucket, not necessarily actual publication time.</p>
    {!patterns ? <p>Pattern analysis unavailable.</p> : patterns.groups.length === 0 ? <p>Not enough verified examples yet. Each pattern needs at least {patterns.minimumSample} labeled exemplars.</p> : <div className="grid">{patterns.groups.map(group => {
      const [length, kind] = group.arm.split(':');
      return <article className="card stack" key={`${group.platform}:${group.arm}:${group.context}:${group.mediaFormat ?? 'unknown'}:${group.tosVerdict ?? 'unavailable'}:${group.publishedHourUtc ?? 'unknown'}`}>
        <h4>{group.platform} · {length} caption · {kind === 'question' ? 'contains a question mark' : 'no question mark'}</h4>
        <p>{times[group.context] ?? 'Unknown scheduled time'}</p>
        <p>Recorded media: {group.mediaFormat && group.mediaFormat !== 'unknown' ? group.mediaFormat : 'unknown format'} · published: {hourBucket(group.publishedHourUtc)}</p>
        <p>ToS verdict at publication: {group.tosVerdict && group.tosVerdict !== 'unavailable' ? group.tosVerdict : 'unavailable'}</p>
        <p>{group.sampleSize} labeled exemplars · Mean relative engagement score: {group.meanScore.toFixed(2)}</p>
      </article>;
    })}</div>}
    {patterns?.truncated && <p>Showing the 20 highest-scoring groups.</p>}
    <p className="subtle">Exploratory observations, not recommendations or statistical significance. Scores are engagement z-scores calculated when each exemplar was labeled; zero represents its then-current comparison average. These are retained labeled examples, not all posts, and scores may use different historical comparison windows. No conversion lift or causal effect is inferred.</p>
  </section>;
}
