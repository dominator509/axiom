'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VariantExperiment, VariantCandidate } from '@/lib/api';
import BundleMedia from './BundleMedia';
import VariantExperimentTracking from './VariantExperimentTracking';
import VariantReviewCreate from './VariantReviewCreate';
import VariantPublishedPerformance from './VariantPublishedPerformance';
import VariantGuidanceAttribution from './VariantGuidanceAttribution';
import VariantEvaluationReport from './VariantEvaluationReport';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import VariantGuidanceSummary from './VariantGuidanceSummary';
import { useLocale } from './LocaleProvider';

type Intent = { path: string; method: 'POST' | 'PATCH'; body?: string; key: string };

export default function VariantExperimentManager({
  modelId,
  experiments,
  canEdit,
  candidates = [],
  nextCursor = null,
}: {
  modelId: string;
  experiments: VariantExperiment[];
  canEdit: boolean;
  candidates?: VariantCandidate[];
  nextCursor?: string | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [name, setName] = useState(() => t('variant.manager.defaultName'));
  const [platform, setPlatform] = useState('instagram');
  const [variantIds, setVariantIds] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const intent = useRef<Intent | null>(null);
  const onConfirmed = useRef<(() => void) | undefined>(undefined);
  const active = useRef(false);
  const [available, setAvailable] = useState(candidates);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  async function loadMore() {
    if (!cursor || loadingRef.current) return;
    loadingRef.current = true; setLoading(true);
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/candidates?${new URLSearchParams({ cursor })}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(t('variant.manager.candidatesUnavailable'));
      const result = await readDashboardJson<{ data: VariantCandidate[]; meta: { next_cursor: string | null } }>(response);
      if (!Array.isArray(result.data) || !result.meta) throw new Error(t('variant.manager.invalidCandidates'));
      setAvailable(previous => [...new Map([...previous, ...result.data].map(item => [item.id, item])).values()]);
      setCursor(result.meta.next_cursor);
    } catch { setError(t('variant.manager.moreUnavailable')); }
    finally { loadingRef.current = false; setLoading(false); }
  }

  async function run(next?: Omit<Intent, 'key'>, success?: () => void) {
    if (active.current) return;
    if (next && !intent.current) {
      intent.current = { ...next, key: createIdempotencyKey() };
      onConfirmed.current = success;
    }
    const request = intent.current;
    if (!request) return;
    active.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await mutationFetch(
        request.path,
        {
          method: request.method,
          headers: request.body ? { 'content-type': 'application/json' } : undefined,
          body: request.body,
        },
        { idempotencyKey: request.key, retries: 0 },
      );
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setError(details?.error?.message ?? t('variant.manager.changeNotAccepted'));
        return;
      }
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (result.data === undefined) throw new Error(t('variant.manager.unconfirmed'));
      intent.current = null;
      onConfirmed.current?.();
      onConfirmed.current = undefined;
      router.refresh();
    } catch {
      setError(t('variant.manager.changeUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  function create() {
    const ids = variantIds
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!name.trim() || ids.length < 2 || ids.length > 10) {
      setError(t('variant.manager.validation'));
      return;
    }
    void run(
      {
        path: `/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments`,
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), platform, variantIds: ids, evaluationPolicy: automatic ? 'fixed-post-engagement-v1' : 'manual' }),
      },
      () =>
        setMessage(t('variant.manager.saved')),
    );
  }

  function setStatus(experiment: VariantExperiment, status: 'running' | 'paused') {
    void run(
      {
        path: `/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/${encodeURIComponent(experiment.id)}`,
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      () => setMessage(t('variant.manager.statusChanged', { status: t(`variant.status.${status}`) })),
    );
  }

  return (
    <div className="stack">
      <p className="subtle">{t('variant.manager.intro')}</p>
      {experiments.length === 0 ? (
        <p>{t('variant.manager.empty')}</p>
      ) : (
        <div className="stack">
          {experiments.map((experiment) => (
            <article className="card stack" key={experiment.id}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                  <h3>{experiment.name}</h3>
                  <p className="subtle">
                    {experiment.platform} · {t(`variant.status.${experiment.status}`)}
                    {experiment.winnerVariantId ? ` · ${t('variant.manager.winner', { id: experiment.winnerVariantId })}` : ''}
                  </p>
                </div>
                {canEdit && experiment.status !== 'completed' && (
                  <div className="action-row">
                    {experiment.status === 'running' ? (
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={busy || intent.current !== null}
                        onClick={() => setStatus(experiment, 'paused')}
                      >
                        {t('variant.manager.pause')}
                      </button>
                    ) : (
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={busy || intent.current !== null}
                        onClick={() => setStatus(experiment, 'running')}
                      >
                        {t('variant.manager.start')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="grid">
                {experiment.stats.map((stat) => (
                  <div
                    className="card"
                    style={{ background: 'var(--panel2)' }}
                    key={stat.variantId}
                  >
                    <strong className="mono">{stat.variantId}</strong>
                    <span className="subtle">
                      {t('variant.manager.allocations', { count: stat.exposures })} · {t('variant.manager.outcomes', { count: stat.outcomes })}
                    </span>
                    <span>{t('variant.manager.metricTotal', { value: stat.metricTotal.toFixed(2) })}</span>
                    <span>{stat.conversions === undefined ? t('variant.manager.conversionsUnavailable') : t('variant.manager.conversions', { count: stat.conversions })}</span>
                    {canEdit && experiment.evaluationPolicy !== 'fixed-post-engagement-v1' && ['running', 'paused'].includes(experiment.status) && <button type="button" className="btn secondary"
                      disabled={busy || intent.current !== null || experiment.stats.some(item => item.outcomes < 1)}
                      onClick={() => {
                        if (!window.confirm(t('variant.manager.confirmWinner'))) return;
                        void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/${encodeURIComponent(experiment.id)}/promote`, method: 'POST', body: JSON.stringify({ variantId: stat.variantId }) }, () => setMessage(t('variant.manager.winnerRecorded')));
                      }}>Select as winner</button>}
                  </div>
                ))}
              </div>
              {experiment.evaluationPolicy === 'fixed-post-engagement-v1' ? <p className="subtle">
                {t('variant.manager.automaticDescription')}
                {experiment.status === 'completed' && !experiment.winnerVariantId ? ` ${t('variant.manager.automaticResult')}` : ''}
              </p> : experiment.status !== 'completed' && <p className="subtle">{t('variant.manager.manualResult')}</p>}
              <VariantExperimentTracking modelId={modelId} experimentId={experiment.id} status={experiment.status} platform={experiment.platform} canEdit={canEdit} />
              <VariantPublishedPerformance modelId={modelId} experimentId={experiment.id} />
              <VariantGuidanceAttribution modelId={modelId} experimentId={experiment.id} />
              <VariantEvaluationReport evaluation={experiment.evaluation} variantIds={experiment.variantIds} winnerVariantId={experiment.winnerVariantId} />
            </article>
          ))}
        </div>
      )}
      {canEdit ? (
        <fieldset
          className="stack"
          disabled={busy || intent.current !== null}
          style={{ border: 0, padding: 0, minWidth: 0 }}
        >
          <legend>{t('variant.manager.createLegend')}</legend>
          <label>
            {t('variant.manager.name')}
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </label>
          <div className="row">
            <label>
              {t('variant.manager.platform')}
              <select value={platform} onChange={(event) => { setPlatform(event.target.value); setVariantIds(''); }}>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="threads">Threads</option>
                <option value="x">X</option>
                <option value="youtube">YouTube</option>
              </select>
            </label>
          </div>
          <p>{t('variant.manager.selectionNote')}</p>
          <label className="checkbox-option"><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />
            <span>{t('variant.manager.automatic')}</span>
          </label>
          <p className="subtle">{t('variant.manager.automaticHelp')}</p>
          {available.length === 0 && <p>{t('variant.manager.noVariants')} <Link href={`/models/${encodeURIComponent(modelId)}/media`}>{t('variant.manager.createMedia')}</Link>.</p>}
          <div className="grid">{available.map(candidate => <div className="card stack" key={candidate.id}>
            {candidate.copy && <div><p className="subtle">{t('variant.manager.copyPlatform', { platform: candidate.copy.platform })}</p><p style={{ whiteSpace: 'pre-wrap' }}>{candidate.copy.text}</p></div>}
            {candidate.copy && <VariantGuidanceSummary guidance={candidate.guidance} />}
            {candidate.outputAssetId && <VariantReviewCreate modelId={modelId} variantId={candidate.id} requiresCaption={!candidate.copy} />}
            <label className="checkbox-option"><input type="checkbox" disabled={Boolean(candidate.copy && candidate.copy.platform !== platform)} checked={variantIds.split(' ').includes(candidate.id)}
              onChange={event => setVariantIds(previous => {
                const ids = previous.split(' ').filter(Boolean);
                return (event.target.checked ? [...new Set([...ids, candidate.id])] : ids.filter(id => id !== candidate.id)).join(' ');
              })} /><span>{t('variant.manager.selection', { type: candidate.variantType, id: candidate.id.slice(0, 8) })}</span></label>
            {candidate.outputAssetId ? <details><summary>{t('variant.manager.preview')}</summary><BundleMedia modelId={modelId} assetId={candidate.outputAssetId} /></details>
              : <p className="subtle">{t('variant.manager.legacy')}</p>}
            {candidate.copy && candidate.copy.platform !== platform && <p className="subtle">{t('variant.manager.platformMismatch', { platform: candidate.copy.platform })}</p>}
          </div>)}</div>
          {cursor && <button className="btn secondary" type="button" disabled={loading} onClick={() => void loadMore()}>{loading ? t('variant.manager.loading') : t('variant.manager.loadMore')}</button>}
          <button className="btn" type="button" onClick={create}>{t('variant.manager.save')}</button>
        </fieldset>
      ) : (
        <p className="subtle">{t('variant.manager.roleRequired')}</p>
      )}
      {intent.current && (
        <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>
          {t('variant.manager.retry')}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
