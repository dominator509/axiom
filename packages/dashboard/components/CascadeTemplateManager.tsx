'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatNumber } from '@axiom/core';
import type { CascadeStep, CascadeTemplate } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const PLATFORMS = ['x', 'instagram', 'threads', 'facebook', 'tiktok', 'youtube', 'reddit', 'telegram', 'discord', 'fanvue'] as const;
type Intent = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: string; key: string };

export default function CascadeTemplateManager({ modelId, templates, canEdit }: { modelId: string; templates: CascadeTemplate[]; canEdit: boolean }) {
  const { locale, t } = useLocale();
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
        setError(details?.error?.message ?? t('cascade.error.notAccepted'));
        return;
      }
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (result.data === undefined) throw new Error(t('cascade.error.unconfirmedResponse'));
      success?.(result.data);
      intent.current = null;
      router.refresh();
    } catch { setError(t('cascade.error.notConfirmed')); }
    finally { setBusy(false); }
  }

  function updateStep(index: number, patch: Partial<CascadeStep>) {
    setSteps(current => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed || steps.length === 0 || steps[0].offsetMinutes !== 0 || steps.some((step, index) => step.offsetMinutes < 0 || (index > 0 && step.offsetMinutes < steps[index - 1]!.offsetMinutes))) {
      setError(t('cascade.error.validation')); return;
    }
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/cascade-templates`, method: 'POST', body: JSON.stringify({ name: trimmed, steps, enabled: true }) }, () => setMessage(t('cascade.saved')));
  }

  function expand(template: CascadeTemplate) {
    if (!bundleId.trim() || !baseScheduledFor) { setError(t('cascade.error.expandInputs')); return; }
    if (!window.confirm(t('cascade.confirmExpand', { name: template.name }))) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/cascade-templates/${encodeURIComponent(template.id)}/expand`, method: 'POST', body: JSON.stringify({ bundleId: bundleId.trim(), baseScheduledFor: new Date(baseScheduledFor).toISOString() }) }, (data) => {
      if (!Array.isArray(data)) throw new Error(t('cascade.error.expandTargets'));
      setMessage(data.length === 1 ? t('cascade.expandedOne') : t('cascade.expandedMany', { count: formatNumber(data.length, locale) }));
    });
  }

  function toggle(template: CascadeTemplate) {
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/cascade-templates/${encodeURIComponent(template.id)}`, method: 'PATCH', body: JSON.stringify({ enabled: !template.enabled }) }, () => setMessage(template.enabled ? t('cascade.disabledMessage', { name: template.name }) : t('cascade.enabledMessage', { name: template.name })));
  }

  function remove(template: CascadeTemplate) {
    if (!window.confirm(t('cascade.confirmDelete', { name: template.name }))) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/cascade-templates/${encodeURIComponent(template.id)}`, method: 'DELETE' }, () => setMessage(t('cascade.deleted')));
  }

  return <div className="stack">
    <p className="subtle">{t('cascade.intro')}</p>
    {templates.length === 0 ? <p>{t('cascade.empty')}</p> : <div className="stack">{templates.map(template => <article className="card stack" key={template.id}><div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}><div><h3>{template.name}</h3><p className="subtle">{template.steps.map(step => `${step.platform} +${step.offsetMinutes}m`).join(' → ')}</p></div>{canEdit && <div className="action-row"><button className="btn secondary" type="button" disabled={busy} onClick={() => toggle(template)}>{template.enabled ? t('cascade.disable') : t('cascade.enable')}</button><button className="btn secondary" type="button" disabled={busy} onClick={() => remove(template)}>{t('cascade.delete')}</button><button className="btn" type="button" disabled={busy || !template.enabled} onClick={() => expand(template)}>{t('cascade.expandSchedule')}</button></div>}</div></article>)}</div>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{t('cascade.createLegend')}</legend><label>{t('cascade.templateName')}<input value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label>{steps.map((step, index) => <div className="row" key={index}><label>{t('cascade.stepLabel', { index: index + 1 })}<select value={step.platform} onChange={event => updateStep(index, { platform: event.target.value })}>{PLATFORMS.map(platform => <option key={platform} value={platform}>{platform}</option>)}</select></label><label>{t('cascade.minutesAfterBase')}<input type="number" min={0} max={10080} value={step.offsetMinutes} onChange={event => updateStep(index, { offsetMinutes: Number(event.target.value) })} /></label>{steps.length > 1 && <button className="btn secondary" type="button" onClick={() => setSteps(current => current.filter((_, stepIndex) => stepIndex !== index))}>{t('cascade.removeStep')}</button>}</div>)}<div className="action-row"><button className="btn secondary" type="button" onClick={() => setSteps(current => [...current, { platform: 'threads', offsetMinutes: (current.at(-1)?.offsetMinutes ?? 0) + 60 }])} disabled={steps.length >= 10}>{t('cascade.addStep')}</button><button className="btn" type="button" onClick={save}>{t('cascade.save')}</button></div></fieldset> : <p className="subtle">{t('cascade.roleRequired')}</p>}
    {templates.length > 0 && canEdit && <div className="card stack"><h3>{t('cascade.expandLegend')}</h3><label>{t('cascade.bundleId')}<input value={bundleId} onChange={event => setBundleId(event.target.value)} placeholder={t('cascade.bundleIdPlaceholder')} /></label><label>{t('cascade.baseTime')}<input type="datetime-local" value={baseScheduledFor} onChange={event => setBaseScheduledFor(event.target.value)} /></label><p className="subtle">{t('cascade.expandNote')}</p></div>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>{t('cascade.retry')}</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
