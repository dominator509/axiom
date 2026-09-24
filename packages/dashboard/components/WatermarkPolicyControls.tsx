'use client';

import { useEffect, useState } from 'react';
import { WATERMARK_POLICY_CATALOGS } from '@axiom/core';
import { useLocale } from './LocaleProvider';
import type { WatermarkPolicyView } from '@/lib/watermark-policy';
import {
  WATERMARK_POSITION_ORDER,
  WATERMARK_OPACITY_MIN,
  WATERMARK_OPACITY_MAX,
  WATERMARK_SCALE_MIN,
  WATERMARK_SCALE_MAX,
  WATERMARK_KEY_PATTERN,
} from '@/lib/watermark-policy';

export default function WatermarkPolicyControls({
  modelId,
  initialPolicy,
  canEdit,
}: {
  modelId: string;
  initialPolicy: WatermarkPolicyView;
  canEdit: boolean;
}) {
  const { locale } = useLocale();
  const catalog = WATERMARK_POLICY_CATALOGS[locale] ?? WATERMARK_POLICY_CATALOGS.en;
  const t = (key: string) => catalog[key] ?? WATERMARK_POLICY_CATALOGS.en[key] ?? key;

  const [policy, setPolicy] = useState(initialPolicy);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  useEffect(() => setPolicy(initialPolicy), [initialPolicy]);

  const touched = policy.enabled || policy.watermarkKey !== null;

  function validate(next: WatermarkPolicyView): string | null {
    if (next.enabled) {
      if (next.watermarkKey === null || next.watermarkKey.trim() === '') {
        return t('dashboard.watermark.invalidKey');
      }
      if (!WATERMARK_KEY_PATTERN.test(next.watermarkKey)) return t('dashboard.watermark.invalidKey');
    }
    if (!Number.isInteger(next.opacity) || next.opacity < WATERMARK_OPACITY_MIN || next.opacity > WATERMARK_OPACITY_MAX) {
      return t('dashboard.watermark.bounds.opacity');
    }
    if (!Number.isInteger(next.scale) || next.scale < WATERMARK_SCALE_MIN || next.scale > WATERMARK_SCALE_MAX) {
      return t('dashboard.watermark.bounds.scale');
    }
    return null;
  }

  async function save() {
    if (!canEdit || busy) return;
    const invalid = validate(policy);
    if (invalid) {
      setStatus({ kind: 'error', message: invalid });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/watermark-policy`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          enabled: policy.enabled,
          watermarkKey: policy.enabled ? policy.watermarkKey : null,
          position: policy.position,
          opacity: policy.opacity,
          scale: policy.scale,
        }),
      });
      if (!response.ok) throw new Error('watermark policy update failed');
      const body = await response.json() as { data?: WatermarkPolicyView };
      if (!body.data) throw new Error('watermark policy response missing data');
      setPolicy(body.data);
      setStatus({ kind: 'ok', message: t('dashboard.watermark.saved') });
    } catch {
      setStatus({ kind: 'error', message: t('dashboard.watermark.notConfirmed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="watermark-title">
      <h2 id="watermark-title">{t('dashboard.watermark.title')}</h2>
      <p className="subtle">{t('dashboard.watermark.intro')}</p>
      {!canEdit && <p className="subtle">{t('dashboard.watermark.readOnly')}</p>}
      {!touched && <p className="subtle">{t('dashboard.watermark.empty')}</p>}
      {status && <p role={status.kind === 'error' ? 'alert' : 'status'}>{status.message}</p>}

      <fieldset className="stack" disabled={!canEdit || busy}>
        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>{t('dashboard.watermark.enabled')}</span>
          <input type="checkbox" checked={policy.enabled}
            onChange={event => setPolicy(current => ({ ...current, enabled: event.target.checked }))} />
        </label>

        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>{t('dashboard.watermark.position')}</span>
          <select value={policy.position} disabled={!policy.enabled}
            onChange={event => setPolicy(current => ({ ...current, position: event.target.value }))}>
            {WATERMARK_POSITION_ORDER.map(position => (
              <option key={position} value={position}>{t(`dashboard.watermark.position.${position}`)}</option>
            ))}
          </select>
        </label>

        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>{t('dashboard.watermark.opacity')}</span>
          <input type="number" min={WATERMARK_OPACITY_MIN} max={WATERMARK_OPACITY_MAX} step={1}
            value={policy.opacity} disabled={!policy.enabled}
            onChange={event => setPolicy(current => ({ ...current, opacity: Number(event.target.value) }))} />
        </label>

        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>{t('dashboard.watermark.scale')}</span>
          <input type="number" min={WATERMARK_SCALE_MIN} max={WATERMARK_SCALE_MAX} step={1}
            value={policy.scale} disabled={!policy.enabled}
            onChange={event => setPolicy(current => ({ ...current, scale: Number(event.target.value) }))} />
        </label>

        <label className="stack">
          <span>{t('dashboard.watermark.watermarkKey')}</span>
          <input type="text" value={policy.watermarkKey ?? ''}
            placeholder={t('dashboard.watermark.keyHint')} disabled={!policy.enabled}
            onChange={event => setPolicy(current => ({ ...current, watermarkKey: event.target.value || null }))} />
        </label>

        {!policy.enabled && <p className="subtle">{t('dashboard.watermark.disabledNote')}</p>}
        {canEdit && <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? t('dashboard.watermark.saving') : t('dashboard.watermark.save')}
        </button>}
      </fieldset>
    </section>
  );
}
