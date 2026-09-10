import { api } from '@/lib/api';
import ApproveButtons from '@/components/ApproveButtons';

export const dynamic = 'force-dynamic';

const reviewStates = ['generated', 'revising', 'hold'] as const;

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const cursors = new URLSearchParams();
  for (const state of reviewStates) {
    const value = query[`${state}Cursor`];
    if (typeof value === 'string' && value) cursors.set(`${state}Cursor`, value);
  }
  const firstPage = `/models/${encodeURIComponent(id)}/approvals`;
  const olderPages: { state: string; href: string }[] = [];
  let bundles: Awaited<ReturnType<typeof api.bundles.list>>['data'] = [];
  let connections: Awaited<ReturnType<typeof api.social.list>>['data'] = [];
  let error: string | null = null;
  try {
    const [bundleResult, connectionResult, revisingResult, heldResult] = await Promise.all([
      api.bundles.list(id, 'generated', cursors.get('generatedCursor') ?? undefined),
      api.social.list(id),
      api.bundles.list(id, 'revising', cursors.get('revisingCursor') ?? undefined),
      api.bundles.list(id, 'hold', cursors.get('holdCursor') ?? undefined),
    ]);
    bundles = [...bundleResult.data, ...revisingResult.data, ...heldResult.data];
    connections = connectionResult.data;
    for (const [index, result] of [bundleResult, revisingResult, heldResult].entries()) {
      const next = result.meta?.next_cursor;
      if (!next) continue;
      const state = reviewStates[index];
      const nextQuery = new URLSearchParams(cursors);
      nextQuery.set(`${state}Cursor`, next);
      olderPages.push({ state, href: `${firstPage}?${nextQuery}` });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Approvals</h2>
        <span style={{ color: 'var(--muted)' }}>{bundles.length} shown for review</span>
      </div>
      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}
      {bundles.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            {cursors.size
              ? 'No bundles on these review pages. Return to newest work.'
              : 'No bundles awaiting review. Run Generation to create one.'}
          </p>
        </div>
      )}
      <nav className="row" aria-label="Review queue pages">
        {cursors.size > 0 && <a href={firstPage}>Newest review work</a>}
        {!error &&
          olderPages.map(({ state, href }) => (
            <a key={state} href={href}>
              Older {state} bundles
            </a>
          ))}
      </nav>
      <div className="stack">
        {bundles.map((b) => (
          <div key={b.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <span className="mono">{b.id.slice(0, 8)}</span>
                <span className="badge warn" style={{ marginLeft: 8 }}>
                  {b.state}
                </span>
                {b.tosReport && (
                  <span
                    className={`badge ${b.tosReport.verdict === 'pass' ? 'good' : b.tosReport.verdict === 'review' ? 'warn' : 'bad'}`}
                    style={{ marginLeft: 8 }}
                  >
                    ToS: {b.tosReport.verdict}
                  </span>
                )}
              </div>
              <span style={{ color: 'var(--muted)' }}>
                {new Date(b.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="stack" style={{ marginTop: 10 }}>
              {Object.entries(b.captions ?? {}).map(([platform, caption]) => (
                <div key={platform}>
                  <strong>{platform}:</strong> {caption}
                </div>
              ))}
              <div className="mono" style={{ color: 'var(--muted)' }}>
                {(b.hashtags ?? []).join(' ')}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              {b.state === 'revising' ? (
                <p role="status">
                  Caption revision pending. Refresh after generation and ToS scanning complete. If
                  processing fails, inspect the generation job in Incidents.
                </p>
              ) : (
                <ApproveButtons
                  bundleId={b.id}
                  tosBlocked={b.tosReport?.verdict !== 'pass'}
                  revisionId={b.tosReport?.revisionId}
                  connections={connections}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
