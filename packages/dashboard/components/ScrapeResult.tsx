'use client';

import type { ScrapeProfileView, ScrapeResultView } from '@axiom/core';
import { useLocale } from './LocaleProvider';

function count(value: number | null, locale: string, unavailable: string): string {
  return value === null ? unavailable : new Intl.NumberFormat(locale).format(value);
}

function Profile({ data, locale, t }: { data: ScrapeProfileView; locale: string; t: (key: string, values?: Record<string, string | number>) => string }) {
  return <section className="stack">
    <h3>{data.displayName || data.platform || t('scrape.socialProfile')}</h3>
    {data.profileUrl && <p style={{ overflowWrap: 'anywhere' }}>{data.profileUrl}</p>}
    {data.bio && <p>{data.bio}</p>}
    {data.error && <p role="alert">{t('scrape.profileDetailsUnavailable')}</p>}
    <dl className="stack">
      <div><dt>{t('scrape.followers')}</dt><dd>{count(data.followers, locale, t('scrape.unavailable'))}</dd></div>
      <div><dt>{t('scrape.following')}</dt><dd>{count(data.following, locale, t('scrape.unavailable'))}</dd></div>
      <div><dt>{t('scrape.posts')}</dt><dd>{count(data.posts, locale, t('scrape.unavailable'))}</dd></div>
    </dl>
    {data.items.length > 0 && <div><h4>{t('scrape.observedItems')}</h4><ul>{data.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
  </section>;
}

const stateKey: Record<ScrapeResultView['state'], string> = {
  completed: 'scrape.status.completed',
  partial: 'scrape.status.partial',
  failed: 'scrape.status.failed',
  empty: 'scrape.status.empty',
  unavailable: 'scrape.status.unavailable',
};

export default function ScrapeResult({ result }: { result: ScrapeResultView }) {
  const { locale, t } = useLocale();
  const observedProfiles = new Intl.NumberFormat(locale).format(result.observedProfiles);
  const failedProfiles = new Intl.NumberFormat(locale).format(result.failedProfiles);
  return <div className="stack">
    <p className="subtle">{t('scrape.observedPublicCounts')}</p>
    <p role="status"><strong>{t(stateKey[result.state])}</strong> · {t('scrape.observedProfiles', { count: observedProfiles })}</p>
    {result.failedProfiles > 0 && <p role="alert">{t('scrape.lookupUnavailable', { count: failedProfiles })}</p>}
    {result.profiles.length > 0 ? result.profiles.map((profile, index) => <Profile key={`${index}-${profile.platform ?? 'profile'}`} data={profile} locale={locale} t={t} />)
      : <p role="alert">{t('scrape.noProfileResults')}</p>}
    {result.missingCount !== null && <p className="subtle">{t('scrape.notObserved', { count: new Intl.NumberFormat(locale).format(result.missingCount) })}</p>}
  </div>;
}
