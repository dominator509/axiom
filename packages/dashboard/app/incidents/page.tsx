import { api, getSession } from '@/lib/api';
import ReplayButton from '@/components/ReplayButton';
import DiscardButton from '@/components/DiscardButton';
import ResolveCrashButton from '@/components/ResolveCrashButton';
import { CATALOGS, LocaleCatalog, formatDate, formatNumber, normalizeLocale } from '@axiom/core';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const query = await searchParams;
  const status = typeof query?.status === 'string' && ['open', 'resolved', 'ignored'].includes(query.status) ? query.status : 'open';
  const cursor = typeof query?.crashCursor === 'string' ? query.crashCursor : undefined;
  const jobCursor = typeof query?.jobCursor === 'string' ? query.jobCursor : undefined;
  const pageHref = (values: { status?: string; crashCursor?: string; jobCursor?: string }) => {
    const params = new URLSearchParams({ status, ...(cursor ? { crashCursor: cursor } : {}), ...(jobCursor ? { jobCursor } : {}) });
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value); else params.delete(key);
    }
    return `/incidents?${params}`;
  };
  let uiLocale = 'en';
  try { uiLocale = (await api.uiLocale.get()).data.locale; } catch { /* keep the safe fallback */ }
  const locale = normalizeLocale(uiLocale) ?? 'en';
  const copy = new LocaleCatalog(CATALOGS);
  const t = (key: string, values?: Record<string, string | number>) => copy.t(locale, key, values);
  const formatCount = (value: unknown) => {
    const numeric = Number(value);
    return formatNumber(Number.isFinite(numeric) ? numeric : 0, locale);
  };
  const statusLabels: Record<string, string> = {
    open: t('incidents.open'), resolved: t('incidents.resolved'), ignored: t('incidents.ignored'),
  };
  const formatUtc = (value: unknown) => {
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.valueOf()) ? String(value) : formatDate(parsed, locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  };
  let crashes: Awaited<ReturnType<typeof api.incidents.crashes>>['data'] = [];
  let crashCursor: string | null | undefined;
  let crashError = false;
  try {
    const result = await api.incidents.crashes(status, cursor); crashes = result.data; crashCursor = result.meta?.next_cursor;
  } catch { crashError = true; }
  let incidents: Array<Record<string, unknown>> = [];
  let nextJobCursor: string | null | undefined;
  let error: string | null = null;
  try {
    const result = await api.incidents.list(jobCursor);
    incidents = result.data; nextJobCursor = result.meta?.next_cursor;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="page-stack">
      <h1>{t('incidents.title')}</h1>
      <section className="stack" aria-label={t('incidents.crashReports')}>
        <h2>{t('incidents.crashReports')}</h2>
        <p>{t('incidents.crashReportsDescription')}</p>
        <nav className="action-row" aria-label={t('incidents.crashReportStatus')}>{['open', 'resolved', 'ignored'].map(value => <Link key={value} href={pageHref({ status: value, crashCursor: undefined })} aria-current={status === value ? 'page' : undefined}>{statusLabels[value]}</Link>)}</nav>
        {crashError ? <p role="alert">{t('incidents.crashReportsLoadFailed')}</p> : crashes.length === 0 ? <p>{t('incidents.noCrashReports', { status: statusLabels[status] })}</p> : crashes.map(report => <article key={report.id} className="card stack">
          <h3>{report.service}</h3><p>{report.severity} · {t('incidents.occurrences', { count: formatCount(report.count) })} · {report.status}</p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report.message}</p>
          <p className="subtle">{t('incidents.lastSeen', { value: formatUtc(report.lastSeen) })}</p>
          {canEdit && report.status === 'open' && <ResolveCrashButton reportId={report.id} />}
        </article>)}
        <nav className="action-row" aria-label={t('incidents.crashReportPages')}>
          {cursor && <Link href={pageHref({ crashCursor: undefined })}>{t('incidents.latestReports')}</Link>}
          {crashCursor && <Link href={pageHref({ crashCursor })}>{t('incidents.olderReports')}</Link>}
        </nav>
      </section>
      <h2>{t('incidents.jobRecovery')}</h2>
      {error && (
        <div className="card" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}
      {incidents.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            {t('incidents.noFailedJobs')}
          </p>
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>{t('incidents.kind')}</th>
              <th>{t('incidents.state')}</th>
              <th>{t('incidents.attempts')}</th>
              <th>{t('incidents.error')}</th>
              <th>{t('incidents.created')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((j) => (
              <tr key={String(j.id)}>
                <td>{String(j.kind)}</td>
                <td>
                  <span className="badge bad">{String(j.state)}</span>
                </td>
                <td>
                  {formatCount(j.attempts)}/{formatCount(j.maxAttempts)}
                </td>
                <td className="mono" style={{ color: 'var(--bad)' }}>
                  <details><summary>{t('incidents.errorDetails')}</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(j.lastError ?? t('incidents.noErrorDetail'))}</p></details>
                </td>
                <td>{formatUtc(j.createdAt)}</td>
                <td>
                  {String(j.lastError ?? '').startsWith('external-side-effect-unknown:')
                    ? <span>{t('incidents.reconcileBeforeReplay')}</span>
                    : canEdit && ['dead', 'failed'].includes(String(j.state))
                      ? <div className="action-row"><ReplayButton jobId={String(j.id)} /><DiscardButton jobId={String(j.id)} /></div>
                      : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="action-row" aria-label={t('incidents.recoveryJobPages')}>
        {jobCursor && <Link href={pageHref({ jobCursor: undefined })}>{t('incidents.latestFailedJobs')}</Link>}
        {nextJobCursor && <Link href={pageHref({ jobCursor: nextJobCursor })}>{t('incidents.olderFailedJobs')}</Link>}
      </nav>
    </div>
  );
}
