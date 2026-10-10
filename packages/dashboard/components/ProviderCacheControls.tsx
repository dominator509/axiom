'use client';

import { useEffect, useState } from 'react';
import { formatNumber, PROVIDER_CACHE_CONTROL_CATALOGS } from '@axiom/core';
import { useLocale } from './LocaleProvider';
import type { CacheControlView, ProviderCacheTelemetryView } from '@/lib/cache-controls';

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export default function ProviderCacheControls({
  modelId,
  initialControls,
  initialTelemetry,
  canEdit,
}: {
  modelId: string;
  initialControls: CacheControlView[];
  initialTelemetry: ProviderCacheTelemetryView | null;
  canEdit: boolean;
}) {
  const { locale } = useLocale();
  const catalog = PROVIDER_CACHE_CONTROL_CATALOGS[locale] ?? PROVIDER_CACHE_CONTROL_CATALOGS.en;
  const t = (key: string) => catalog[key] ?? PROVIDER_CACHE_CONTROL_CATALOGS.en[key] ?? key;
  const [controls, setControls] = useState(initialControls);
  const [telemetry, setTelemetry] = useState(initialTelemetry);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [telemetryBusy, setTelemetryBusy] = useState(false);
  const [telemetryFailed, setTelemetryFailed] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  useEffect(() => setControls(initialControls), [initialControls]);
  useEffect(() => setTelemetry(initialTelemetry), [initialTelemetry]);

  async function refreshTelemetry() {
    if (telemetryBusy) return;
    setTelemetryBusy(true);
    setTelemetryFailed(false);
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/cache-telemetry`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('cache telemetry request failed');
      const body = await response.json() as { data?: ProviderCacheTelemetryView };
      if (!body.data || body.data.modelId !== modelId || body.data.source !== 'provider-reported')
        throw new Error('cache telemetry response was incomplete');
      setTelemetry(body.data);
    } catch {
      setTelemetryFailed(true);
    } finally {
      setTelemetryBusy(false);
    }
  }

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
      <div className="stack" aria-labelledby="cache-telemetry-title">
        <h3 id="cache-telemetry-title">{t('dashboard.cacheControls.telemetryTitle')}</h3>
        <p className="subtle">{t('dashboard.cacheControls.telemetryIntro')}</p>
        <button className="btn secondary" type="button" disabled={telemetryBusy} onClick={() => void refreshTelemetry()}>
          {telemetryBusy
            ? t('dashboard.cacheControls.telemetryRefreshing')
            : t('dashboard.cacheControls.telemetryRefresh')}
        </button>
        {telemetryFailed && <p role="alert">{t('dashboard.cacheControls.telemetryRequestFailed')}</p>}
        {!telemetryFailed && telemetry === null && <p className="subtle">{t('dashboard.cacheControls.telemetryRequestFailed')}</p>}
        {telemetry && telemetry.providers.length === 0 && <p className="subtle">{t('dashboard.cacheControls.telemetryEmpty')}</p>}
        {telemetry && telemetry.providers.length > 0 && <div className="stack">
          <p>
            <strong>{t(`dashboard.cacheControls.telemetryStatus.${telemetry.status}`)}</strong>
            {' · '}
            {t('dashboard.cacheControls.telemetryRate')}:{' '}
            {telemetry.cacheHitRate === null
              ? t('dashboard.cacheControls.telemetryUnavailable')
              : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(telemetry.cacheHitRate)}
          </p>
          <p className="subtle">
            {t('dashboard.cacheControls.telemetryMeasuredResponses')}: {formatNumber(telemetry.observedResponses, locale)} / {formatNumber(telemetry.observedResponses + telemetry.unobservedResponses, locale)}
            {' · '}{t('dashboard.cacheControls.telemetryUnknownResponses')}: {formatNumber(telemetry.unobservedResponses, locale)}
          </p>
          {telemetry.windowStart && telemetry.windowEnd && <p className="subtle">
            {t('dashboard.cacheControls.telemetryWindow')}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${telemetry.windowStart}T00:00:00Z`))}
            {' – '}{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${telemetry.windowEnd}T00:00:00Z`))}
          </p>}
          {telemetry.providers.map(provider => (
            <div className="card stack" key={provider.provider}>
              <h4>{PROVIDER_LABELS[provider.provider] ?? provider.provider}</h4>
              <p><strong>{t(`dashboard.cacheControls.telemetryStatus.${provider.status}`)}</strong> · {t('dashboard.cacheControls.telemetryRate')}: {' '}
                {provider.cacheHitRate === null
                  ? t('dashboard.cacheControls.telemetryUnavailable')
                  : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(provider.cacheHitRate)}
              </p>
              <p className="subtle">
                {t('dashboard.cacheControls.telemetryMeasuredResponses')}: {formatNumber(provider.observedResponses, locale)} / {formatNumber(provider.successfulResponses, locale)}
                {' · '}{t('dashboard.cacheControls.telemetryUnknownResponses')}: {formatNumber(provider.unobservedResponses, locale)}
              </p>
              <p className="subtle">
                {t('dashboard.cacheControls.telemetryCachedTokens')}: {formatNumber(provider.cachedPromptTokens, locale)} / {formatNumber(provider.promptTokens, locale)}
              </p>
            </div>
          ))}
        </div>}
      </div>
    </section>
  );
}
