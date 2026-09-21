'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import type { VariantGuidanceSource } from '@/lib/api';
import { useLocale } from './LocaleProvider';

export default function CopyVariantCreate({ modelId, assetId }: { modelId: string; assetId: string }) {
  const { t } = useLocale();
  const [type, setType] = useState('caption');
  const [platform, setPlatform] = useState('instagram');
  const [text, setText] = useState('');
  const [guidanceBundleId, setGuidanceBundleId] = useState('');
  const [guidanceSources, setGuidanceSources] = useState<VariantGuidanceSource[]>([]);
  const [guidanceState, setGuidanceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const active = useRef(false), intent = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setGuidanceBundleId('');
    setGuidanceSources([]);
    setGuidanceState('loading');
    void fetch(`/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/guidance-sources?${new URLSearchParams({ assetId, platform })}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Guidance sources unavailable');
      const result = await readDashboardJson<{ data: VariantGuidanceSource[] }>(response);
      if (!Array.isArray(result.data) || result.data.some(source => source.platform !== platform || typeof source.caption !== 'string' || !source.guidance)) {
        throw new Error('Invalid guidance sources');
      }
      setGuidanceSources(result.data);
      setGuidanceState('ready');
    }).catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setGuidanceState('error');
    });
    return () => controller.abort();
  }, [assetId, modelId, platform]);

  async function save() {
    if (active.current || saved) return;
    if (!intent.current && !text.trim()) { setMessage(t('variant.copy.required')); return; }
    intent.current ??= { key: createIdempotencyKey(), body: JSON.stringify({ assetId, type, platform, text: text.trim(), ...(guidanceBundleId ? { guidanceBundleId } : {}) }) };
    active.current = true; setBusy(true); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/variant-experiments/candidates`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: intent.current.body,
      }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setMessage(error?.error?.message ?? t('variant.copy.notAccepted')); return;
      }
      const result = await readDashboardJson<{ data?: { id?: string } }>(response);
      if (!result.data?.id || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(result.data.id)) throw new Error(t('variant.copy.unconfirmed'));
      intent.current = null; setSaved(true); setMessage(t('variant.copy.saved'));
    } catch { setMessage(t('variant.copy.saveUnconfirmed')); }
    finally { active.current = false; setBusy(false); }
  }
  return <details><summary>{t('variant.create.title')}</summary><div className="stack">
    <p>{t('variant.create.description')}</p>
    {!saved && <><fieldset className="stack" disabled={busy || intent.current !== null}>
      <label>{t('variant.copy.type')}<select value={type} onChange={event => setType(event.target.value)}><option value="caption">{t('variant.copy.caption')}</option><option value="teaser">{t('variant.copy.teaser')}</option></select></label>
      <label>{t('variant.platform')}<select value={platform} onChange={event => setPlatform(event.target.value)}>{['instagram', 'tiktok', 'threads', 'x', 'youtube', 'reddit', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      {guidanceState === 'loading' && <p className="subtle">{t('variant.guidance.loading')}</p>}
      {guidanceState === 'error' && <p className="subtle">{t('variant.guidance.unavailable')}</p>}
      {guidanceSources.length > 0 && <label>{t('variant.guidance.start')}
        <select value={guidanceBundleId} onChange={event => {
          const id = event.target.value;
          setGuidanceBundleId(id);
          const source = guidanceSources.find(item => item.id === id);
          if (source) setText(source.caption);
        }}>
          <option value="">{t('variant.guidance.manual')}</option>
          {guidanceSources.map(source => <option key={source.id} value={source.id}>{source.guidance.selectedArm ?? t('variant.guidance.recorded')} · {source.id.slice(0, 8)}</option>)}
        </select>
      </label>}
      {guidanceBundleId && (() => {
        const selected = guidanceSources.find(source => source.id === guidanceBundleId);
        if (!selected) return null;
        const details = [selected.guidance.hookType && `${t('variant.detail.hook')}: ${selected.guidance.hookType}`, selected.guidance.format && `${t('variant.detail.format')}: ${selected.guidance.format}`, selected.guidance.postingHourUtc !== undefined && `${t('variant.detail.hour')}: ${selected.guidance.postingHourUtc}:00 UTC`, selected.guidance.timingBucket && `${t('variant.detail.timing')}: ${selected.guidance.timingBucket}`].filter(Boolean).join(' · ');
        return <p className="subtle">{t('variant.guidance.selected')} {details || t('variant.guidance.none')} {t('variant.guidance.selectionNote')}</p>;
      })()}
      <label>{t('variant.copy.text')}<textarea value={text} maxLength={10000} onChange={event => { setText(event.target.value); setGuidanceBundleId(''); }} /></label>
    </fieldset><button type="button" className="btn secondary" disabled={busy} onClick={() => void save()}>{busy ? t('variant.saving') : intent.current ? t('variant.retry.copy') : t('variant.save.copy')}</button></>}
    {message && <p role="status">{message}</p>}
    {saved && <div className="action-row"><Link href={`/models/${encodeURIComponent(modelId)}/experiments`}>{t('variant.openExperiments')}</Link><button type="button" className="btn secondary" onClick={() => { setSaved(false); setText(''); setGuidanceBundleId(''); setMessage(''); }}>{t('variant.createAnother')}</button></div>}
  </div></details>;
}
