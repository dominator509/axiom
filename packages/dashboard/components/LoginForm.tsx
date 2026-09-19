'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithTimeout } from '@/lib/request';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function LoginForm({ allowSignup = false }: { allowSignup?: boolean }) {
  const router = useRouter();
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const active = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      const signup = allowSignup && creating;
      const res = await fetchWithTimeout(signup ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        redirect: 'error',
        body: JSON.stringify(signup ? { email, password, name: 'Grok account operator' } : { email, password }),
      });
      if (!res.ok) {
        const body = await readDashboardError(res);
        setError(body?.message ?? (signup ? t('auth.accountCreationFailed') : t('auth.signInFailed')));
        return;
      }
      // A successful POST does not prove the browser retained the session cookie.
      // Confirm it without repeating sign-in or account creation.
      try {
        const accepted = await readDashboardJson<{ user?: { id?: unknown } } | null>(res);
        if (typeof accepted?.user?.id !== 'string' || !accepted.user.id.trim()) {
          throw new Error('Missing signed-in identity');
        }
        const confirmation = await fetchWithTimeout('/api/auth/get-session', {
          credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        });
        if (!confirmation.ok) throw new Error('Session confirmation failed');
        const session = await readDashboardJson<{ user?: { id?: unknown } } | null>(confirmation);
        if (session?.user?.id !== accepted.user.id) {
          throw new Error('No usable session');
        }
      } catch {
        const action = signup ? t('auth.accountCreationAccepted') : t('auth.signInAccepted');
        const advice = signup ? t('auth.sessionSignupAdvice') : t('auth.sessionSigninAdvice');
        setError(t('auth.sessionNotConfirmed', { action, advice }));
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError(t('auth.networkError'));
    } finally {
      setPassword('');
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <div>
        <label htmlFor="email">{t('auth.email')}</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.emailPlaceholder')}
        />
      </div>
      <div>
        <label htmlFor="password">{t('auth.password')}</label>
        <input
          id="password"
          type="password"
          autoComplete={creating ? 'new-password' : 'current-password'}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>
      {error && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? t('auth.wait') : creating ? t('auth.createAccount') : t('auth.signIn')}
      </button>
      {allowSignup && <>
        <button className="btn" type="button" disabled={busy} onClick={() => {
          setCreating(!creating); setPassword(''); setError(null);
        }}>{creating ? t('auth.useExisting') : t('auth.firstTime')}</button>
        {creating && <p>{t('auth.passwordHint')}</p>}
      </>}
    </form>
  );
}
