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

function hasReactDispatcher(): boolean {
  const internals = (React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H?: unknown };
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals && internals.H);
}

function useInsightStrings() {
  return hasReactDispatcher() ? useLocale().t : englishT;
}

export default function GenerateViralInsightButton({ modelId }: { modelId: string }) {
  const router = useRouter();
  const t = useInsightStrings();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(false);
  const key = useRef<string | null>(null);

  async function generate() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage('');
    key.current ??= createIdempotencyKey();
    try {
      const response = await mutationFetch(
        `/api/v1/models/${encodeURIComponent(modelId)}/viral/insight`,
        { method: 'POST' },
        { idempotencyKey: key.current, retries: 0 },
      );
      if (!response.ok) {
        const data = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) key.current = null;
        setMessage(data?.error?.message ?? t('dashboard.viralInsight.notConfirmed'));
        return;
      }
      const body = await readDashboardJson<{ jobId?: string }>(response);
      if (typeof body.jobId !== 'string' || !body.jobId) throw new Error('missing job id');
      key.current = null;
      setMessage(t('dashboard.viralInsight.queued', { jobId: body.jobId.slice(0, 8) }));
      router.refresh();
    } catch {
      setMessage(t('dashboard.viralInsight.retry'));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ alignItems: 'flex-end' }}>
      <button type="button" className="btn secondary" disabled={busy} onClick={() => void generate()}>
        {busy ? t('dashboard.viralInsight.generating') : t('dashboard.viralInsight.generate')}
      </button>
      {message && <p role="status" className="subtle" style={{ margin: 0 }}>{message}</p>}
    </div>
  );
}
