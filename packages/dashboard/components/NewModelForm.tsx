'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutationFetch } from '@/lib/mutation';

export default function NewModelForm() {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await mutationFetch('/api/v1/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName, handle, bio: bio || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message ?? 'Could not create this profile. Check the name and handle, then try again.');
        return;
      }
      setOpen(false);
      setDisplayName('');
      setHandle('');
      setBio('');
      router.refresh();
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        className="btn hero-action"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true">＋</span> Add talent
      </button>
    );
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setOpen(false);
      }}
    >
      <form
        onSubmit={onSubmit}
        className="modal-card stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-talent-title"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">New profile</p>
            <h2 id="new-talent-title">Welcome new talent</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div>
          <label htmlFor="displayName">Creator name</label>
          <input
            ref={nameRef}
            id="displayName"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="handle">Handle</label>
          <input
            id="handle"
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="luna.vex"
          />
        </div>
        <div>
          <label htmlFor="bio">
            Brand note <span>(optional)</span>
          </label>
          <textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={2} />
        </div>
        {error && (
          <div className="notice error" role="alert">
            <strong>Could not create profile</strong>
            <span>{error}</span>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
