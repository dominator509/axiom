'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import VariantReviewCreate from './VariantReviewCreate';
import Link from 'next/link';

type Assignment = { id: string; variantId: string; assignedAt: string; outcomeAt: string | null; converted: boolean; metricValue: number | null; reviewBundleId?: string | null; variantType?: string };
type Intent = { path: string; body: string; key: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function VariantExperimentTracking({ modelId, experimentId, status, canEdit }: {
  modelId: string; experimentId: string; status: string; canEdit: boolean;
}) {
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
    } catch { setError('Assignment history could not be loaded. Try again.'); }
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
        setError(details?.error?.message ?? 'Tracking change was not accepted.'); return;
      }
      const result = await readDashboardJson<{ data?: { id?: string; variantId?: string } }>(response);
      if (!result.data?.id || !uuid.test(result.data.id) || !result.data.variantId || !uuid.test(result.data.variantId)) throw new Error('Unconfirmed receipt');
      intent.current = null;
      setAssignmentId(request.path.endsWith('/assign') ? result.data.id : '');
      if (request.path.endsWith('/outcomes')) { setConverted(''); setMetric(''); }
      setMessage(`Recorded assignment ${result.data.id.slice(0, 8)} for variant ${result.data.variantId.slice(0, 8)}. No media was published.`);
      await load(); router.refresh();
    } catch { setError('Tracking change was not confirmed. Retry the same request; do not create another assignment.'); }
    finally { active.current = false; setBusy(false); }
  }

  function recordOutcome() {
    const metricValue = metric.trim() === '' ? undefined : Number(metric);
    if (!uuid.test(assignmentId) || !['yes', 'no'].includes(converted) || (metricValue !== undefined && (!Number.isFinite(metricValue) || Math.abs(metricValue) > 1_000_000_000))) {
      setError('Select an assignment, choose the observed conversion result, and enter a valid metric or leave it blank.'); return;
    }
    void send({ path: `${base}/outcomes`, body: JSON.stringify({ assignmentId, converted: converted === 'yes', metricValue }) });
  }

  return <details className="stack">
    <summary>Assignments and observed outcomes</summary>
    <p className="subtle">Allocation is not proof that someone viewed a variant. Record only outcomes you actually observed. These records are not automatically verified provider analytics.</p>
    <button type="button" className="btn secondary" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Loading assignments…' : 'Refresh assignments'}</button>
    {loaded && rows.length === 0 && <p>No assignments recorded.</p>}
    <ul className="stack">{rows.map(row => <li key={row.id}>
      <span className="mono">{row.id.slice(0, 8)}</span> · variant {row.variantId.slice(0, 8)} · {row.outcomeAt ? `${row.converted ? 'Converted' : 'Did not convert'}${row.metricValue === null ? '' : ` · metric ${row.metricValue}`}` : 'Awaiting outcome'}
      {row.reviewBundleId ? <Link href={`/models/${encodeURIComponent(modelId)}/approvals`}>Review bundle {row.reviewBundleId.slice(0, 8)}</Link>
        : canEdit && ['running', 'paused'].includes(status) && ['caption', 'teaser'].includes(row.variantType ?? '') && <VariantReviewCreate modelId={modelId} variantId={row.variantId} assignmentId={row.id} />}
    </li>)}</ul>
    {cursor && <button type="button" className="btn secondary" disabled={loading || busy} onClick={() => void load(true)}>Load older assignments</button>}
    {canEdit && status === 'running' && <fieldset className="stack" disabled={busy || intent.current !== null}>
      <legend>Allocate a variant</legend>
      <label>Stable test identifier<input value={assignmentKey} maxLength={256} onChange={event => setAssignmentKey(event.target.value)} /></label>
      <p className="subtle">Use the same opaque identifier for the same participant or placement. Do not enter names, emails, or credentials. Allocation does not deliver the media.</p>
      <button type="button" className="btn secondary" disabled={!assignmentKey.trim()} onClick={() => void send({ path: `${base}/assign`, body: JSON.stringify({ assignmentKey: assignmentKey.trim() }) })}>Allocate variant</button>
    </fieldset>}
    {canEdit && ['running', 'paused'].includes(status) && <fieldset className="stack" disabled={busy || intent.current !== null}>
      <legend>Record observed outcome</legend>
      <label>Assignment<select value={assignmentId} onChange={event => { setAssignmentId(event.target.value); setConverted(''); setMetric(''); }}>
        <option value="">Select an assignment</option>
        {rows.filter(row => !row.outcomeAt).map(row => <option key={row.id} value={row.id}>{row.id.slice(0, 8)} · variant {row.variantId.slice(0, 8)}</option>)}
      </select></label>
      <label>Observed conversion<select value={converted} onChange={event => setConverted(event.target.value)}><option value="">Choose result</option><option value="yes">Converted</option><option value="no">Did not convert</option></select></label>
      <label>Measured value (optional)<input type="number" min={-1_000_000_000} max={1_000_000_000} step="any" value={metric} onChange={event => setMetric(event.target.value)} /></label>
      <p className="subtle">An outcome cannot be overwritten after saving. Use a consistent metric across every variant.</p>
      <button type="button" className="btn secondary" disabled={!assignmentId || !converted} onClick={recordOutcome}>Save observed outcome</button>
    </fieldset>}
    {intent.current && <button type="button" className="btn secondary" disabled={busy} onClick={() => void send()}>Retry same tracking request</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </details>;
}
