'use client';

import { useCallback, useEffect, useState } from 'react';
import { mutationFetch } from '@/lib/mutation';
import { useLocale } from './LocaleProvider';

type Resource = 'campaign' | 'members' | 'posts';
type Status = {
  counts: { campaigns: number; members: number; posts: number };
  sync: Array<{ resource: string; nextCursor: string | null; lastSyncedAt: string | null; lastError: string | null }>;
  lastWebhook: { providerEventId: string; eventType: string; receivedAt: string } | null;
  deniedActions: string[];
};

function resourceLabel(resource: string, t: (key: string) => string): string {
  if (resource === 'campaign') return t('patreon.campaigns');
  if (resource === 'members') return t('patreon.members');
  if (resource === 'posts') return t('patreon.posts');
  return resource;
}

export default function PatreonManager({ connectionId }: { connectionId: string }) {
  const { t } = useLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [records, setRecords] = useState<Record<Resource, Array<Record<string, unknown>>>>({ campaign: [], members: [], posts: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Resource | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const statusResponse = await fetch(`/api/v1/connectors/patreon/status?connectionId=${encodeURIComponent(connectionId)}`, { credentials: 'include', cache: 'no-store' });
    if (!statusResponse.ok) throw new Error('status');
    const body = await statusResponse.json() as { data: Status };
    const entries = await Promise.all((['campaign', 'members', 'posts'] as Resource[]).map(async resource => {
      const response = await fetch(`/api/v1/connectors/patreon/data?${new URLSearchParams({ connectionId, resource })}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('data');
      return [resource, ((await response.json()) as { data: Array<Record<string, unknown>> }).data] as const;
    }));
    setStatus(body.data);
    setRecords(Object.fromEntries(entries) as Record<Resource, Array<Record<string, unknown>>>);
  }, [connectionId]);

  useEffect(() => {
    void load().catch((cause: unknown) => setError(cause instanceof Error && cause.message === 'data' ? t('patreon.dataLoadFailed') : t('patreon.statusLoadFailed')));
  }, [load, t]);

  async function sync(resource: Resource) {
    setBusy(resource); setError(null); setMessage(null);
    try {
      const response = await mutationFetch(`/api/v1/connectors/patreon/sync?connectionId=${encodeURIComponent(connectionId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resource }),
      });
      if (!response.ok) throw new Error('sync failed');
      const body = await response.json() as { data: { count: number; nextCursor: string | null } };
      setMessage(t('patreon.syncSaved', { resource: resourceLabel(resource, t), count: body.data.count }));
      await load();
    } catch { setError(t('patreon.syncFailed', { resource: resourceLabel(resource, t) })); }
    finally { setBusy(null); }
  }

  if (error && !status) return <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>;
  if (!status) return <p role="status">{t('patreon.loading')}</p>;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="badge good">{t('patreon.readSyncConnected')}</span>
        <span className="subtle">{t('patreon.providerWritesUnavailable')}</span>
      </div>
      <div className="grid grid-3">
        <div className="card"><strong>{status.counts.campaigns}</strong><span className="subtle">{t('patreon.campaigns')}</span></div>
        <div className="card"><strong>{status.counts.members}</strong><span className="subtle">{t('patreon.members')}</span></div>
        <div className="card"><strong>{status.counts.posts}</strong><span className="subtle">{t('patreon.posts')}</span></div>
      </div>
      <div className="action-row" aria-label={t('patreon.syncControls')}>
        {(['campaign', 'members', 'posts'] as Resource[]).map(resource => (
          <button key={resource} type="button" disabled={busy !== null} onClick={() => void sync(resource)}>
            {busy === resource ? t('patreon.syncing', { resource: resourceLabel(resource, t) }) : t('patreon.sync', { resource: resourceLabel(resource, t) })}
          </button>
        ))}
      </div>
      {status.sync.length > 0 && <div className="stack">
        <h3>{t('patreon.syncHealth')}</h3>
        {status.sync.map(item => <div className="row" key={item.resource} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>{resourceLabel(item.resource, t)}</span><span className={item.lastError ? 'badge bad' : 'badge good'}>{item.lastError ? t('patreon.syncError') : item.lastSyncedAt ? t('patreon.synced') : t('patreon.notSynced')}</span>
        </div>)}
      </div>}
      <div className="card stack">
        <h3>{t('patreon.webhookHealth')}</h3>
        <p className="subtle">{status.lastWebhook ? t('patreon.lastWebhook', status.lastWebhook) : t('patreon.noWebhook')}</p>
      </div>
      <div className="stack">
        <h3>{t('patreon.records')}</h3>
        {(['campaign', 'members', 'posts'] as Resource[]).map(resource => (
          <div className="card" key={resource}>
            <h4>{resource === 'campaign' ? t('patreon.campaigns') : resource === 'members' ? t('patreon.membersAndTiers') : t('patreon.postHistory')}</h4>
            {records[resource].length === 0 ? <p className="subtle">{t('patreon.noRecords')}</p> : <div style={{ overflowX: 'auto' }}><table>
              <thead><tr><th>{t('patreon.providerId')}</th><th>{t('patreon.summary')}</th><th>{t('patreon.updated')}</th></tr></thead>
              <tbody>{records[resource].slice(0, 25).map(row => {
                const id = String(row.providerCampaignId ?? row.providerMemberId ?? row.providerPostId ?? '—');
                const summary = String(row.name ?? row.tierTitle ?? row.title ?? row.status ?? '—');
                const updated = String(row.syncedAt ?? '—');
                return <tr key={id}><td className="mono">{id}</td><td>{summary}</td><td>{updated}</td></tr>;
              })}</tbody>
            </table></div>}
          </div>
        ))}
      </div>
      <div className="card stack">
        <h3>{t('patreon.manualAssistBoundary')}</h3>
        <p className="subtle">{t('patreon.deniedActions')}</p>
        <div className="mono">{status.deniedActions.join(' · ')}</div>
      </div>
      {message && <p role="status" style={{ color: 'var(--good)' }}>{message}</p>}
      {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
    </div>
  );
}
