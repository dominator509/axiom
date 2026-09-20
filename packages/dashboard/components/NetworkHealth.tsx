'use client';
import { useRef, useState } from 'react';
import { NETWORK_CHILD_CONTROLS_CATALOGS } from '@axiom/core';
import { fetchWithTimeout } from '@/lib/request';
import { readBoundedResponseJson } from '@axiom/core';
import { useLocale } from './LocaleProvider';

type Translator = (key: string, values?: Record<string, string | number>) => string;

function englishText(key: string, values?: Record<string, string | number>): string {
  const template = NETWORK_CHILD_CONTROLS_CATALOGS.en[key] ?? key;
  return Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function describeNetworkHealth(
  body: unknown,
  modelId: string,
  t: Translator = englishText,
): string {
  const data = (
    body as {
      data?: {
        modelId?: unknown;
        live?: {
          model_id?: unknown;
          mode?: unknown;
          healthy?: unknown;
          egress_ip?: unknown;
        } | null;
      };
    } | null
  )?.data;
  if (!data || data.modelId !== modelId) throw new Error(t('networkHealth.unexpectedResponse'));
  const live = data.live;
  if (!live) return t('networkHealth.noLive');
  if (live.model_id !== modelId) throw new Error(t('networkHealth.unexpectedConnection'));
  if (live.mode === 'direct') return t('networkHealth.direct');
  if (live.healthy !== true) return t('networkHealth.unhealthy');
  if (typeof live.egress_ip !== 'string' || !live.egress_ip) return t('networkHealth.missingIp');
  return t('networkHealth.healthy', { ip: live.egress_ip });
}

export default function NetworkHealth({ modelId }: { modelId: string }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(() => t('networkHealth.initial'));
  const active = useRef(false);
  async function check() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage(t('networkHealth.checking'));
    try {
      const response = await fetchWithTimeout(
        `/api/v1/models/${encodeURIComponent(modelId)}/network/health`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Status unavailable');
      setMessage(describeNetworkHealth(await readBoundedResponseJson(response), modelId, t));
    } catch {
      setMessage(t('networkHealth.failure'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-label={t('networkHealth.title')}>
      <h3>{t('networkHealth.title')}</h3>
      <p role="status">{message}</p>
      <p className="subtle">{t('networkHealth.description')}</p>
      <button type="button" disabled={busy} onClick={() => void check()}>
        {busy ? t('networkHealth.checking') : t('networkHealth.check')}
      </button>
    </section>
  );
}
