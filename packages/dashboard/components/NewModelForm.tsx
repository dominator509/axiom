'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';

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
  const inFlight = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const requestBody = JSON.stringify({ displayName, handle, bio: bio || undefined });
      if (intent.current?.body !== requestBody) {
        intent.current = { body: requestBody, key: createIdempotencyKey() };
      }
      const res = await mutationFetch('/api/v1/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: requestBody,
      }, { idempotencyKey: intent.current.key });
      if (!res.ok) {
        const body = await readDashboardError(res);
        setError(body?.error?.message ?? 'Create failed');
        return;
      }
      intent.current = null;
      setOpen(false);
      setDisplayName('');
      setHandle('');
      setBio('');
      router.refresh();
    } catch {
      setError('Creation could not be confirmed. Retry without changing the form to safely check the same request.');
    } finally {
      inFlight.current = false;
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
        if (event.currentTarget === event.target && !inFlight.current) setOpen(false);
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
            disabled={busy}
            onClick={() => { if (!inFlight.current) setOpen(false); }}
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
            disabled={busy}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="handle">Handle</label>
          <input
            id="handle"
            required
            disabled={busy}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="luna.vex"
          />
        </div>
        <div>
          <label htmlFor="bio">
            Brand note <span>(optional)</span>
          </label>
          <textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={2} disabled={busy} />
        </div>
        {error && (
          <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Creating profile...' : 'Create profile'}
          </button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => { if (!inFlight.current) setOpen(false); }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
