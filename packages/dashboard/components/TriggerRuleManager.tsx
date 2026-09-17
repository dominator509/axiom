'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TriggerAction, TriggerCondition, TriggerRule } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const PLATFORMS = ['x', 'instagram', 'threads', 'facebook', 'tiktok', 'youtube', 'reddit', 'telegram', 'discord', 'fanvue'] as const;
const METRICS = ['likes', 'comments', 'shares', 'views', 'engagementRate'] as const;
type Intent = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: string; key: string };

const defaultCondition: TriggerCondition = { metric: 'likes', threshold: 100 };
const defaultAction: TriggerAction = { type: 'content.generate', style: 'follow-up', cooldownMinutes: 120 };

export default function TriggerRuleManager({ modelId, rules, canEdit }: { modelId: string; rules: TriggerRule[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('Viral follow-up');
  const [platform, setPlatform] = useState<string>('instagram');
  const [condition, setCondition] = useState<TriggerCondition>(defaultCondition);
  const [action, setAction] = useState<TriggerAction>(defaultAction);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const intent = useRef<Intent | null>(null);

  async function run(next?: Omit<Intent, 'key'>, success?: (data: unknown) => void) {
    if (busy) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(request.path, { method: request.method, headers: request.body ? { 'content-type': 'application/json' } : undefined, body: request.body }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setError(details?.error?.message ?? 'Trigger rule change was not accepted.');
        return;
      }
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (result.data === undefined) throw new Error('Unconfirmed trigger rule response');
      success?.(result.data); intent.current = null; router.refresh();
    } catch { setError('Trigger rule change was not confirmed. Retry the same intent.'); }
    finally { setBusy(false); }
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed || !Number.isFinite(condition.threshold) || condition.threshold < 0) {
      setError('Enter a name and a non-negative threshold.'); return;
    }
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/trigger-rules`, method: 'POST', body: JSON.stringify({ name: trimmed, platform, condition, action, enabled: true }) }, () => setMessage('Rule saved. It will be evaluated after a real metrics observation; it never publishes without approval.'));
  }

  function toggle(rule: TriggerRule) {
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/trigger-rules/${encodeURIComponent(rule.id)}`, method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) }, () => setMessage(`Rule ${rule.enabled ? 'disabled' : 'enabled'}.`));
  }

  function remove(rule: TriggerRule) {
    if (!window.confirm(`Delete the ${rule.name} rule?`)) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/trigger-rules/${encodeURIComponent(rule.id)}`, method: 'DELETE' }, () => setMessage('Rule deleted.'));
  }

  return <div className="stack">
    <p className="subtle">Rules react to stored provider metrics. A follow-up creates a new bundle that still passes ToS, approval, kill-switch, and worker gates; a relay action sends an operator card only.</p>
    {rules.length === 0 ? <p>No trigger rules saved for this talent.</p> : <div className="stack">{rules.map(rule => <article className="card stack" key={rule.id}><div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}><div><h3>{rule.name}</h3><p className="subtle">{rule.platform}: {rule.condition.metric} ≥ {rule.condition.threshold} → {rule.action.type}{rule.lastFiredAt ? ` · last fired ${new Date(rule.lastFiredAt).toLocaleString()}` : ' · never fired'}</p></div>{canEdit && <div className="action-row"><button className="btn secondary" type="button" disabled={busy} onClick={() => toggle(rule)}>{rule.enabled ? 'Disable' : 'Enable'}</button><button className="btn secondary" type="button" disabled={busy} onClick={() => remove(rule)}>Delete</button></div>}</div></article>)}</div>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Create trigger rule</legend><label>Name<input value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label><div className="row"><label>Platform<select value={platform} onChange={event => setPlatform(event.target.value)}>{PLATFORMS.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>Metric<select value={condition.metric} onChange={event => setCondition(current => ({ ...current, metric: event.target.value as TriggerCondition['metric'] }))}>{METRICS.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>Threshold<input type="number" min={0} step="any" value={condition.threshold} onChange={event => setCondition(current => ({ ...current, threshold: Number(event.target.value) }))} /></label></div><div className="row"><label>Action<select value={action.type} onChange={event => setAction(current => ({ ...current, type: event.target.value as TriggerAction['type'] }))}><option value="content.generate">Generate follow-up</option><option value="relay.card">Send operator relay card</option></select></label><label>Cooldown minutes<input type="number" min={1} max={10080} value={action.cooldownMinutes ?? 120} onChange={event => setAction(current => ({ ...current, cooldownMinutes: Number(event.target.value) }))} /></label></div>{action.type === 'content.generate' && <label>Follow-up style<input value={action.style ?? ''} onChange={event => setAction(current => ({ ...current, style: event.target.value }))} maxLength={200} /></label>}<button className="btn" type="button" onClick={save}>Save trigger rule</button></fieldset> : <p className="subtle">Trigger changes require an owner, manager, or operator role.</p>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>Retry same rule change</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
