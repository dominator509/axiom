'use client';
import Link from 'next/link';
import type { api } from '@/lib/api';
import { formatDate, formatNumber } from '@axiom/core';
import { useLocale } from './LocaleProvider';

type Schedule = Awaited<ReturnType<typeof api.digests.list>>['schedule'];
export default function DigestScheduleStatus({ schedule, canConfigure }: { schedule: Schedule; canConfigure: boolean }) {
  const { t, locale } = useLocale();
  const job = schedule?.latest;
  const runAfter = job ? new Date(job.runAfter) : null;
  const formattedRunAfter = runAfter && !Number.isNaN(runAfter.valueOf())
    ? formatDate(runAfter, locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
    : '—';
  const state = !schedule ? t('digest.schedule.unavailable') : !schedule.enabled ? t('digest.schedule.off')
    : !job ? t('digest.schedule.noJob')
    : job.state === 'ready' ? t('digest.schedule.queued')
    : job.state === 'running' ? t('digest.schedule.running')
    : job.state === 'dead' ? t('digest.schedule.dead')
    : job.state === 'done' ? t('digest.schedule.done')
    : t('digest.schedule.review');
  return <section className="card stack" aria-label={t('digest.schedule.aria')}>
    <h2>{t('digest.schedule.heading')}</h2><p>{state}</p>
    {schedule?.enabled && !schedule.workspacePermitted && <p role="alert">{t('digest.schedule.safetyOff')}</p>}
    {schedule?.enabled && job && <p className="subtle">{t('digest.schedule.eligible', { runAfter: formattedRunAfter, attempts: formatNumber(job.attempts, locale) })}</p>}
    <p className="subtle">{t('digest.schedule.storageNote')}</p>
    {canConfigure && <Link href="/settings">{t('digest.schedule.manage')}</Link>}
  </section>;
}
