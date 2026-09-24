import { api, getSession } from '@/lib/api';
import Link from 'next/link';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import ApproveButtons from '@/components/ApproveButtons';
import RequestedSchedule from '@/components/RequestedSchedule';
import BundleMedia from '@/components/BundleMedia';
import VideoReview from '@/components/VideoReview';
import SavedGenerationRetry from '@/components/SavedGenerationRetry';
import AdaptationControls from '@/components/AdaptationControls';
import DraftEditor from '@/components/DraftEditor';
import CaptionGuidance from '@/components/CaptionGuidance';
import { getServerLocale } from '@/lib/server-locale';
import { formatNumber } from '@axiom/core';

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
  const { t, dateTime, locale } = await getServerLocale();
  const session = await getSession();
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'approvals')) return (
    <div className="card"><h2>{t('review.accessUnavailable')}</h2><p>{t('review.accessDescription')}</p><Link href="/">{t('review.back')}</Link></div>
  );
  const canApprove = ['owner', 'manager', 'operator'].includes(role ?? '');
  const tosVerdictLabels: Record<string, string> = {
    pass: t('review.tos.pass'),
    review: t('review.tos.review'),
    block: t('review.tos.block'),
    pending: t('review.tos.pending'),
  };
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
      canApprove ? api.social.list(id) : Promise.resolve({ data: [] }),
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
        <h2>{canApprove ? t('review.approvals') : t('review.drafts')}</h2>
        <span style={{ color: 'var(--muted)' }}>{t('review.shown', { count: formatNumber(bundles.length, locale) })}</span>
      </div>
      {!canApprove && <p>{t('review.draftDescription')}</p>}
      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          {t('review.loadFailed')}
        </div>
      )}
      {bundles.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            {cursors.size ? t('review.noBundlesPaged') : t('review.noBundles')}
          </p>
        </div>
      )}
      <nav className="row" aria-label={t('review.queuePages')}>
        {cursors.size > 0 && <a href={firstPage}>{t('review.newest')}</a>}
        {!error &&
          olderPages.map(({ state, href }) => (
            <a key={state} href={href}>
              {t('review.olderBundles', { state: state === 'generated' ? t('review.generated') : state === 'revising' ? t('review.revising') : t('review.hold') })}
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
                  {b.state === 'generated' ? b.assetId ? t('review.mediaSaved') : t('review.briefSaved') : b.state === 'revising' ? t('review.revising') : t('review.hold')}
                </span>
                {b.tosReport && (
                  <span
                    className={`badge ${b.tosReport.verdict === 'pass' ? 'good' : b.tosReport.verdict === 'review' ? 'warn' : 'bad'}`}
                    style={{ marginLeft: 8 }}
                  >
                    {t('review.tos', { value: tosVerdictLabels[b.tosReport.verdict] ?? t('review.tos.unknown') })}{b.tosReport.decisionSource === 'human-review' ? ` (${t('review.operatorReviewed')})` : ''}
                  </span>
                )}
              </div>
              <span style={{ color: 'var(--muted)' }}>
                {dateTime(b.createdAt)}
              </span>
            </div>
            <div className="stack" style={{ marginTop: 10 }}>
              <RequestedSchedule intent={b.publishIntent} />
              {b.assetId && <BundleMedia key={b.assetId} bundleId={b.id} />}
              {!b.assetId && <p>{t('review.noMedia')}</p>}
              {Object.entries(b.captions ?? {}).map(([platform, caption]) => (
                <div key={platform}>
                  <strong>{platform}:</strong> {caption}
                </div>
              ))}
              <div className="mono" style={{ color: 'var(--muted)' }}>
                {(b.hashtags ?? []).join(' ')}
              </div>
              <CaptionGuidance captions={b.captions ?? {}} receipts={b.captionGuidance} />
              {canApprove && <AdaptationControls bundleId={b.id} revisionId={b.tosReport?.revisionId} platforms={Object.keys(b.captions ?? {})} />}
              {(canApprove || role === 'content_creator') && b.assetId && ['generated', 'hold'].includes(b.state) && (
                <DraftEditor key={`${b.id}:${b.tosReport?.revisionId ?? 'initial'}`} bundleId={b.id}
                  revisionId={b.tosReport?.revisionId} captions={b.captions ?? {}} hashtags={b.hashtags ?? []} publishIntent={b.publishIntent} />
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              {canApprove && b.state !== 'revising' && (b.state === 'hold' || (b.assetId && ['block', 'review'].includes(b.tosReport?.verdict ?? '')))
                && <SavedGenerationRetry key={b.id} modelId={id} bundleId={b.id} blocked={b.tosReport?.verdict === 'block'} />}
              {canApprove && b.state !== 'revising' && b.assetId && b.tosReport?.verdict === 'review' && b.tosReport.videoScan?.scanId && (
                <VideoReview key={b.tosReport.videoScan.scanId} bundleId={b.id}
                  scanId={b.tosReport.videoScan.scanId} platforms={Object.keys(b.captions ?? {})} />
              )}
              {b.state === 'revising' ? (
                <p role="status">
                  {t('review.captionRevisionPending')} {t('review.captionRevisionHelp')}
                </p>
              ) : canApprove ? (
                <ApproveButtons
                  key={`${b.id}:${b.tosReport?.revisionId ?? 'initial'}`}
                  bundleId={b.id}
                  platforms={Object.keys(b.captions ?? {})}
                  tosBlocked={b.tosReport?.verdict !== 'pass'}
                  revisionId={b.tosReport?.revisionId}
                  connections={connections}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
