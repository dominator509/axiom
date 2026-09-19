'use client';

import { useCallback, useEffect, useState } from 'react';
import { mutationFetch } from '@/lib/mutation';

type Resource = 'campaign' | 'members' | 'posts';
type Status = {
  counts: { campaigns: number; members: number; posts: number };
  sync: Array<{ resource: string; nextCursor: string | null; lastSyncedAt: string | null; lastError: string | null }>;
  lastWebhook: { providerEventId: string; eventType: string; receivedAt: string } | null;
  deniedActions: string[];
};

export default function PatreonManager({ connectionId }: { connectionId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [records, setRecords] = useState<Record<Resource, Array<Record<string, unknown>>>>({ campaign: [], members: [], posts: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Resource | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const statusResponse = await fetch(`/api/v1/connectors/patreon/status?connectionId=${encodeURIComponent(connectionId)}`, { credentials: 'include', cache: 'no-store' });
    if (!statusResponse.ok) throw new Error('Patreon status could not be loaded');
    const body = await statusResponse.json() as { data: Status };
    const entries = await Promise.all((['campaign', 'members', 'posts'] as Resource[]).map(async resource => {
      const response = await fetch(`/api/v1/connectors/patreon/data?${new URLSearchParams({ connectionId, resource })}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Patreon data could not be loaded');
      return [resource, ((await response.json()) as { data: Array<Record<string, unknown>> }).data] as const;
    }));
    setStatus(body.data);
    setRecords(Object.fromEntries(entries) as Record<Resource, Array<Record<string, unknown>>>);
  }, [connectionId]);

  useEffect(() => { void load().catch(() => setError('Patreon status could not be loaded.')); }, [load]);

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
      setMessage(`${resource} sync saved ${body.data.count} normalized record${body.data.count === 1 ? '' : 's'}.`);
      await load();
    } catch { setError(`Patreon ${resource} sync failed; no provider data was changed.`); }
    finally { setBusy(null); }
  }

  if (error && !status) return <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>;
  if (!status) return <p role="status">Loading Patreon integration…</p>;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="badge good">Read / sync connected</span>
        <span className="subtle">Provider writes remain unavailable by design.</span>
      </div>
      <div className="grid grid-3">
        <div className="card"><strong>{status.counts.campaigns}</strong><span className="subtle">Campaigns</span></div>
        <div className="card"><strong>{status.counts.members}</strong><span className="subtle">Members</span></div>
        <div className="card"><strong>{status.counts.posts}</strong><span className="subtle">Posts</span></div>
      </div>
      <div className="action-row" aria-label="Patreon sync controls">
        {(['campaign', 'members', 'posts'] as Resource[]).map(resource => (
          <button key={resource} type="button" disabled={busy !== null} onClick={() => void sync(resource)}>
            {busy === resource ? 'Syncing…' : `Sync ${resource}`}
          </button>
        ))}
      </div>
      {status.sync.length > 0 && <div className="stack">
        <h3>Sync health</h3>
        {status.sync.map(item => <div className="row" key={item.resource} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>{item.resource}</span><span className={item.lastError ? 'badge bad' : 'badge good'}>{item.lastError ?? (item.lastSyncedAt ? 'synced' : 'not synced')}</span>
        </div>)}
      </div>}
      <div className="card stack">
        <h3>Webhook health</h3>
        <p className="subtle">{status.lastWebhook ? `Last event: ${status.lastWebhook.eventType} (${status.lastWebhook.providerEventId})` : 'No signed webhook event has been received yet.'}</p>
      </div>
      <div className="stack">
        <h3>Synced community records</h3>
        {(['campaign', 'members', 'posts'] as Resource[]).map(resource => (
          <div className="card" key={resource}>
            <h4>{resource === 'campaign' ? 'Campaigns' : resource === 'members' ? 'Members and tiers' : 'Post history'}</h4>
            {records[resource].length === 0 ? <p className="subtle">No records synced yet.</p> : <div style={{ overflowX: 'auto' }}><table>
              <thead><tr><th>Provider ID</th><th>Summary</th><th>Updated</th></tr></thead>
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
        <h3>Manual-assist boundary</h3>
        <p className="subtle">Patreon publishing, DMs, payouts, member removal and revenue analytics are not automated.</p>
        <div className="mono">{status.deniedActions.join(' · ')}</div>
      </div>
      {message && <p role="status" style={{ color: 'var(--good)' }}>{message}</p>}
      {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
    </div>
  );
}
