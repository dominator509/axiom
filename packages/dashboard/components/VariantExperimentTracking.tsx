'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import VariantReviewCreate from './VariantReviewCreate';
import Link from 'next/link';
import { useLocale } from './LocaleProvider';

type Assignment = { id: string; variantId: string; assignedAt: string; outcomeAt: string | null; converted: boolean; metricValue: number | null; reviewBundleId?: string | null; variantType?: string };
type Intent = { path: string; body: string; key: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function VariantExperimentTracking({ modelId, experimentId, status, canEdit, platform = 'instagram' }: {
  modelId: string; experimentId: string; status: string; canEdit: boolean; platform?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const base = `/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/${encodeURIComponent(experimentId)}`;
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [assignmentKey, setAssignmentKey] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [converted, setConverted] = useState('');
  const [metric, setMetric] = useState('');
  const active = useRef(false), reading = useRef(false);
  const intent = useRef<Intent | null>(null);

  async function load(more = false) {
    if (reading.current) return;
    reading.current = true; setLoading(true); setError('');
    try {
      const response = await fetch(`${base}/assignments${more && cursor ? `?${new URLSearchParams({ cursor })}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Assignments unavailable');
      const result = await readDashboardJson<{ data: Assignment[]; meta: { next_cursor: string | null } }>(response);
      if (!Array.isArray(result.data) || !result.meta || !(result.meta.next_cursor === null || typeof result.meta.next_cursor === 'string') ||
        result.data.some(row => !uuid.test(row.id) || !uuid.test(row.variantId) || typeof row.assignedAt !== 'string' || !(row.outcomeAt === null || typeof row.outcomeAt === 'string') || typeof row.converted !== 'boolean' || !(row.metricValue === null || Number.isFinite(row.metricValue)) ||
          !(row.reviewBundleId == null || typeof row.reviewBundleId === 'string' && uuid.test(row.reviewBundleId)) || !(row.variantType === undefined || typeof row.variantType === 'string'))) throw new Error('Invalid assignments');
      setRows(previous => more ? [...new Map([...previous, ...result.data].map(row => [row.id, row])).values()] : result.data);
      setCursor(result.meta.next_cursor); setLoaded(true);
    } catch { setError(t('variant.tracking.historyFailed')); }
    finally { reading.current = false; setLoading(false); }
  }

  async function send(next?: { path: string; body: string }) {
    if (active.current || !canEdit) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    active.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(request.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: request.body }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setError(details?.error?.message ?? t('variant.tracking.changeNotAccepted')); return;
      }
      const result = await readDashboardJson<{ data?: { id?: string; variantId?: string } }>(response);
      if (!result.data?.id || !uuid.test(result.data.id) || !result.data.variantId || !uuid.test(result.data.variantId)) throw new Error(t('variant.tracking.unconfirmed'));
      intent.current = null;
      setAssignmentId(request.path.endsWith('/assign') ? result.data.id : '');
      if (request.path.endsWith('/outcomes')) { setConverted(''); setMetric(''); }
      setMessage(t('variant.tracking.recorded', { assignment: result.data.id.slice(0, 8), variant: result.data.variantId.slice(0, 8) }));
      await load(); router.refresh();
    } catch { setError(t('variant.tracking.changeNotConfirmed')); }
    finally { active.current = false; setBusy(false); }
  }

  function recordOutcome() {
    const metricValue = metric.trim() === '' ? undefined : Number(metric);
    if (!uuid.test(assignmentId) || !['yes', 'no'].includes(converted) || (metricValue !== undefined && (!Number.isFinite(metricValue) || Math.abs(metricValue) > 1_000_000_000))) {
      setError(t('variant.tracking.invalidOutcome')); return;
    }
    void send({ path: `${base}/outcomes`, body: JSON.stringify({ assignmentId, converted: converted === 'yes', metricValue }) });
  }

  return <details className="stack">
    <summary>{t('variant.tracking.title')}</summary>
    <p className="subtle">{t('variant.tracking.description')}</p>
    <button type="button" className="btn secondary" disabled={loading || busy} onClick={() => void load()}>{loading ? t('variant.tracking.loading') : t('variant.tracking.refresh')}</button>
    {loaded && rows.length === 0 && <p>{t('variant.tracking.noAssignments')}</p>}
    <ul className="stack">{rows.map(row => <li key={row.id}>
      <span className="mono">{row.id.slice(0, 8)}</span> · {t('variant.tracking.variant')} {row.variantId.slice(0, 8)} · {row.outcomeAt ? `${row.converted ? t('variant.tracking.converted') : t('variant.tracking.notConverted')}${row.metricValue === null ? '' : ` · ${t('variant.tracking.metric', { value: row.metricValue })}`}` : t('variant.tracking.awaiting')}
      {row.reviewBundleId ? <Link href={`/models/${encodeURIComponent(modelId)}/approvals`}>{t('variant.tracking.reviewBundle', { id: row.reviewBundleId.slice(0, 8) })}</Link>
        : canEdit && ['running', 'paused'].includes(status) && row.variantType && <VariantReviewCreate modelId={modelId} variantId={row.variantId} assignmentId={row.id} requiresCaption={!['caption', 'teaser'].includes(row.variantType)} initialPlatform={platform} />}
    </li>)}</ul>
    {cursor && <button type="button" className="btn secondary" disabled={loading || busy} onClick={() => void load(true)}>{t('variant.tracking.loadOlder')}</button>}
    {canEdit && status === 'running' && <fieldset className="stack" disabled={busy || intent.current !== null}>
      <legend>{t('variant.tracking.allocateLegend')}</legend>
      <label>{t('variant.tracking.stableId')}<input value={assignmentKey} maxLength={256} onChange={event => setAssignmentKey(event.target.value)} /></label>
      <p className="subtle">{t('variant.tracking.allocationHelp')}</p>
      <button type="button" className="btn secondary" disabled={!assignmentKey.trim()} onClick={() => void send({ path: `${base}/assign`, body: JSON.stringify({ assignmentKey: assignmentKey.trim() }) })}>{t('variant.tracking.allocate')}</button>
    </fieldset>}
    {canEdit && ['running', 'paused'].includes(status) && <fieldset className="stack" disabled={busy || intent.current !== null}>
      <legend>{t('variant.tracking.outcomeLegend')}</legend>
      <label>{t('variant.tracking.id')}<select value={assignmentId} onChange={event => { setAssignmentId(event.target.value); setConverted(''); setMetric(''); }}>
        <option value="">{t('variant.tracking.selectAssignment')}</option>
        {rows.filter(row => !row.outcomeAt).map(row => <option key={row.id} value={row.id}>{row.id.slice(0, 8)} · {t('variant.tracking.variant')} {row.variantId.slice(0, 8)}</option>)}
      </select></label>
      <label>{t('variant.tracking.observedConversion')}<select value={converted} onChange={event => setConverted(event.target.value)}><option value="">{t('variant.tracking.chooseResult')}</option><option value="yes">{t('variant.tracking.converted')}</option><option value="no">{t('variant.tracking.notConverted')}</option></select></label>
      <label>{t('variant.tracking.measured')}<input type="number" min={-1_000_000_000} max={1_000_000_000} step="any" value={metric} onChange={event => setMetric(event.target.value)} /></label>
      <p className="subtle">{t('variant.tracking.outcomeHelp')}</p>
      <button type="button" className="btn secondary" disabled={!assignmentId || !converted} onClick={recordOutcome}>{t('variant.tracking.saveOutcome')}</button>
    </fieldset>}
    {intent.current && <button type="button" className="btn secondary" disabled={busy} onClick={() => void send()}>{t('variant.tracking.retry')}</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </details>;
}
