'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError } from '@/lib/response';
import { useLocale } from './LocaleProvider';

export default function NewModelForm() {
  const { t } = useLocale();
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
        setError(body?.error?.message ?? t('dashboard.newModel.createFailed'));
        return;
      }
      intent.current = null;
      setOpen(false);
      setDisplayName('');
      setHandle('');
      setBio('');
      router.refresh();
    } catch {
      setError(t('dashboard.newModel.creationUnconfirmed'));
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
        <span aria-hidden="true">＋</span> {t('dashboard.newModel.addTalent')}
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
            <p className="eyebrow">{t('dashboard.newModel.newProfile')}</p>
            <h2 id="new-talent-title">{t('dashboard.newModel.welcomeTalent')}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            disabled={busy}
            onClick={() => { if (!inFlight.current) setOpen(false); }}
            aria-label={t('dashboard.newModel.close')}
          >
            ×
          </button>
        </div>
        <div>
          <label htmlFor="displayName">{t('dashboard.newModel.creatorName')}</label>
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
          <label htmlFor="handle">{t('dashboard.newModel.handle')}</label>
          <input
            id="handle"
            required
            disabled={busy}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={t('dashboard.newModel.handlePlaceholder')}
          />
        </div>
        <div>
          <label htmlFor="bio">
            {t('dashboard.newModel.brandNote')} <span>({t('dashboard.newModel.optional')})</span>
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
            {busy ? t('dashboard.newModel.creatingProfile') : t('dashboard.newModel.createProfile')}
          </button>
          <button className="btn secondary" type="button" disabled={busy} onClick={() => { if (!inFlight.current) setOpen(false); }}>
            {t('action.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
