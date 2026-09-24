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
    <div className="page-stack" style={{ maxWidth: 640 }}>
      <section className="page-hero">
        <div>
          <p className="eyebrow">Safety</p>
          <h1>Publishing safety</h1>
          <p className="page-intro">
            Halt or resume outbound publishing and DM jobs for the whole studio in one control.
          </p>
        </div>
      </section>

      {error && (
        <div className="notice error" role="alert">
          <strong>Could not load safety status</strong>
          <span className="mono">{error}</span>
        </div>
      )}

      {state && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Publishing</h2>
            {state.enabled ? (
              <span className="badge bad">
                <i /> Halted
              </span>
            ) : (
              <span className="badge good">
                <i /> Enabled
              </span>
            )}
          </div>
          {state.enabled && (
            <div className="notice error" role="status">
              <strong>Publishing is halted</strong>
              <span>
                Reason: {state.reason || 'no reason recorded'}
                {state.startedAt ? ` · since ${new Date(state.startedAt).toLocaleString()}` : ''}
              </span>
            </div>
          )}
          <p className="subtle" style={{ margin: 0 }}>
            Flipping the switch persists to <span className="mono">org_settings</span>, is
            audit-logged, and stops the scheduler from dequeuing publish/DM jobs within seconds.
          </p>
          <KillSwitchControl enabled={state.enabled} />
        </div>
      )}
    </div>
  );
}
