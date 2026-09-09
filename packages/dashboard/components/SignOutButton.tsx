'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fetchWithTimeout } from '@/lib/request';

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetchWithTimeout(
        '/api/auth/sign-out',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
        10_000,
      );
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <button
      className="signout-button"
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      aria-label="Sign out"
    >
      {busy ? '…' : '↗'}
    </button>
  );
}
