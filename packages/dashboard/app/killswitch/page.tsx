import { api, getSession } from '@/lib/api';
import Link from 'next/link';
import KillSwitchControl from '@/components/KillSwitchControl';
import { CATALOGS, LocaleCatalog, formatDate, normalizeLocale } from '@axiom/core';

export const dynamic = 'force-dynamic';

export default async function KillSwitchPage() {
  const session = await getSession();
  let uiLocale = 'en';
  try { uiLocale = (await api.uiLocale.get()).data.locale; } catch { /* keep the safe fallback */ }
  const locale = normalizeLocale(uiLocale) ?? 'en';
  const catalog = new LocaleCatalog(CATALOGS);
  const t = (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values);
  if (session?.user?.role !== 'owner') return (
    <div className="page-stack">
      <h1>{t('safety.title')}</h1>
      <div className="card stack">
        <p>{t('safety.ownerOnly')}</p>
        <p>{t('safety.ownerOnlyDescription')}</p>
        <Link href="/" className="btn secondary">{t('safety.back')}</Link>
      </div>
    </div>
  );
  let state: Awaited<ReturnType<typeof api.killswitch.get>>['data'] | null = null;
  let error: string | null = null;
  try {
    const response = await api.killswitch.get();
    if (typeof response?.data?.enabled !== 'boolean') throw new Error('Invalid safety status');
    state = response.data;
  } catch {
    error = t('safety.statusUnknown');
  }

  return (
    <div className="page-stack" style={{ maxWidth: 720 }}>
      <h1>{t('safety.title')}</h1>
      {error && (
        <div className="card stack" role="alert">
          <p>{error}</p>
          <a href="/killswitch" className="btn secondary">{t('safety.reload')}</a>
        </div>
      )}
      {state && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>{t('safety.publishing')}</h2>
            {state.enabled ? (
              <span className="badge bad">{t('safety.halted')}</span>
            ) : (
              <span className="badge good">{t('safety.notHalted')}</span>
            )}
          </div>
          {state.enabled && (
            <p style={{ color: 'var(--bad)' }}>
              {t('safety.reason')} {state.reason || t('safety.noReason')} — {t('safety.started')}{' '}
              {state.startedAt ? formatDate(new Date(state.startedAt), locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) : '?'}
            </p>
          )}
          <p style={{ color: 'var(--muted)' }}>
            {t('safety.description')}
          </p>
          <KillSwitchControl enabled={state.enabled} />
        </div>
      )}
    </div>
  );
}
