'use client';

import { useRef, useState } from 'react';
import { formatNumber } from '@axiom/core';
import type { PlaybookGuideline } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from '@/components/LocaleProvider';
import PlaybookHistory from './PlaybookHistory';

const PLATFORMS = ['instagram', 'tiktok', 'threads', 'x', 'youtube', 'reddit', 'facebook', 'telegram', 'discord', 'fanvue'];

export default function PlaybookGuidelineManager({ modelId, initial, canEdit }: { modelId: string; initial: PlaybookGuideline[]; canEdit: boolean }) {
  const { locale, t } = useLocale();
  const first = initial[0];
  const [savedGuidelines, setSavedGuidelines] = useState(initial);
  const [revision, setRevision] = useState(first?.revision ?? 0);
  const [platform, setPlatform] = useState(first?.platform ?? 'instagram');
  const [optimalTimes, setOptimalTimes] = useState(first?.optimalTimes.join(', ') ?? '18:00');
  const [cadencePerWeek, setCadencePerWeek] = useState(String(first?.cadencePerWeek ?? 3));
  const [upsellStrategy, setUpsellStrategy] = useState(first?.upsellStrategy ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const intent = useRef<{ body: string; key: string } | null>(null);
  function selectPlatform(value: string) { const saved = savedGuidelines.find(item => item.platform === value); setRevision(saved?.revision ?? 0); setPlatform(value); setOptimalTimes(saved?.optimalTimes.join(', ') ?? '18:00'); setCadencePerWeek(String(saved?.cadencePerWeek ?? 3)); setUpsellStrategy(saved?.upsellStrategy ?? ''); }
  async function save() {
    if (!canEdit || busy) return;
    intent.current ??= { body: JSON.stringify({ expectedRevision: revision, platform, optimalTimes: optimalTimes.split(',').map(value => value.trim()).filter(Boolean), cadencePerWeek: Number(cadencePerWeek), upsellStrategy: upsellStrategy.trim() }), key: createIdempotencyKey() };
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/playbook-guidelines`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: intent.current.body }, { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) { await readDashboardError(response); setError(t('playbook.saveNotAccepted')); if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null; return; }
      const result = await readDashboardJson<{ data?: PlaybookGuideline }>(response);
      const submitted = JSON.parse(intent.current.body);
      if (!result.data || result.data.modelId !== modelId || result.data.platform !== submitted.platform
        || result.data.revision !== submitted.expectedRevision + 1 || result.data.cadencePerWeek !== submitted.cadencePerWeek
        || result.data.upsellStrategy !== submitted.upsellStrategy || JSON.stringify(result.data.optimalTimes) !== JSON.stringify(submitted.optimalTimes)) throw new Error('unconfirmed guideline response');
      setSavedGuidelines(previous => [...previous.filter(row => row.platform !== result.data!.platform), result.data!]);
      setRevision(result.data.revision);
      intent.current = null; setMessage(t('playbook.guidelineSaved', { platform, revision: formatNumber(result.data.revision, locale) }));
    } catch { setError(`${t('playbook.saveUnconfirmed')} ${t('playbook.retrySameChange')}`); }
    finally { setBusy(false); }
  }
  return <section className="card stack">
    <h3>{t('playbook.managerTitle')}</h3>
    <p className="subtle">{t('playbook.managerDescription')}</p>
    <label>{t('playbook.platform')}<select disabled={busy || !!intent.current} value={platform} onChange={event => selectPlatform(event.target.value)}>{PLATFORMS.map(item => <option key={item}>{item}</option>)}</select></label>
    <p>{t('playbook.editingRevision', { revision: formatNumber(revision, locale) })}{revision === 0 ? ` (${t('playbook.newGuideline')})` : ''}.</p>
    <fieldset className="stack" disabled={!canEdit || busy || !!intent.current} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <label>{t('playbook.cadencePerWeek')}<input type="number" min="0" max="100" value={cadencePerWeek} onChange={event => setCadencePerWeek(event.target.value)} /></label>
      <label>{t('playbook.optimalTimes')}<input value={optimalTimes} onChange={event => setOptimalTimes(event.target.value)} placeholder={t('playbook.optimalTimesPlaceholder')} /></label>
      <label>{t('playbook.upsellStrategy')}<textarea value={upsellStrategy} maxLength={2000} onChange={event => setUpsellStrategy(event.target.value)} placeholder={t('playbook.upsellPlaceholder')} /></label>
    </fieldset>
    {canEdit && <button className="btn" type="button" disabled={busy || !!intent.current} onClick={() => void save()}>{busy ? t('playbook.saving') : t('playbook.saveGuideline')}</button>}
    {canEdit && intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void save()}>{t('playbook.retryGuideline')}</button>}
    {!canEdit && <p className="subtle">{t('playbook.ownerRequired')}</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <PlaybookHistory key={`${modelId}:${platform}:${revision}`} modelId={modelId} platform={platform}
      onRestore={canEdit && !busy && !intent.current ? row => {
        setOptimalTimes(row.optimalTimes.join(', ')); setCadencePerWeek(String(row.cadencePerWeek)); setUpsellStrategy(row.upsellStrategy);
        setMessage(t('playbook.guidelineLoaded', { revision: formatNumber(row.revision, locale) }));
      } : undefined} />
  </section>;
}
