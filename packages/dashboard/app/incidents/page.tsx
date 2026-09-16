import { api, getSession } from '@/lib/api';
import ReplayButton from '@/components/ReplayButton';
import ResolveCrashButton from '@/components/ResolveCrashButton';
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
      <h1>Incidents &amp; recovery</h1>
      <section className="stack" aria-label="Application crash reports">
        <h2>Application crash reports</h2>
        <p>Review recorded application errors. Marking a report resolved records your triage decision; it does not repair the cause or replay a job.</p>
        <nav className="action-row" aria-label="Crash report status">{['open', 'resolved', 'ignored'].map(value => <Link key={value} href={pageHref({ status: value, crashCursor: undefined })} aria-current={status === value ? 'page' : undefined}>{value}</Link>)}</nav>
        {crashError ? <p role="alert">Crash reports could not be loaded.</p> : crashes.length === 0 ? <p>No {status} crash reports in this page.</p> : crashes.map(report => <article key={report.id} className="card stack">
          <h3>{report.service}</h3><p>{report.severity} · {report.count} occurrences · {report.status}</p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report.message}</p>
          <p className="subtle">Last seen: {report.lastSeen}</p>
          {canEdit && report.status === 'open' && <ResolveCrashButton reportId={report.id} />}
        </article>)}
        <nav className="action-row" aria-label="Crash report pages">
          {cursor && <Link href={pageHref({ crashCursor: undefined })}>Latest reports</Link>}
          {crashCursor && <Link href={pageHref({ crashCursor })}>Older reports</Link>}
        </nav>
      </section>
      <h2>Job recovery</h2>
      {error && (
        <div className="card" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}
      {incidents.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            No failed jobs returned in this page. This does not establish overall queue health.
          </p>
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>State</th>
              <th>Attempts</th>
              <th>Error</th>
              <th>Created</th>
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
                  {String(j.attempts)}/{String(j.maxAttempts)}
                </td>
                <td className="mono" style={{ color: 'var(--bad)' }}>
                  <details><summary>Error details</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(j.lastError ?? 'No error detail recorded.')}</p></details>
                </td>
                <td>{new Date(String(j.createdAt)).toLocaleString()}</td>
                <td>
                  {String(j.lastError ?? '').startsWith('external-side-effect-unknown:') ? <span>Reconcile provider outcome before replay.</span> : canEdit && ['dead', 'failed'].includes(String(j.state)) ? <ReplayButton jobId={String(j.id)} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="action-row" aria-label="Recovery job pages">
        {jobCursor && <Link href={pageHref({ jobCursor: undefined })}>Latest failed jobs</Link>}
        {nextJobCursor && <Link href={pageHref({ jobCursor: nextJobCursor })}>Older failed jobs</Link>}
      </nav>
    </div>
  );
}
