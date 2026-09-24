'use client';
import { useRef, useState } from 'react';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardJson } from '@/lib/response';
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

export default function RecoverDigestSchedule({ scheduleId }: { scheduleId?: string | null }) {
  const router = useRouter();
  const t = useDigestStrings();
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false), intent = useRef<{ key: string; replacement: string; body: string } | null>(null);
  async function recover() {
    if (active.current || !scheduleId || (!confirmed && !intent.current)) return;
    active.current = true; setBusy(true); setPending(true); setMessage('');
    try {
      const replacement = intent.current?.replacement ?? crypto.randomUUID();
      intent.current ??= { replacement, key: createIdempotencyKey(), body: JSON.stringify({ weeklyDigestRecovery: { expectedScheduleId: scheduleId, replacementScheduleId: replacement } }) };
      const request = intent.current;
      const response = await mutationFetch('/api/v1/org-settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: request.body }, { idempotencyKey: request.key });
      if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
        intent.current = null; setPending(false); setConfirmed(false); setMessage(t('digest.recover.rejected')); return;
      }
      if (!response.ok) throw new Error('Unconfirmed');
      const result = await readDashboardJson<{ data?: { weeklyDigestScheduleId?: string } }>(response);
      if (result.data?.weeklyDigestScheduleId !== request.replacement) throw new Error('Unconfirmed');
      intent.current = null; setPending(false); setConfirmed(false);
      setMessage(t('digest.recover.saved')); router.refresh();
    } catch { setMessage(t('digest.recover.notConfirmed')); }
    finally { active.current = false; setBusy(false); }
  }
  if (!scheduleId && !pending) return null;
  return <section className="card stack" aria-label={t('digest.recover.aria')}>
    <h2>{t('digest.recover.heading')}</h2>
    <p>{t('digest.recover.description')}</p>
    <label className="checkbox-option"><input type="checkbox" checked={confirmed} disabled={busy || pending} onChange={event => setConfirmed(event.target.checked)} /><span>{t('digest.recover.confirm')}</span></label>
    <button type="button" disabled={busy || (!confirmed && !pending)} onClick={() => void recover()}>{busy ? t('digest.recover.saving') : pending ? t('digest.recover.retry') : t('digest.recover.start')}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
