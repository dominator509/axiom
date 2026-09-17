'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CascadeStep, CascadeTemplate } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const PLATFORMS = ['x', 'instagram', 'threads', 'facebook', 'tiktok', 'youtube', 'reddit', 'telegram', 'discord', 'fanvue'] as const;
type Intent = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: string; key: string };

export default function CascadeTemplateManager({ modelId, templates, canEdit }: { modelId: string; templates: CascadeTemplate[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('Cross-platform launch');
  const [steps, setSteps] = useState<CascadeStep[]>([{ platform: 'x', offsetMinutes: 0 }, { platform: 'instagram', offsetMinutes: 120 }]);
  const [bundleId, setBundleId] = useState('');
  const [baseScheduledFor, setBaseScheduledFor] = useState('');
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
        setError(details?.error?.message ?? 'Cascade change was not accepted.');
        return;
      }
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (result.data === undefined) throw new Error('Unconfirmed cascade response');
      success?.(result.data);
      intent.current = null;
      router.refresh();
    } catch { setError('Cascade change was not confirmed. Retry the same intent.'); }
    finally { setBusy(false); }
  }

  function updateStep(index: number, patch: Partial<CascadeStep>) {
    setSteps(current => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed || steps.length === 0 || steps[0].offsetMinutes !== 0 || steps.some((step, index) => step.offsetMinutes < 0 || (index > 0 && step.offsetMinutes < steps[index - 1]!.offsetMinutes))) {
      setError('Enter a name and keep the first step at 0 minutes with ascending offsets.'); return;
    }
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/cascade-templates`, method: 'POST', body: JSON.stringify({ name: trimmed, steps, enabled: true }) }, () => setMessage('Cascade template saved. Expansion still requires an approved bundle and connected destination accounts.'));
  }

  function expand(template: CascadeTemplate) {
    if (!bundleId.trim() || !baseScheduledFor) { setError('Enter an approved bundle ID and a future base time before expanding.'); return; }
    if (!window.confirm(`Expand ${template.name} into scheduled targets? This queues work but does not publish immediately.`)) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/cascade-templates/${encodeURIComponent(template.id)}/expand`, method: 'POST', body: JSON.stringify({ bundleId: bundleId.trim(), baseScheduledFor: new Date(baseScheduledFor).toISOString() }) }, (data) => {
      if (!Array.isArray(data)) throw new Error('Cascade expansion did not return targets');
      setMessage(`Cascade expanded into ${data.length} scheduled target${data.length === 1 ? '' : 's'}.`);
    });
  }

  function toggle(template: CascadeTemplate) {
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/cascade-templates/${encodeURIComponent(template.id)}`, method: 'PATCH', body: JSON.stringify({ enabled: !template.enabled }) }, () => setMessage(`Cascade template ${template.enabled ? 'disabled' : 'enabled'}.`));
  }

  function remove(template: CascadeTemplate) {
    if (!window.confirm(`Delete the ${template.name} template? Existing scheduled posts are not removed.`)) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/cascade-templates/${encodeURIComponent(template.id)}`, method: 'DELETE' }, () => setMessage('Cascade template deleted. Existing scheduled posts were retained.'));
  }

  return <div className="stack">
    <p className="subtle">A cascade expands one approved bundle into normal scheduled targets such as X now, Instagram +2 hours, and Threads +3 hours. Each target still uses consent, account, ToS, kill-switch, and worker gates.</p>
    {templates.length === 0 ? <p>No cascade templates saved for this talent.</p> : <div className="stack">{templates.map(template => <article className="card stack" key={template.id}><div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}><div><h3>{template.name}</h3><p className="subtle">{template.steps.map(step => `${step.platform} +${step.offsetMinutes}m`).join(' → ')}</p></div>{canEdit && <div className="action-row"><button className="btn secondary" type="button" disabled={busy} onClick={() => toggle(template)}>{template.enabled ? 'Disable' : 'Enable'}</button><button className="btn secondary" type="button" disabled={busy} onClick={() => remove(template)}>Delete</button><button className="btn" type="button" disabled={busy || !template.enabled} onClick={() => expand(template)}>Expand schedule</button></div>}</div></article>)}</div>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Create cascade template</legend><label>Template name<input value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label>{steps.map((step, index) => <div className="row" key={index}><label>Step {index + 1}<select value={step.platform} onChange={event => updateStep(index, { platform: event.target.value })}>{PLATFORMS.map(platform => <option key={platform} value={platform}>{platform}</option>)}</select></label><label>Minutes after base<input type="number" min={0} max={10080} value={step.offsetMinutes} onChange={event => updateStep(index, { offsetMinutes: Number(event.target.value) })} /></label>{steps.length > 1 && <button className="btn secondary" type="button" onClick={() => setSteps(current => current.filter((_, stepIndex) => stepIndex !== index))}>Remove step</button>}</div>)}<div className="action-row"><button className="btn secondary" type="button" onClick={() => setSteps(current => [...current, { platform: 'threads', offsetMinutes: (current.at(-1)?.offsetMinutes ?? 0) + 60 }])} disabled={steps.length >= 10}>Add step</button><button className="btn" type="button" onClick={save}>Save cascade template</button></div></fieldset> : <p className="subtle">Cascade changes require an owner, manager, or operator role.</p>}
    {templates.length > 0 && canEdit && <div className="card stack"><h3>Expand a saved template</h3><label>Approved bundle ID<input value={bundleId} onChange={event => setBundleId(event.target.value)} placeholder="UUID from Review & approve" /></label><label>Base schedule time<input type="datetime-local" value={baseScheduledFor} onChange={event => setBaseScheduledFor(event.target.value)} /></label><p className="subtle">Expansion is a scheduling action. It will not bypass approval or create a provider connection.</p></div>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>Retry same cascade change</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
