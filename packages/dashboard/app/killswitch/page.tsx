import { api } from '@/lib/api';
import KillSwitchControl from '@/components/KillSwitchControl';

export const dynamic = 'force-dynamic';

export default async function KillSwitchPage() {
  let state: Awaited<ReturnType<typeof api.killswitch.get>>['data'] | null = null;
  let error: string | null = null;
  try {
    state = (await api.killswitch.get()).data;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Publishing safety</h1>
      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}
      {state && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Publishing</h2>
            {state.enabled ? (
              <span className="badge bad">HALTED</span>
            ) : (
              <span className="badge good">enabled</span>
            )}
          </div>
          {state.enabled && (
            <p style={{ color: 'var(--bad)' }}>
              Reason: {state.reason || 'no reason recorded'} — started{' '}
              {state.startedAt ? new Date(state.startedAt).toLocaleString() : '?'}
            </p>
          )}
          <p style={{ color: 'var(--muted)' }}>
            Flipping the switch persists to <span className="mono">org_settings</span>, is
            audit-logged, and halts the scheduler from dequeuing publish/DM jobs within seconds.
          </p>
          <KillSwitchControl enabled={state.enabled} />
        </div>
      )}
    </div>
  );
}
