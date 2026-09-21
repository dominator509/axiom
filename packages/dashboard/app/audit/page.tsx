import { api } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';
import { formatNumber } from '@axiom/core';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const { t, dateTime, locale } = await getServerLocale();
  let entries: Array<Record<string, unknown>> = [];
  let verification: { rows: number; valid: boolean; brokenAt?: string } | null = null;
  let error: string | null = null;
  try {
    [entries, verification] = await Promise.all([
      api.audit.list().then((r) => r.data),
      api.audit.verify().then((r) => r.data),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('audit.title')}</h1>
        {verification && (
          <span className={`badge ${verification.valid ? 'good' : 'bad'}`}>
            {t(verification.valid ? 'audit.chainValid' : 'audit.chainBroken', {
              count: formatNumber(verification.rows, locale),
              value: verification.brokenAt ?? 'unknown',
            })}
          </span>
        )}
      </div>
      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          {t('audit.loadFailed')}
        </div>
      )}
      {entries.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>{t('audit.noEntries')}</p>
        </div>
      )}
      <div className="card">
        <h2>{t('audit.entries')}</h2>
        <table>
          <thead>
            <tr>
              <th>{t('audit.when')}</th>
              <th>{t('audit.actor')}</th>
              <th>{t('audit.action')}</th>
              <th>{t('audit.target')}</th>
              <th>{t('audit.detail')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={String(e.id)}>
                <td>{dateTime(String(e.ts))}</td>
                <td className="mono">{String(e.actorRef).slice(0, 12)}</td>
                <td>
                  <span className="badge mute">{String(e.action)}</span>
                </td>
                <td className="mono">{String(e.target).slice(0, 16)}</td>
                <td className="mono" style={{ color: 'var(--muted)' }}>
                  {JSON.stringify(e.detail).slice(0, 80)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
