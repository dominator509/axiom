'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { fetchWithTimeout } from '@/lib/request';
import { useLocale } from './LocaleProvider';

export default function SignOutButton({ label }: { label?: string } = {}) {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetchWithTimeout(
        '/api/auth/sign-out',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
        10_000,
      );
      if (!response.ok) throw new Error('Sign-out request failed');
      router.replace('/login');
      router.refresh();
    } catch {
      setError(t('dashboard.signOutFailed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="signout-button"
        type="button"
        onClick={signOut}
        disabled={busy}
        aria-label={label ?? t('action.signOut')}
      >
      {busy ? '…' : '↗'}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
