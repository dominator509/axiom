import Link from 'next/link';
import { formatDate, formatNumber, type MessageKey, type SupportedLocale } from '@axiom/core';
import type { PlaybookGuideline, PostTarget } from '@/lib/api';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function currentUtcWeek(now: Date) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  from.setUTCDate(from.getUTCDate() - (from.getUTCDay() + 6) % 7);
  return { from: from.toISOString(), to: new Date(from.getTime() + 7 * 86_400_000 - 1).toISOString() };
}

export function cadenceCounts(posts: PostTarget[], platform: string, from: string, to: string) {
  const seen = new Set<string>();
  let scheduled = 0, published = 0;
  for (const post of posts) {
    const time = Date.parse(post.scheduledFor ?? '');
    if (post.platform !== platform || !Number.isFinite(time) || time < Date.parse(from) || time > Date.parse(to) || seen.has(post.id)) continue;
    seen.add(post.id);
    if (post.state === 'published') published++;
    else if (post.state === 'pending' && !post.remoteId) scheduled++;
  }
  return { scheduled, published };
}

export default function PlaybookCadence({ modelId, guidelines, posts, from, to, unavailable, locale, t }: {
  modelId: string; guidelines: PlaybookGuideline[]; posts: PostTarget[]; from: string; to: string; unavailable: boolean;
  locale: SupportedLocale; t: Translate;
}) {
  const weekFrom = formatDate(new Date(from), locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const weekTo = formatDate(new Date(to), locale, { dateStyle: 'medium', timeZone: 'UTC' });
  return <section className="card stack" aria-label={t('playbook.cadenceSectionAria')}>
    <h3>{t('playbook.cadenceSectionAria')}</h3>
    <p>{t('playbook.cadenceWeek', { from: weekFrom, to: weekTo })}</p>
    <p className="subtle">{t('playbook.cadenceAdvisory')}</p>
    {unavailable || !Array.isArray(guidelines) || !Array.isArray(posts) || guidelines.some(item => !item || !Number.isSafeInteger(item.cadencePerWeek) || item.cadencePerWeek < 0 || !Array.isArray(item.optimalTimes)) ? <p role="alert">{t('playbook.cadenceUnavailable')}</p>
      : guidelines.length === 0 ? <p>{t('playbook.cadenceEmpty')}</p>
      : guidelines.map(guideline => {
        const { scheduled, published } = cadenceCounts(posts, guideline.platform, from, to);
        const deficit = Math.max(0, guideline.cadencePerWeek - scheduled - published);
        return <div className="stack" key={guideline.id}>
          <strong>{guideline.platform} · {t('playbook.cadenceRevision', { revision: formatNumber(guideline.revision, locale) })}</strong>
          <p>{t('playbook.cadenceCounts', { published: formatNumber(published, locale), scheduled: formatNumber(scheduled, locale), target: formatNumber(guideline.cadencePerWeek, locale) })}</p>
          <p className={deficit ? 'badge warn' : 'subtle'}>{guideline.cadencePerWeek === 0 ? t('playbook.cadenceNoMinimum') : deficit === 1 ? t('playbook.cadenceDeficitOne', { deficit: formatNumber(deficit, locale) }) : deficit ? t('playbook.cadenceDeficitMany', { deficit: formatNumber(deficit, locale) }) : t('playbook.cadenceCovered')}</p>
          {guideline.optimalTimes.length > 0 && <p>{t('playbook.cadenceSavedTimes', { times: guideline.optimalTimes.join(', ') })}</p>}
        </div>;
      })}
    <Link href={`/models/${encodeURIComponent(modelId)}/playbook`}>{t('playbook.reviewGuidelines')}</Link>
  </section>;
}
