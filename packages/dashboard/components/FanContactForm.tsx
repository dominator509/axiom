'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FAN_CRM_CATALOGS, interpolate, type FanCrmMessageKey } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { useLocale } from './LocaleProvider';

type FanCrmT = (key: FanCrmMessageKey, values?: Record<string, string | number>) => string;
const defaultFanCrmT: FanCrmT = (key, values) => interpolate(FAN_CRM_CATALOGS.en[key], values);

export function contactPayload(modelId: string, data: FormData, t: FanCrmT = defaultFanCrmT) {
  const value = (key: string) => String(data.get(key) ?? '').trim();
  const platform = value('platform');
  const externalId = value('externalId');
  const displayName = value('displayName');
  const tier = value('tier');
  const amount = value('lifetimeValueUsd');
  if (
    !platform ||
    platform.length > 50 ||
    !externalId ||
    externalId.length > 200 ||
    displayName.length > 200
  )
    throw new Error(t('fans.invalidContact'));
  if (tier && !['new', 'loyal', 'whale', 'expired'].includes(tier))
    throw new Error(t('fans.invalidTier'));
  if (amount && (!Number.isFinite(Number(amount)) || Number(amount) < 0))
    throw new Error(t('fans.invalidLifetime'));
  return {
    modelId,
    platform,
    externalId,
    ...(displayName ? { displayName } : {}),
    ...(tier ? { tier } : {}),
    ...(amount ? { lifetimeValueUsd: Number(amount) } : {}),
  };
}

export default function FanContactForm({ modelId }: { modelId: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
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
          body: JSON.stringify(contactPayload(modelId, new FormData(form), t)),
          key: createIdempotencyKey(),
        };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('fans.invalidContact'));
      return;
    }
    active.current = true;
    setBusy(true);
    setPending(true);
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/fans`,
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
        setError(t('fans.saveContactHttp', { status: response.status }));
        return;
      }
      intent.current = null;
      setPending(false);
      form.reset();
      setMessage(t('fans.contactSaved'));
      router.refresh();
    } catch {
      setError(t('fans.saveContactUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card stack" aria-label={t('fans.saveContactAria')}>
      <h3>{t('fans.add')}</h3>
      <p className="subtle">{t('fans.contactDescription')}</p>
      <fieldset
        disabled={busy || pending}
        className="stack"
        style={{ border: 0, padding: 0, minWidth: 0 }}
      >
        <label>
          {t('fans.platform')}
          <input name="platform" required maxLength={50} placeholder="fanvue" />
        </label>
        <label>
          {t('fans.fanAccountId')}
          <input name="externalId" required maxLength={200} />
        </label>
        <label>
          {t('fans.displayName')}
          <input name="displayName" maxLength={200} />
        </label>
        <label>
          {t('fans.tier')}
          <select name="tier" defaultValue="">
            <option value="">{t('fans.tierKeep')}</option>
            <option value="new">{t('fans.tierNew')}</option>
            <option value="loyal">{t('fans.tierLoyal')}</option>
            <option value="whale">{t('fans.tierWhale')}</option>
            <option value="expired">{t('fans.tierExpired')}</option>
          </select>
        </label>
        <label>
          {t('fans.lifetime')}
          <input name="lifetimeValueUsd" type="number" min="0" step="0.01" />
        </label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>
        {busy ? t('fans.saving') : pending ? t('fans.retrySame') : t('fans.save')}
      </button>
    </form>
  );
}
