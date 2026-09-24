'use client';
import { useRef, useState } from 'react';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { CATALOGS, LocaleCatalog } from '@axiom/core';
import { useLocale } from './LocaleProvider';

const fallbackCatalog = new LocaleCatalog(CATALOGS);
const englishT = (key: string, values?: Record<string, string | number>) => fallbackCatalog.t('en', key, values);

/**
 * Unit tests invoke this component directly (without a React renderer). React
 * has no dispatcher in that case, so calling a hook would warn and throw.
 * Detect an active renderer and only bind the provider locale inside one.
 */
function hasReactDispatcher(): boolean {
  const internals = (React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H?: unknown };
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals && internals.H);
}

function useDigestStrings() {
  return hasReactDispatcher() ? useLocale().t : englishT;
}

export default function GenerateDigestButton() {
  const router = useRouter();
  const t = useDigestStrings();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), key = useRef<string | null>(null);
  async function generate() {
    if (active.current) return; active.current = true; setBusy(true); setMessage(''); key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch('/api/v1/digests/generate', { method: 'POST' }, { idempotencyKey: key.current, retries: 0 });
      if (!response.ok) { const d = await readDashboardError(response); if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null; setMessage(d?.error?.message ?? t('digest.generate.notConfirmed', { status: response.status })); return; }
      const body = await readDashboardJson<{ jobId?: string }>(response);
      if (typeof body.jobId !== 'string' || !body.jobId) throw new Error(t('digest.generate.unconfirmed'));
      key.current = null; setMessage(t('digest.generate.queued', { jobId: body.jobId.slice(0, 8) })); router.refresh();
    } catch { setMessage(t('digest.generate.unconfirmedRetry')); }
    finally { active.current = false; setBusy(false); }
  }
  return <div className="stack"><button type="button" disabled={busy} onClick={() => void generate()}>{busy ? t('digest.generate.busy') : t('digest.generate.cta')}</button>{message && <p role="status">{message}</p>}</div>;
}
