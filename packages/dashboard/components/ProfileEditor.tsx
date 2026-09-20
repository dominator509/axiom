'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  interpolate,
  PROFILE_NETWORK_LIFECYCLE_CATALOGS,
  readBoundedResponseJson,
} from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { useLocale } from './LocaleProvider';

type Translate = (key: string, values?: Record<string, string | number>) => string;

const defaultTranslate: Translate = (key, values) =>
  interpolate(PROFILE_NETWORK_LIFECYCLE_CATALOGS.en[key] ?? key, values);

export function profilePayload(form: FormData, translate: Translate = defaultTranslate) {
  const displayName = String(form.get('displayName') ?? '').trim();
  const handle = String(form.get('handle') ?? '').trim();
  const bio = String(form.get('bio') ?? '').trim();
  const avatarUrl = String(form.get('avatarUrl') ?? '').trim();
  if (!displayName || displayName.length > 100)
    throw new Error(translate('profile.validation.creatorName'));
  if (!handle || handle.length > 50) throw new Error(translate('profile.validation.handle'));
  if (bio.length > 500) throw new Error(translate('profile.validation.brandNote'));
  if (avatarUrl) {
    try {
      const parsed = new URL(avatarUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || avatarUrl.length > 2048)
        throw new Error();
    } catch {
      throw new Error(translate('profile.validation.avatarUrl'));
    }
  }
  return { displayName, handle, bio, avatarUrl: avatarUrl || null };
}

export default function ProfileEditor({
  model,
}: {
  model: {
    id: string;
    displayName: string;
    handle: string;
    bio: string | null;
    avatarUrl?: string | null;
  };
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    setError('');
    setMessage('');
    try {
      intent.current ??= {
        body: JSON.stringify(profilePayload(new FormData(event.currentTarget), t)),
        key: createIdempotencyKey(),
      };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('profile.checkFields'));
      return;
    }
    active.current = true;
    setBusy(true);
    setPending(true);
    try {
      const request = intent.current;
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(model.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: request.body,
        },
        { idempotencyKey: request.key },
      );
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          intent.current = null;
          setPending(false);
        }
        setError(details?.error?.message ?? t('profile.saveUnconfirmed'));
        return;
      }
      const result = (await readBoundedResponseJson(response)) as {
        data?: Record<string, unknown>;
      } | null;
      const expected = JSON.parse(request.body) as Record<string, string>;
      if (
        result?.data?.id !== model.id ||
        Object.entries(expected).some(([key, value]) => result.data?.[key] !== value)
      ) {
        throw new Error('Unconfirmed profile response');
      }
      intent.current = null;
      setPending(false);
      setMessage(t('profile.saved'));
      router.refresh();
    } catch {
      setError(t('profile.responseUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>{t('profile.editSummary')}</summary>
      <form className="stack" aria-label={t('profile.aria')} onSubmit={submit}>
        <p className="subtle">{t('profile.description')}</p>
        <fieldset
          className="stack"
          disabled={busy || pending}
          style={{ border: 0, padding: 0, minWidth: 0 }}
        >
          <label>
            {t('profile.creatorName')}
            <input name="displayName" defaultValue={model.displayName} maxLength={100} required />
          </label>
          <label>
            {t('profile.handle')}
            <input name="handle" defaultValue={model.handle} maxLength={50} required />
          </label>
          <label>
            {t('profile.brandNote')}
            <textarea name="bio" defaultValue={model.bio ?? ''} maxLength={500} rows={4} />
          </label>
          <label>
            {t('profile.avatarUrlOptional')}
            <input
              name="avatarUrl"
              type="url"
              defaultValue={model.avatarUrl ?? ''}
              maxLength={2048}
              placeholder={t('profile.avatarPlaceholder')}
            />
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <button type="submit" disabled={busy}>
          {busy ? t('profile.saving') : pending ? t('profile.retry') : t('profile.save')}
        </button>
      </form>
    </details>
  );
}
