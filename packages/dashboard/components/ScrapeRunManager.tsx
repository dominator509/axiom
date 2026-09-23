'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ScrapeCompetitorBenchmark, ScrapeRun } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import ScrapeResult from './ScrapeResult';
import ResearchRefresh from './ResearchRefresh';
import { useLocale } from './LocaleProvider';

function badgeClass(state: string): string {
  if (state === 'completed') return 'good';
  if (state === 'failed' || state === 'unavailable') return 'bad';
  return 'warn';
}

export default function ScrapeRunManager({ modelId, runs, benchmark = [], cursor, nextCursor, canEdit }: {
  modelId: string;
  runs: ScrapeRun[];
  benchmark?: ScrapeCompetitorBenchmark[];
  cursor?: string;
  nextCursor?: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const [kind, setKind] = useState<'social' | 'competitor'>('social');
  const [platform, setPlatform] = useState('instagram');
  const [profileUrl, setProfileUrl] = useState('');
  const [brandName, setBrandName] = useState('');
  const [industry, setIndustry] = useState('');
  const [platforms, setPlatforms] = useState('instagram, tiktok');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef<{ key: string; body: string } | null>(null);

  async function submit() {
    if (busy) return;
    const body = kind === 'social'
      ? { kind, platform, profileUrl: profileUrl.trim() }
      : { kind, brandName: brandName.trim(), industry: industry.trim(), platforms: platforms.split(',').map(value => value.trim()).filter(Boolean) };
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify(body) };
    setBusy(true); setError('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/scrape-runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) { setError(t('scrape.queueFailed')); if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null; return; }
      const result = await readDashboardJson<{ data?: unknown }>(response); if (!result.data) throw new Error('unconfirmed scrape response');
      intent.current = null; router.refresh();
    } catch { setError(t('scrape.queueUnconfirmed')); }
    finally { setBusy(false); }
  }

  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const kindLabel: Record<string, string> = { social: t('scrape.socialResearch'), competitor: t('scrape.competitorResearch') };
  const stateLabel: Record<string, string> = {
    completed: t('scrape.status.completed'),
    partial: t('scrape.status.partial'),
    failed: t('scrape.status.failed'),
    empty: t('scrape.status.empty'),
    unavailable: t('scrape.status.unavailable'),
  };

  return <div className="stack">
    <p className="subtle">{t('scrape.description')}</p>
    {error && <p role="alert">{error}</p>}
    <ResearchRefresh active={runs.some(run => run.state === 'queued' || run.state === 'running')} />
    {canEdit && <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{t('scrape.start')}</legend><label>{t('scrape.runType')}<select value={kind} onChange={event => setKind(event.target.value as 'social' | 'competitor')}><option value="social">{t('scrape.socialProfile')}</option><option value="competitor">{t('scrape.competitorBenchmark')}</option></select></label>{kind === 'social' ? <div className="row"><label>{t('scrape.platform')}<select value={platform} onChange={event => setPlatform(event.target.value)}><option>instagram</option><option>tiktok</option><option>threads</option><option>x</option><option>youtube</option><option>reddit</option></select></label><label style={{ flex: 1 }}>{t('scrape.profileUrl')}<input value={profileUrl} onChange={event => setProfileUrl(event.target.value)} placeholder="https://..." /></label></div> : <div className="row"><label>{t('scrape.brand')}<input value={brandName} onChange={event => setBrandName(event.target.value)} /></label><label>{t('scrape.industry')}<input value={industry} onChange={event => setIndustry(event.target.value)} /></label><label>{t('scrape.platforms')}<input value={platforms} onChange={event => setPlatforms(event.target.value)} /></label></div>}<button className="btn" type="button" onClick={() => void submit()}>{t('scrape.queue')}</button></fieldset>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void submit()}>{t('scrape.retry')}</button>}
    {benchmark.length > 0 && <section className="card stack" aria-label={t('scrape.competitorBenchmark')}>
      <h3>{t('scrape.competitorBenchmark')}</h3>
      <p className="subtle">{t('scrape.observedPublicCounts')}</p>
      <div style={{ overflowX: 'auto' }}><table>
        <thead><tr><th scope="col">{t('scrape.platform')}</th><th scope="col">{t('scrape.profileUrl')}</th><th scope="col">{t('scrape.followers')}</th><th scope="col">{t('scrape.followers')}/day</th><th scope="col">{t('scrape.posts')}</th><th scope="col">{t('scrape.posts')}/day</th><th scope="col">{t('scrape.historyColumn')}</th></tr></thead>
        <tbody>{benchmark.map(profile => <tr key={`${profile.platform}:${profile.profileUrl}`}>
          <td>{profile.platform ?? t('scrape.unavailable')}</td>
          <td><a href={profile.profileUrl} target="_blank" rel="noreferrer">{profile.displayName ?? profile.profileUrl}</a></td>
          <td>{profile.followers === null ? t('scrape.unavailable') : number.format(profile.followers)}</td>
          <td>{profile.followerChangePerDay === null ? t('scrape.unavailable') : number.format(profile.followerChangePerDay)}</td>
          <td>{profile.posts === null ? t('scrape.unavailable') : number.format(profile.posts)}</td>
          <td>{profile.postsPerDay === null ? t('scrape.unavailable') : number.format(profile.postsPerDay)}</td>
          <td>{profile.history.length === 0 ? t('scrape.unavailable') : <details>
            <summary>{t('scrape.benchmarkHistory', { count: number.format(profile.history.length) })}</summary>
            <table aria-label={`${profile.displayName ?? profile.profileUrl} ${t('scrape.benchmarkHistory', { count: number.format(profile.history.length) })}`}>
              <thead><tr><th scope="col">{t('scrape.observedAt')}</th><th scope="col">{t('scrape.followers')}</th><th scope="col">{t('scrape.posts')}</th></tr></thead>
              <tbody>{profile.history.map((observation, index) => <tr key={`${observation.observedAt}:${index}`}>
                <td>{dateTime.format(new Date(observation.observedAt))}</td>
                <td>{observation.followers === null ? t('scrape.unavailable') : number.format(observation.followers)}</td>
                <td>{observation.posts === null ? t('scrape.unavailable') : number.format(observation.posts)}</td>
              </tr>)}</tbody>
            </table>
          </details>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
    {runs.length === 0 ? <p>{cursor ? t('scrape.noMoreRuns') : t('scrape.noRuns')}</p> : <div className="stack">{runs.map(run => {
      const displayState = run.result?.state ?? run.state;
      return <article className="card stack" key={run.id}><div className="row" style={{ justifyContent: 'space-between' }}><strong>{kindLabel[run.kind] ?? run.kind}</strong><span className={`badge ${badgeClass(displayState)}`}>{stateLabel[displayState] ?? displayState}</span></div>{run.error && <p role="alert">{t('scrape.researchUnavailable')}</p>}{run.completedAt && <p className="subtle">{t('scrape.finished', { value: dateTime.format(new Date(run.completedAt)) })}</p>}{run.result && <ScrapeResult result={run.result} />}</article>;
    })}</div>}
    <nav className="action-row" aria-label={t('scrape.pages')}>
      {cursor && <Link className="btn secondary" href={`/models/${encodeURIComponent(modelId)}/scraping`}>{t('scrape.latest')}</Link>}
      {nextCursor && <Link className="btn secondary" href={`/models/${encodeURIComponent(modelId)}/scraping?${new URLSearchParams({ cursor: nextCursor })}`}>{t('scrape.older')}</Link>}
    </nav>
  </div>;
}
