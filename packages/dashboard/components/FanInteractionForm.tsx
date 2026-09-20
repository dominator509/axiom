'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FAN_CRM_CATALOGS, interpolate, type FanCrmMessageKey } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { useLocale } from './LocaleProvider';

type FanCrmT = (key: FanCrmMessageKey, values?: Record<string, string | number>) => string;
const defaultFanCrmT: FanCrmT = (key, values) => interpolate(FAN_CRM_CATALOGS.en[key], values);

export function interactionPayload(fanId: string, data: FormData, t: FanCrmT = defaultFanCrmT) {
  const value = (key: string) => String(data.get(key) ?? '').trim();
  const platform = value('platform'),
    kind = value('kind'),
    direction = value('direction'),
    content = value('content');
  if (!platform || platform.length > 50 || !kind || kind.length > 50)
    throw new Error(t('fans.invalidInteraction'));
  if (!['inbound', 'outbound'].includes(direction)) throw new Error(t('fans.invalidDirection'));
  if (content.length > 4000) throw new Error(t('fans.invalidContent'));
  return { fanId, platform, kind, direction, ...(content ? { content } : {}) };
}

export default function FanInteractionForm({
  fanId,
  platform,
}: {
  fanId: string;
  platform: string;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    setError('');
    setMessage('');
    try {
      if (!intent.current)
        intent.current = {
          body: JSON.stringify(interactionPayload(fanId, new FormData(form), t)),
          key: createIdempotencyKey(),
        };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('fans.invalidInteraction'));
      return;
    }
    active.current = true;
    setBusy(true);
    setPending(true);
    try {
      const response = await mutationFetch(
        `/api/v1/fans/${encodeURIComponent(fanId)}/touchpoints`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: intent.current.body,
        },
        { idempotencyKey: intent.current.key },
      );
      if (!response.ok) {
        if ([400, 401, 403, 404, 422].includes(response.status)) {
          intent.current = null;
          setPending(false);
        }
        setError(t('fans.interactionSaveHttp', { status: response.status }));
        return;
      }
      intent.current = null;
      setPending(false);
      form.reset();
      setMessage(t('fans.interactionSaved'));
      router.refresh();
    } catch {
      setError(t('fans.interactionSaveUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="stack" aria-label={t('fans.record')} onSubmit={submit}>
      <h4>{t('fans.record')}</h4>
      <p className="subtle">{t('fans.interactionDescription')}</p>
      <fieldset
        disabled={busy || pending}
        className="stack"
        style={{ border: 0, padding: 0, minWidth: 0 }}
      >
        <label>
          {t('fans.platform')}
          <input name="platform" defaultValue={platform} required maxLength={50} />
        </label>
        <label>
          {t('fans.interactionType')}
          <input
            name="kind"
            required
            maxLength={50}
            placeholder={t('fans.interactionTypePlaceholder')}
          />
        </label>
        <label>
          {t('fans.direction')}
          <select name="direction" defaultValue="inbound">
            <option value="inbound">{t('fans.fromFan')}</option>
            <option value="outbound">{t('fans.toFan')}</option>
          </select>
        </label>
        <label>
          {t('fans.details')}
          <textarea name="content" maxLength={4000} rows={4} />
        </label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>
        {busy ? t('fans.saving') : pending ? t('fans.retrySame') : t('fans.record')}
      </button>
    </form>
  );
}
