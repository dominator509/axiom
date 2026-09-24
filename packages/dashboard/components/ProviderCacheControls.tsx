'use client';

import { useEffect, useState } from 'react';
import { PROVIDER_CACHE_CONTROL_CATALOGS } from '@axiom/core';
import { useLocale } from './LocaleProvider';
import type { CacheControlView } from '@/lib/cache-controls';

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export default function ProviderCacheControls({
  modelId,
  initialControls,
  canEdit,
}: {
  modelId: string;
  initialControls: CacheControlView[];
  canEdit: boolean;
}) {
  const { locale } = useLocale();
  const catalog = PROVIDER_CACHE_CONTROL_CATALOGS[locale] ?? PROVIDER_CACHE_CONTROL_CATALOGS.en;
  const t = (key: string) => catalog[key] ?? PROVIDER_CACHE_CONTROL_CATALOGS.en[key] ?? key;
  const [controls, setControls] = useState(initialControls);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  useEffect(() => setControls(initialControls), [initialControls]);

  async function save(next: CacheControlView) {
    if (!canEdit || busyProvider) return;
    if (next.promptCacheKey !== null && !KEY_PATTERN.test(next.promptCacheKey)) {
      setStatus({ kind: 'error', message: t('dashboard.cacheControls.invalidKey') });
      return;
    }
    setBusyProvider(next.provider);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/cache-controls`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error('cache controls update failed');
      const body = await response.json() as { data?: CacheControlView };
      if (!body.data) throw new Error('cache controls response missing data');
      setControls(current => current.map(entry => entry.provider === body.data!.provider ? body.data! : entry));
      setStatus({ kind: 'ok', message: t('dashboard.cacheControls.saved') });
    } catch {
      setStatus({ kind: 'error', message: t('dashboard.cacheControls.notConfirmed') });
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <section className="card stack" aria-labelledby="cache-controls-title">
      <h2 id="cache-controls-title">{t('dashboard.cacheControls.title')}</h2>
      <p className="subtle">{t('dashboard.cacheControls.intro')}</p>
      {!canEdit && <p className="subtle">{t('dashboard.cacheControls.readOnly')}</p>}
      {status && <p role={status.kind === 'error' ? 'alert' : 'status'}>{status.message}</p>}
      {controls.map(control => (
        <fieldset key={control.provider} className="stack" disabled={!canEdit || busyProvider === control.provider}>
          <legend>{PROVIDER_LABELS[control.provider] ?? control.provider}</legend>
          <label className="row" style={{ justifyContent: 'space-between' }}>
            <span>{t('dashboard.cacheControls.enabled')}</span>
            <input type="checkbox" checked={control.enabled}
              onChange={event => setControls(current => current.map(entry => entry.provider === control.provider
                ? { ...entry, enabled: event.target.checked } : entry))} />
          </label>
          <label className="row" style={{ justifyContent: 'space-between' }}>
            <span>{t('dashboard.cacheControls.prefixAlignment')}</span>
            <input type="checkbox" checked={control.prefixAlignment} disabled={!control.enabled}
              onChange={event => setControls(current => current.map(entry => entry.provider === control.provider
                ? { ...entry, prefixAlignment: event.target.checked } : entry))} />
          </label>
          <label className="stack">
            <span>{t('dashboard.cacheControls.promptCacheKey')}</span>
            <input type="text" value={control.promptCacheKey ?? ''}
              placeholder={t('dashboard.cacheControls.keyHint')} disabled={!control.enabled}
              onChange={event => setControls(current => current.map(entry => entry.provider === control.provider
                ? { ...entry, promptCacheKey: event.target.value || null } : entry))} />
          </label>
          {!control.enabled && <p className="subtle">{t('dashboard.cacheControls.disabledNote')}</p>}
          {canEdit && <button className="btn" type="button" onClick={() => void save(control)}>
            {busyProvider === control.provider ? t('dashboard.cacheControls.saving') : t('dashboard.cacheControls.save')}
          </button>}
        </fieldset>
      ))}
    </section>
  );
}
