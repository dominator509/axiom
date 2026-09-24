'use client';
import { useRef, useState } from 'react';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readBoundedResponseJson } from '@axiom/core';
import { useLocale } from './LocaleProvider';

export default function ActivateNetwork({ modelId }: { modelId: string }) {
  const { t } = useLocale();
  const [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useRef<string | null>(null),
    active = useRef(false);
  async function activate() {
    if (!approved || active.current) return;
    active.current = true;
    setBusy(true);
    setMessage(t('networkActivation.applying'));
    key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch(
        '/api/v1/egress/plane/sync',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model_id: modelId }),
        },
        { idempotencyKey: key.current, timeoutMs: 40000, retries: 0 },
      );
      if (!response.ok) {
        if ([400, 401, 403, 404, 422].includes(response.status)) {
          key.current = null;
          setApproved(false);
        }
        setMessage(t('networkActivation.httpFailed', { status: response.status }));
        return;
      }
      const body = (await readBoundedResponseJson(response)) as {
        data?: { status?: unknown; bound?: unknown; skipped?: unknown };
      } | null;
      const result = body?.data;
      if (
        result?.status !== 'synced' ||
        !Number.isSafeInteger(result.bound) ||
        !Number.isSafeInteger(result.skipped) ||
        (result.bound as number) < 0 ||
        (result.skipped as number) < 0
      ) {
        throw new Error(t('networkActivation.unconfirmed'));
      }
      key.current = null;
      setApproved(false);
      setMessage(
        t('networkActivation.completed', {
          bound: result.bound as number,
          skipped: result.skipped as number,
        }),
      );
    } catch {
      setMessage(t('networkActivation.failed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-label={t('networkActivation.title')}>
      <h3>{t('networkActivation.title')}</h3>
      <p>{t('networkActivation.description')}</p>
      <label className="checkbox-option">
        <input
          type="checkbox"
          checked={approved}
          disabled={busy}
          onChange={(event) => setApproved(event.target.checked)}
        />{' '}
        {t('networkActivation.approval')}
      </label>
      <button type="button" disabled={!approved || busy} onClick={() => void activate()}>
        {busy ? t('networkActivation.applying') : t('networkActivation.apply')}
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
