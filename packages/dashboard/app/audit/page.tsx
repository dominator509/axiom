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
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Audit log (LBI-08)</h1>
        {verification && (
          <span className={`badge ${verification.valid ? 'good' : 'bad'}`}>
            chain: {verification.valid ? 'valid' : `BROKEN at ${verification.brokenAt}`} · {verification.rows} entries
          </span>
        )}
      </div>
      {error && <div className="card" style={{ color: 'var(--bad)' }}>{error}</div>}
      {entries.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>No audit entries yet.</p>
        </div>
      )}
      <div className="card">
        <table>
          <thead>
            <tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={String(e.id)}>
                <td>{new Date(String(e.ts)).toLocaleString()}</td>
                <td className="mono">{String(e.actorRef).slice(0, 12)}</td>
                <td><span className="badge mute">{String(e.action)}</span></td>
                <td className="mono">{String(e.target).slice(0, 16)}</td>
                <td className="mono" style={{ color: 'var(--muted)' }}>{JSON.stringify(e.detail).slice(0, 80)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
