'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupportedLocale } from '@axiom/core';
import type { UiLocaleSnapshot } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  ja: '日本語',
  it: 'Italiano',
  'pt-BR': 'Português (Brasil)',
  de: 'Deutsch',
};

export default function UiLocaleControl({ initial }: { initial: UiLocaleSnapshot }) {
  const router = useRouter();
  const { t, setLocale } = useLocale();
  const [snapshot, setSnapshot] = useState(initial);
  const [scope, setScope] = useState<'user' | 'org'>('user');
  const [locale, setSelectedLocale] = useState<SupportedLocale>(initial.userLocale ?? initial.locale);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const intent = useRef<{ body: string; key: string } | null>(null);

  async function save() {
    if (busy) return;
    setError('');
    setMessage('');
    const body = JSON.stringify({ scope, locale });
    intent.current ??= { body, key: createIdempotencyKey() };
    setBusy(true);
    setPending(true);
    try {
      const request = intent.current;
      const response = await mutationFetch('/api/v1/ui-locale', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: request.body,
      }, { idempotencyKey: request.key });
      if (!response.ok) {
        const data = await readDashboardError(response);
        if ([400, 401, 403, 409, 422].includes(response.status)) {
          intent.current = null;
          setPending(false);
        }
        setError(data?.error?.message ?? t('error.network'));
        return;
      }
      const result = await readDashboardJson<{ data?: UiLocaleSnapshot }>(response);
      if (!result.data || result.data.locale !== locale || (scope === 'user' && result.data.userLocale !== locale) || (scope === 'org' && result.data.orgLocale !== locale)) {
        throw new Error('unconfirmed locale preference');
      }
      setSnapshot(result.data);
      intent.current = null;
      setPending(false);
      setLocale(result.data.locale);
      setMessage(t('settings.savedAs', { locale: LOCALE_LABELS[result.data.locale] }));
      router.refresh();
    } catch {
      setError(t('settings.retrySameLanguage'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" aria-label={t('settings.language')} onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2>{t('settings.language')}</h2>
      <p className="subtle">{t('settings.language.description')}</p>
      <fieldset disabled={busy}>
        {snapshot.canSetOrg && (
          <label>
            {t('settings.appliesTo')}
            <select value={scope} onChange={event => { setScope(event.target.value as 'user' | 'org'); intent.current = null; }}>
              <option value="user">{t('settings.myAccount')}</option>
              <option value="org">{t('settings.workspaceDefault')}</option>
            </select>
          </label>
        )}
        <label>
          {t('settings.interfaceLanguage')}
          <select value={locale} onChange={event => { setSelectedLocale(event.target.value as SupportedLocale); intent.current = null; }}>
            {snapshot.supportedLocales.map(option => <option key={option} value={option}>{LOCALE_LABELS[option]}</option>)}
          </select>
        </label>
      </fieldset>
      <p className="subtle">{t('settings.currentResolution', { locale: LOCALE_LABELS[snapshot.locale], source: snapshot.source })}</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? t('settings.saving') : pending ? t('settings.retrySameLanguage') : t('settings.saveLanguage')}</button>
    </form>
  );
}
