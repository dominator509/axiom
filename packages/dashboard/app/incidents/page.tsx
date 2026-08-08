import { api } from '@/lib/api';
import ReplayButton from '@/components/ReplayButton';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage() {
  let incidents: Array<Record<string, unknown>> = [];
  let error: string | null = null;
  try {
    incidents = (await api.incidents.list()).data;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <h1>Incidents &amp; recovery</h1>
      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}
      {incidents.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            No dead or failed jobs. All queues healthy.
          </p>
        </div>
      )}
      <div className="card">
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
                  {String(j.lastError ?? '').slice(0, 60)}
                </td>
                <td>{new Date(String(j.createdAt)).toLocaleString()}</td>
                <td>
                  <ReplayButton jobId={String(j.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
