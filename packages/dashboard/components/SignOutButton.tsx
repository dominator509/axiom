'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { fetchWithTimeout } from '@/lib/request';

export default function SignOutButton() {
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
      setError('Sign-out could not be confirmed. Your session may still be active. Please try again.');
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
        aria-label="Sign out"
      >
      {busy ? '…' : '↗'}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
