'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithTimeout } from '@/lib/request';
import { readDashboardError } from '@/lib/response';

export default function LoginForm({ allowSignup = false }: { allowSignup?: boolean }) {
  const router = useRouter();
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
        setError(body?.message ?? (signup ? 'Account creation failed' : 'Sign-in failed'));
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Network error — is the API reachable?');
    } finally {
      setPassword('');
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="operator@axiom.local"
        />
      </div>
      <div>
        <label htmlFor="password">Password</label>
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
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Please wait…' : creating ? 'Create AXIOM account' : 'Sign in'}
      </button>
      {allowSignup && <>
        <button className="btn" type="button" disabled={busy} onClick={() => {
          setCreating(!creating); setPassword(''); setError(null);
        }}>{creating ? 'Use existing AXIOM account' : 'First time? Create AXIOM account'}</button>
        {creating && <p>Choose a new AXIOM password, not your Grok password. Account creation does not grant workspace access; your administrator must assign it before you can connect Grok.</p>}
      </>}
    </form>
  );
}
