'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TriggerAction, TriggerCondition, TriggerRule } from '@/lib/api';
import { useLocale } from '@/components/LocaleProvider';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const PLATFORMS = ['x', 'instagram', 'threads', 'facebook', 'tiktok', 'youtube', 'reddit', 'telegram', 'discord', 'fanvue'] as const;
const METRICS = ['likes', 'comments', 'shares', 'views', 'engagementRate'] as const;
type Intent = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: string; key: string };

const defaultCondition: TriggerCondition = { metric: 'likes', threshold: 100 };
const defaultAction: TriggerAction = { type: 'content.generate', style: 'follow-up', cooldownMinutes: 120 };

export default function TriggerRuleManager({ modelId, rules, canEdit }: { modelId: string; rules: TriggerRule[]; canEdit: boolean }) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const [name, setName] = useState('Viral follow-up');
  const [platform, setPlatform] = useState<string>('instagram');
  const [condition, setCondition] = useState<TriggerCondition>(defaultCondition);
  const [action, setAction] = useState<TriggerAction>(defaultAction);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const intent = useRef<Intent | null>(null);

  const metricLabel = (metric: string) => METRICS.includes(metric as (typeof METRICS)[number]) ? t(`automation.metric.${metric}`) : metric;
  const actionLabel = (type: string) => type === 'content.generate' ? t('automation.generateFollowUp') : type === 'relay.card' ? t('automation.sendRelayCard') : type;
  const formatDate = (value: string) => new Date(value).toLocaleString(locale);

  async function run(next?: Omit<Intent, 'key'>, success?: (data: unknown) => void) {
    if (busy) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(request.path, { method: request.method, headers: request.body ? { 'content-type': 'application/json' } : undefined, body: request.body }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setError(t('automation.changeNotAccepted'));
        return;
      }
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (result.data === undefined) throw new Error('Unconfirmed trigger rule response');
      success?.(result.data); intent.current = null; router.refresh();
    } catch { setError(`${t('automation.unconfirmed')} ${t('automation.retry')}`); }
    finally { setBusy(false); }
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed || !Number.isFinite(condition.threshold) || condition.threshold < 0) {
      setError(t('automation.validation')); return;
    }
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/trigger-rules`, method: 'POST', body: JSON.stringify({ name: trimmed, platform, condition, action, enabled: true }) }, () => setMessage(t('automation.ruleSaved')));
  }

  function toggle(rule: TriggerRule) {
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/trigger-rules/${encodeURIComponent(rule.id)}`, method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) }, () => setMessage(rule.enabled ? t('automation.ruleDisabled') : t('automation.ruleEnabled')));
  }

  function remove(rule: TriggerRule) {
    if (!window.confirm(t('automation.confirmDelete', { name: rule.name }))) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/trigger-rules/${encodeURIComponent(rule.id)}`, method: 'DELETE' }, () => setMessage(t('automation.ruleDeleted')));
  }

  return <div className="stack">
    <p className="subtle">{t('automation.rulesDescription')}</p>
    {rules.length === 0 ? <p>{t('automation.noRules')}</p> : <div className="stack">{rules.map(rule => <article className="card stack" key={rule.id}><div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}><div><h3>{rule.name}</h3><p className="subtle">{rule.platform}: {metricLabel(rule.condition.metric)} ≥ {rule.condition.threshold} → {actionLabel(rule.action.type)}{rule.lastFiredAt ? ` · ${t('automation.lastFired', { value: formatDate(rule.lastFiredAt) })}` : ` · ${t('automation.neverFired')}`}</p></div>{canEdit && <div className="action-row"><button className="btn secondary" type="button" disabled={busy} onClick={() => toggle(rule)}>{rule.enabled ? t('automation.disable') : t('automation.enable')}</button><button className="btn secondary" type="button" disabled={busy} onClick={() => remove(rule)}>{t('automation.delete')}</button></div>}</div></article>)}</div>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{t('automation.createRule')}</legend><label>{t('automation.name')}<input value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label><div className="row"><label>{t('automation.platform')}<select value={platform} onChange={event => setPlatform(event.target.value)}>{PLATFORMS.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>{t('automation.metric')}<select value={condition.metric} onChange={event => setCondition(current => ({ ...current, metric: event.target.value as TriggerCondition['metric'] }))}>{METRICS.map(item => <option key={item} value={item}>{metricLabel(item)}</option>)}</select></label><label>{t('automation.threshold')}<input type="number" min={0} step="any" value={condition.threshold} onChange={event => setCondition(current => ({ ...current, threshold: Number(event.target.value) }))} /></label></div><div className="row"><label>{t('automation.action')}<select value={action.type} onChange={event => setAction(current => ({ ...current, type: event.target.value as TriggerAction['type'] }))}><option value="content.generate">{t('automation.generateFollowUp')}</option><option value="relay.card">{t('automation.sendRelayCard')}</option></select></label><label>{t('automation.cooldownMinutes')}<input type="number" min={1} max={10080} value={action.cooldownMinutes ?? 120} onChange={event => setAction(current => ({ ...current, cooldownMinutes: Number(event.target.value) }))} /></label></div>{action.type === 'content.generate' && <label>{t('automation.followUpStyle')}<input value={action.style ?? ''} onChange={event => setAction(current => ({ ...current, style: event.target.value }))} maxLength={200} /></label>}<button className="btn" type="button" onClick={save}>{t('automation.saveRule')}</button></fieldset> : <p className="subtle">{t('automation.ownerRequired')}</p>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>{t('automation.retry')}</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
