'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewModelForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/v1/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName, handle, bio: bio || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message ?? 'Create failed');
        return;
      }
      setOpen(false);
      setDisplayName('');
      setHandle('');
      setBio('');
      router.refresh();
    } catch {
      setError('Network error');
    }
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        + New model
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card stack" style={{ minWidth: 300 }}>
      <div>
        <label htmlFor="displayName">Display name</label>
        <input id="displayName" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div>
        <label htmlFor="handle">Handle</label>
        <input id="handle" required value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="lunavex" />
      </div>
      <div>
        <label htmlFor="bio">Bio (optional)</label>
        <textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={2} />
      </div>
      {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      <div className="row">
        <button className="btn" type="submit">
          Create
        </button>
        <button className="btn secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
