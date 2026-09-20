'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CONSENT_CATALOGS, interpolate, type ConsentMessageKey } from '@axiom/core';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const DOC_KINDS = ['2257', 'model_release', 'id_verify', 'platform_consent'] as const;
type ConsentT = (key: ConsentMessageKey, values?: Record<string, string | number>) => string;
const defaultConsentT: ConsentT = (key, values) => interpolate(CONSENT_CATALOGS.en[key], values);

export function consentPayload(data: FormData, t: ConsentT = defaultConsentT) {
  const value = (name: string) => String(data.get(name) ?? '').trim();
  const platform = value('platform'),
    subjectRef = value('subjectRef'),
    blobRef = value('blobRef'),
    sha256 = value('sha256').toLowerCase();
  const validFrom = value('validFrom'),
    validTo = value('validTo');
  const docKind = value('docKind');
  if (!platform || platform.length > 50) throw new Error(t('consent.invalidPlatform'));
  if (!DOC_KINDS.includes(docKind as (typeof DOC_KINDS)[number]))
    throw new Error(t('consent.invalidKind'));
  if (!subjectRef || subjectRef.length > 200 || !blobRef || blobRef.length > 1000)
    throw new Error(t('consent.invalidReferences'));
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(t('consent.invalidDigest'));
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(validFrom) ||
    (validTo && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) ||
    (validTo && validTo < validFrom)
  )
    throw new Error(t('consent.invalidRange'));
  return {
    platform,
    docKind,
    subjectRef,
    blobRef,
    sha256,
    validFrom,
    ...(validTo ? { validTo } : {}),
  };
}

export default function ConsentRecordForm({ modelId }: { modelId: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const active = useRef(false),
    intent = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    setError('');
    setMessage('');
    try {
      intent.current ??= {
        body: JSON.stringify(consentPayload(new FormData(form), t)),
        key: createIdempotencyKey(),
      };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('consent.checkMetadata'));
      return;
    }
    active.current = true;
    setBusy(true);
    try {
      const request = intent.current;
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/consent-records`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: request.body },
        { idempotencyKey: request.key },
      );
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setError(t('consent.saveHttp', { status: response.status }));
        return;
      }
      const body = await readDashboardJson<{ data?: { modelId?: string } }>(response);
      if (body.data?.modelId && body.data.modelId !== modelId)
        throw new Error('Unexpected consent record identity');
      intent.current = null;
      form.reset();
      setMessage(t('consent.saved'));
      router.refresh();
    } catch {
      setError(t('consent.saveUnconfirmed'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>{t('consent.addMetadata')}</summary>
      <form className="stack" aria-label={t('consent.addMetadata')} onSubmit={submit}>
        <p className="subtle">{t('consent.formDescription')}</p>
        <fieldset className="stack" disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <label>
            {t('consent.platform')}
            <input
              name="platform"
              required
              maxLength={50}
              placeholder={t('consent.platformPlaceholder')}
            />
          </label>
          <label>
            {t('consent.documentKind')}
            <select name="docKind" defaultValue="model_release">
              {DOC_KINDS.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <label>
            {t('consent.subjectReference')}
            <input name="subjectRef" required maxLength={200} />
          </label>
          <label>
            {t('consent.encryptedDocumentReference')}
            <input name="blobRef" required maxLength={1000} />
          </label>
          <label>
            {t('consent.sha256Digest')}
            <input name="sha256" required pattern="[0-9a-fA-F]{64}" maxLength={64} />
          </label>
          <label>
            {t('consent.validFrom')}
            <input name="validFrom" type="date" required />
          </label>
          <label>
            {t('consent.validToOptional')}
            <input name="validTo" type="date" />
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <button type="submit" disabled={busy}>
          {busy ? t('consent.saving') : t('consent.save')}
        </button>
      </form>
    </details>
  );
}
