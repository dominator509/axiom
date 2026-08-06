import { api } from '@/lib/api';
import ApproveButtons from '@/components/ApproveButtons';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let bundles: Awaited<ReturnType<typeof api.bundles.list>>['data'] = [];
  let error: string | null = null;
  try {
    bundles = (await api.bundles.list(id, 'generated')).data;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Approvals (F-37 / F-68)</h2>
        <span style={{ color: 'var(--muted)' }}>{bundles.length} awaiting decision</span>
      </div>
      {error && <div className="card" style={{ color: 'var(--bad)' }}>{error}</div>}
      {bundles.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            No generated bundles awaiting approval. Run Generation to create one.
          </p>
        </div>
      )}
      <div className="stack">
        {bundles.map((b) => (
          <div key={b.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <span className="mono">{b.id.slice(0, 8)}</span>
                <span className="badge warn" style={{ marginLeft: 8 }}>{b.state}</span>
                {b.tosReport && (
                  <span className={`badge ${b.tosReport.verdict === 'pass' ? 'good' : b.tosReport.verdict === 'review' ? 'warn' : 'bad'}`} style={{ marginLeft: 8 }}>
                    ToS: {b.tosReport.verdict}
                  </span>
                )}
              </div>
              <span style={{ color: 'var(--muted)' }}>{new Date(b.createdAt).toLocaleString()}</span>
            </div>
            <div className="stack" style={{ marginTop: 10 }}>
              {Object.entries(b.captions ?? {}).map(([platform, caption]) => (
                <div key={platform}>
                  <strong>{platform}:</strong> {caption}
                </div>
              ))}
              <div className="mono" style={{ color: 'var(--muted)' }}>{(b.hashtags ?? []).join(' ')}</div>
            </div>
            <div style={{ marginTop: 12 }}>
              <ApproveButtons bundleId={b.id} tosBlocked={b.tosReport?.verdict === 'block'} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
