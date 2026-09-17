'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RelayBinding } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const CHANNELS = ['telegram', 'discord', 'signal', 'imessage'] as const;
type Intent = { path: string; method: 'POST' | 'PATCH'; body: string; key: string; id: string; expectedId?: string; enabled: boolean };

export default function RelayBindingManager({ modelId, bindings, canEdit }: { modelId: string; bindings: RelayBinding[]; canEdit: boolean }) {
  const router = useRouter();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('telegram');
  const [chatRef, setChatRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const intent = useRef<Intent | null>(null);

  async function run(next?: Omit<Intent, 'key'>) {
    if (busy) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await mutationFetch(request.path, { method: request.method, headers: { 'content-type': 'application/json' }, body: request.body }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        const details = await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setError(details?.error?.message ?? 'Relay binding change was not accepted.');
        return;
      }
      const result = await readDashboardJson<{ data?: { id?: unknown; modelId?: unknown; enabled?: unknown } }>(response);
      if (result.data?.modelId !== modelId || !result.data.id || (request.expectedId && result.data.id !== request.expectedId) || result.data.enabled !== request.enabled) throw new Error('Unconfirmed relay binding response');
      intent.current = null;
      setMessage(request.enabled ? 'Relay binding enabled.' : 'Relay binding disabled.');
      router.refresh();
    } catch { setError('Relay binding change was not confirmed. Retry the same intent.'); }
    finally { setBusy(false); }
  }

  function add() {
    const ref = chatRef.trim();
    if (!ref || ref.length > 256) { setError('Enter a channel or chat reference of 1–256 characters.'); return; }
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/relay-bindings`, method: 'POST', body: JSON.stringify({ channel, chatRef: ref, enabled: true }), id: `new:${channel}:${ref}`, enabled: true });
  }

  function toggle(binding: RelayBinding) {
    if (!window.confirm(`${binding.enabled ? 'Disable' : 'Enable'} ${binding.channel} relay delivery for this talent?`)) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/relay-bindings/${encodeURIComponent(binding.id)}`, method: 'PATCH', body: JSON.stringify({ enabled: !binding.enabled }), id: binding.id, expectedId: binding.id, enabled: !binding.enabled });
  }

  return <div className="stack">
    <p className="subtle">Approval cards can be delivered to configured Telegram, Discord, Signal, or iMessage destinations. Bot/bridge credentials remain server configuration; this screen stores only the model-scoped destination.</p>
    {bindings.length === 0 ? <p>No relay destinations configured. Cards remain queued for dashboard review.</p> : <table><thead><tr><th>Channel</th><th>Destination</th><th>Status</th>{canEdit && <th>Action</th>}</tr></thead><tbody>{bindings.map(binding => <tr key={binding.id}><td>{binding.channel}</td><td className="mono">{binding.chatRef ?? '—'}</td><td><span className={`badge ${binding.enabled ? 'good' : 'mute'}`}>{binding.enabled ? 'enabled' : 'disabled'}</span></td>{canEdit && <td><button className="btn secondary" type="button" disabled={busy} onClick={() => toggle(binding)}>{binding.enabled ? 'Disable' : 'Enable'}</button></td>}</tr>)}</tbody></table>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Add destination</legend><div className="row"><label>Channel<select value={channel} onChange={event => setChannel(event.target.value as typeof channel)}>{CHANNELS.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Channel/chat reference<input value={chatRef} onChange={event => setChatRef(event.target.value)} maxLength={256} placeholder="channel or chat ID" /></label><button className="btn" type="button" onClick={add}>Add relay destination</button></div></fieldset> : <p className="subtle">Relay configuration requires an owner, manager, or operator role.</p>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>Retry same relay change</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
