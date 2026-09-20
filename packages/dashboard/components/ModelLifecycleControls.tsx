'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

type ModelState = { id: string; displayName: string; isActive: boolean };

export default function ModelLifecycleControls({
  model,
  canEdit,
}: {
  model: ModelState;
  canEdit: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const intent = useRef<{
    method: 'PATCH' | 'DELETE';
    body?: string;
    key: string;
    active: boolean;
  } | null>(null);

  if (!canEdit) return null;

  async function submit(next?: { method: 'PATCH' | 'DELETE'; body?: string; active: boolean }) {
    if (busy) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    setBusy(true);
    setPending(true);
    setError('');
    setMessage('');
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(model.id)}`,
        {
          method: request.method,
          ...(request.body
            ? { headers: { 'content-type': 'application/json' }, body: request.body }
            : {}),
        },
        { idempotencyKey: request.key, retries: 0 },
      );
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          intent.current = null;
          setPending(false);
        }
        setError(details?.error?.message ?? t('lifecycle.statusUnconfirmed'));
        return;
      }
      const result = await readDashboardJson<{ data?: { id?: unknown; isActive?: unknown } }>(
        response,
      );
      if (result.data?.id !== model.id || result.data.isActive !== request.active) {
        throw new Error('Unconfirmed model lifecycle response');
      }
      intent.current = null;
      setPending(false);
      setMessage(request.active ? t('lifecycle.reactivated') : t('lifecycle.deactivated'));
      router.refresh();
    } catch {
      setError(t('lifecycle.responseUnconfirmed'));
    } finally {
      setBusy(false);
    }
  }

  function deactivate() {
    if (!window.confirm(t('lifecycle.confirmDeactivate', { name: model.displayName }))) return;
    return submit({ method: 'DELETE', active: false });
  }

  function reactivate() {
    return submit({ method: 'PATCH', body: JSON.stringify({ isActive: true }), active: true });
  }

  return (
    <details>
      <summary>{t('lifecycle.summary')}</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <p className="subtle">{t('lifecycle.description')}</p>
        {model.isActive ? (
          <button
            type="button"
            className="btn danger"
            disabled={busy || pending}
            onClick={deactivate}
          >
            {busy
              ? t('lifecycle.deactivating')
              : pending
                ? t('lifecycle.retry')
                : t('lifecycle.deactivate')}
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy || pending} onClick={reactivate}>
            {busy
              ? t('lifecycle.reactivating')
              : pending
                ? t('lifecycle.retry')
                : t('lifecycle.reactivate')}
          </button>
        )}
        {pending && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {t('lifecycle.retry')}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
