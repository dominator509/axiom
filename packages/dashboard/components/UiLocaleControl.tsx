'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupportedLocale } from '@axiom/core';
import type { UiLocaleSnapshot } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

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
  const [snapshot, setSnapshot] = useState(initial);
  const [scope, setScope] = useState<'user' | 'org'>('user');
  const [locale, setLocale] = useState<SupportedLocale>(initial.userLocale ?? initial.locale);
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
        setError(data?.error?.message ?? 'Language preference was not saved.');
        return;
      }
      const result = await readDashboardJson<{ data?: UiLocaleSnapshot }>(response);
      if (!result.data || result.data.locale !== locale || (scope === 'user' && result.data.userLocale !== locale) || (scope === 'org' && result.data.orgLocale !== locale)) {
        throw new Error('unconfirmed locale preference');
      }
      setSnapshot(result.data);
      intent.current = null;
      setPending(false);
      if (typeof document !== 'undefined') document.documentElement.lang = result.data.locale;
      setMessage(`Language saved as ${LOCALE_LABELS[result.data.locale]}.`);
      router.refresh();
    } catch {
      setError('Language preference was not confirmed. Retry without changing the selection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" aria-label="Language settings" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2>Language</h2>
      <p className="subtle">Choose the interface language. Creator content, captions and persona text keep their own content language.</p>
      <fieldset disabled={busy}>
        {snapshot.canSetOrg && (
          <label>
            Applies to
            <select value={scope} onChange={event => { setScope(event.target.value as 'user' | 'org'); intent.current = null; }}>
              <option value="user">My account</option>
              <option value="org">Workspace default</option>
            </select>
          </label>
        )}
        <label>
          Interface language
          <select value={locale} onChange={event => { setLocale(event.target.value as SupportedLocale); intent.current = null; }}>
            {snapshot.supportedLocales.map(option => <option key={option} value={option}>{LOCALE_LABELS[option]}</option>)}
          </select>
        </label>
      </fieldset>
      <p className="subtle">Current resolution: {LOCALE_LABELS[snapshot.locale]} ({snapshot.source}).</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same language' : 'Save language'}</button>
    </form>
  );
}
