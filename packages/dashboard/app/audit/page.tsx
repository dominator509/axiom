import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  let entries: Array<Record<string, unknown>> = [];
  let verification: { rows: number; valid: boolean; brokenAt?: string } | null = null;
  let error: string | null = null;
  try {
    [entries, verification] = await Promise.all([
      api.audit.list().then((r) => r.data),
      api.audit.verify().then((r) => r.data),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Trust</p>
          <h1>Trust &amp; activity</h1>
          <p className="page-intro">
            A hash-chained record of sensitive actions across your private studio.
          </p>
        </div>
        {verification && (
          <span className={`badge ${verification.valid ? 'good' : 'bad'}`}>
            <i />
            {verification.valid ? 'Chain valid' : `Broken at ${verification.brokenAt}`} ·{' '}
            {verification.rows} entries
          </span>
        )}
      </section>

      {error && (
        <div className="notice error" role="alert">
          <strong>Could not load the audit trail</strong>
          <span className="mono">{error}</span>
        </div>
      )}

      {entries.length === 0 && !error && (
        <div className="empty-state card">
          <span className="empty-mark">∴</span>
          <h2>No activity yet</h2>
          <p>Sensitive actions will appear here once your studio starts recording them.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={String(e.id)}>
                  <td>{new Date(String(e.ts)).toLocaleString()}</td>
                  <td className="mono">{String(e.actorRef).slice(0, 12)}</td>
                  <td>
                    <span className="badge mute">{String(e.action)}</span>
                  </td>
                  <td className="mono">{String(e.target).slice(0, 16)}</td>
                  <td className="mono subtle">{JSON.stringify(e.detail).slice(0, 80)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
