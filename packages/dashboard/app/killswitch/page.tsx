import { api, getSession } from '@/lib/api';
import Link from 'next/link';
import KillSwitchControl from '@/components/KillSwitchControl';

export const dynamic = 'force-dynamic';

export default async function KillSwitchPage() {
  const session = await getSession();
  if (session?.user?.role !== 'owner') return (
    <div className="page-stack">
      <h1>Publishing safety</h1>
      <div className="card stack">
        <p>Only a workspace owner can view or change the emergency publishing switch.</p>
        <p>Contact your workspace owner if publishing needs to be stopped.</p>
        <Link href="/" className="btn secondary">Back to workspace</Link>
      </div>
    </div>
  );
  let state: Awaited<ReturnType<typeof api.killswitch.get>>['data'] | null = null;
  let error: string | null = null;
  try {
    const response = await api.killswitch.get();
    if (typeof response?.data?.enabled !== 'boolean') throw new Error('Invalid safety status');
    state = response.data;
  } catch {
    error = 'Safety status could not be loaded. The current publishing state is unknown. Reload to try again or contact your administrator.';
  }

  return (
    <div className="page-stack" style={{ maxWidth: 720 }}>
      <h1>Publishing safety</h1>
      {error && (
        <div className="card stack" role="alert">
          <p>{error}</p>
          <a href="/killswitch" className="btn secondary">Reload safety status</a>
        </div>
      )}
      {state && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Publishing</h2>
            {state.enabled ? (
              <span className="badge bad">HALTED</span>
            ) : (
              <span className="badge good">Not halted</span>
            )}
          </div>
          {state.enabled && (
            <p style={{ color: 'var(--bad)' }}>
              Reason: {state.reason || 'no reason recorded'} — started{' '}
              {state.startedAt ? new Date(state.startedAt).toLocaleString() : '?'}
            </p>
          )}
          <p style={{ color: 'var(--muted)' }}>
            Use the emergency switch to stop new publishing work in this workspace.
            Changes are recorded in the audit trail. Work already sent to a provider may still finish.
          </p>
          <KillSwitchControl enabled={state.enabled} />
        </div>
      )}
    </div>
  );
}
