'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VariantExperiment, VariantCandidate } from '@/lib/api';
import BundleMedia from './BundleMedia';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

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
  const router = useRouter();
  const [name, setName] = useState('Creative variant test');
  const [platform, setPlatform] = useState('instagram');
  const [variantIds, setVariantIds] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const intent = useRef<Intent | null>(null);
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
      if (!response.ok) throw new Error('Candidates unavailable');
      const result = await readDashboardJson<{ data: VariantCandidate[]; meta: { next_cursor: string | null } }>(response);
      if (!Array.isArray(result.data) || !result.meta) throw new Error('Invalid candidates');
      setAvailable(previous => [...new Map([...previous, ...result.data].map(item => [item.id, item])).values()]);
      setCursor(result.meta.next_cursor);
    } catch { setError('More variants could not be loaded. Your selections are unchanged; try again.'); }
    finally { loadingRef.current = false; setLoading(false); }
  }

  async function run(next?: Omit<Intent, 'key'>, success?: () => void) {
    if (active.current) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
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
        setError(details?.error?.message ?? 'Variant experiment change was not accepted.');
        return;
      }
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (result.data === undefined) throw new Error('Unconfirmed variant experiment response');
      intent.current = null;
      success?.();
      router.refresh();
    } catch {
      setError('Variant experiment change was not confirmed. Retry the same intent.');
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
      setError('Enter a name and select two to ten variants.');
      return;
    }
    void run(
      {
        path: `/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments`,
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), platform, variantIds: ids }),
      },
      () =>
        setMessage(
          'Experiment saved. Start it only after confirming the variants and approval plan.',
        ),
    );
  }

  function setStatus(experiment: VariantExperiment, status: 'running' | 'paused') {
    void run(
      {
        path: `/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/${encodeURIComponent(experiment.id)}`,
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      () => setMessage(`Experiment ${status}.`),
    );
  }

  return (
    <div className="stack">
      <p className="subtle">
        Assignments are stable per experiment key and outcomes feed measurement only. Experiments
        never publish, bypass ToS, or approve a bundle.
      </p>
      {experiments.length === 0 ? (
        <p>No variant experiments saved for this talent.</p>
      ) : (
        <div className="stack">
          {experiments.map((experiment) => (
            <article className="card stack" key={experiment.id}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                  <h3>{experiment.name}</h3>
                  <p className="subtle">
                    {experiment.platform} · {experiment.status}
                    {experiment.winnerVariantId ? ` · winner ${experiment.winnerVariantId}` : ''}
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
                        Pause
                      </button>
                    ) : (
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={busy || intent.current !== null}
                        onClick={() => setStatus(experiment, 'running')}
                      >
                        Start
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
                      {stat.exposures} exposures · {stat.outcomes} outcomes
                    </span>
                    <span>Metric total: {stat.metricTotal.toFixed(2)}</span>
                    <span>{stat.conversions === undefined ? 'Conversion data unavailable' : `${stat.conversions} conversions`}</span>
                  </div>
                ))}
              </div>
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
          <legend>Create variant experiment</legend>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </label>
          <div className="row">
            <label>
              Platform
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="threads">Threads</option>
                <option value="x">X</option>
                <option value="youtube">YouTube</option>
              </select>
            </label>
          </div>
          <p>Select two to ten variants. Selection does not approve or publish them.</p>
          {available.length === 0 && <p>No variants yet. <Link href={`/models/${encodeURIComponent(modelId)}/media`}>Create crops or adaptations in the media library</Link>.</p>}
          <div className="grid">{available.map(candidate => <div className="card stack" key={candidate.id}>
            <label className="checkbox-option"><input type="checkbox" checked={variantIds.split(' ').includes(candidate.id)}
              onChange={event => setVariantIds(previous => {
                const ids = previous.split(' ').filter(Boolean);
                return (event.target.checked ? [...new Set([...ids, candidate.id])] : ids.filter(id => id !== candidate.id)).join(' ');
              })} /><span>{candidate.variantType} · {candidate.id.slice(0, 8)}</span></label>
            {candidate.outputAssetId ? <details><summary>Preview variant</summary><BundleMedia modelId={modelId} assetId={candidate.outputAssetId} /></details>
              : <p className="subtle">Legacy variant: verified preview is not available.</p>}
          </div>)}</div>
          {cursor && <button className="btn secondary" type="button" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading variants…' : 'Load more variants'}</button>}
          <button className="btn" type="button" onClick={create}>
            Save experiment
          </button>
        </fieldset>
      ) : (
        <p className="subtle">Experiment changes require an owner, manager, or operator role.</p>
      )}
      {intent.current && (
        <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>
          Retry same experiment change
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
