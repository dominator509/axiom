'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FAN_CRM_CATALOGS, interpolate, type FanCrmMessageKey } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import type { FanContact } from '@/lib/api';
import { useLocale } from './LocaleProvider';

const statuses = ['pending', 'filming', 'editing', 'delivered'] as const;
type FanCrmT = (key: FanCrmMessageKey, values?: Record<string, string | number>) => string;
const defaultFanCrmT: FanCrmT = (key, values) => interpolate(FAN_CRM_CATALOGS.en[key], values);
const statusKeys: Record<(typeof statuses)[number], FanCrmMessageKey> = {
  pending: 'fans.status.pending',
  filming: 'fans.status.filming',
  editing: 'fans.status.editing',
  delivered: 'fans.status.delivered',
};

export function requestPayload(data: FormData, modelId?: string, t: FanCrmT = defaultFanCrmT) {
  const value = (key: string) => String(data.get(key) ?? '').trim();
  if (!modelId) {
    const status = value('status');
    if (!statuses.includes(status as (typeof statuses)[number]))
      throw new Error(t('fans.requestInvalidStatus'));
    return { status };
  }
  const title = value('title'),
    description = value('description'),
    fanId = value('fanId'),
    price = value('priceUsd');
  if (!title || title.length > 200 || description.length > 4000)
    throw new Error(t('fans.requestInvalidFields'));
  if (price && (!Number.isFinite(Number(price)) || Number(price) < 0))
    throw new Error(t('fans.requestInvalidPrice'));
  return {
    modelId,
    title,
    ...(description ? { description } : {}),
    ...(fanId ? { fanId } : {}),
    ...(price ? { priceUsd: Number(price) } : {}),
  };
}

type Props =
  { modelId: string; fans: FanContact[] } | { requestId: string; status: string; title: string };
export default function CustomRequestForm(props: Props) {
  const create = 'modelId' in props;
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
          body: JSON.stringify(
            requestPayload(new FormData(form), create ? props.modelId : undefined, t),
          ),
          key: createIdempotencyKey(),
        };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('fans.requestInvalidFields'));
      return;
    }
    active.current = true;
    setBusy(true);
    setPending(true);
    try {
      const response = await mutationFetch(
        create
          ? '/api/v1/custom-requests'
          : `/api/v1/custom-requests/${encodeURIComponent(props.requestId)}`,
        {
          method: create ? 'POST' : 'PATCH',
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
        setError(t('fans.requestSaveHttp', { status: response.status }));
        return;
      }
      intent.current = null;
      setPending(false);
      if (create) form.reset();
      setMessage(create ? t('fans.requestCreated') : t('fans.statusSaved'));
      router.refresh();
    } catch {
      setError(t('fans.requestSaveUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="stack"
      onSubmit={submit}
      aria-label={
        create ? t('fans.createRequest') : t('fans.updateStatusFor', { title: props.title })
      }
    >
      <fieldset
        disabled={busy || pending}
        className="stack"
        style={{ border: 0, padding: 0, minWidth: 0 }}
      >
        {create ? (
          <>
            <h3>{t('fans.createRequest')}</h3>
            <label>
              {t('fans.requestTitle')}
              <input name="title" required maxLength={200} />
            </label>
            <label>
              {t('fans.requestDescription')}
              <textarea name="description" maxLength={4000} rows={3} />
            </label>
            <label>
              {t('fans.linkedFanOptional')}
              <select name="fanId" defaultValue="">
                <option value="">{t('fans.noLinkedContact')}</option>
                {props.fans.map((fan) => (
                  <option key={fan.id} value={fan.id}>
                    {fan.displayName ?? fan.id} · {fan.platform}
                  </option>
                ))}
              </select>
            </label>
            <p className="subtle">{t('fans.requestFormDescription')}</p>
            <label>
              {t('fans.requestPriceOptional')}
              <input name="priceUsd" type="number" min="0" step="0.01" />
            </label>
          </>
        ) : (
          <label>
            {t('fans.requestStatus')}
            <select key={props.status} name="status" defaultValue={props.status}>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {t(statusKeys[status])}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>
        {busy
          ? t('fans.saving')
          : pending
            ? t('fans.retrySame')
            : create
              ? t('fans.createRequest')
              : t('fans.statusSaved')}
      </button>
    </form>
  );
}
