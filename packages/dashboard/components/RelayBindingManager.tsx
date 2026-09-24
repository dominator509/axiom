'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RelayBinding } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const CHANNELS = ['telegram', 'discord', 'signal', 'imessage'] as const;
type Intent = { path: string; method: 'POST' | 'PATCH'; body: string; key: string; id: string; expectedId?: string; enabled: boolean };
type Translator = (key: string, values?: Record<string, string | number>) => string;

export default function RelayBindingManager({ modelId, bindings, canEdit, t }: { modelId: string; bindings: RelayBinding[]; canEdit: boolean; t: Translator }) {
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
        await readDashboardError(response);
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null;
        setError(t('relay.binding.changeRejected'));
        return;
      }
      const result = await readDashboardJson<{ data?: { id?: unknown; modelId?: unknown; enabled?: unknown } }>(response);
      if (result.data?.modelId !== modelId || !result.data.id || (request.expectedId && result.data.id !== request.expectedId) || result.data.enabled !== request.enabled) throw new Error('Unconfirmed relay binding response');
      intent.current = null;
      setMessage(t(request.enabled ? 'relay.binding.enabledSuccess' : 'relay.binding.disabledSuccess'));
      router.refresh();
    } catch { setError(t('relay.binding.unconfirmed')); }
    finally { setBusy(false); }
  }

  function add() {
    const ref = chatRef.trim();
    if (!ref || ref.length > 256) { setError(t('relay.binding.validation')); return; }
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/relay-bindings`, method: 'POST', body: JSON.stringify({ channel, chatRef: ref, enabled: true }), id: `new:${channel}:${ref}`, enabled: true });
  }

  function toggle(binding: RelayBinding) {
    const confirmationKey = binding.enabled ? 'relay.binding.confirmDisable' : 'relay.binding.confirmEnable';
    if (!window.confirm(t(confirmationKey, { channel: binding.channel }))) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/relay-bindings/${encodeURIComponent(binding.id)}`, method: 'PATCH', body: JSON.stringify({ enabled: !binding.enabled }), id: binding.id, expectedId: binding.id, enabled: !binding.enabled });
  }

  return <div className="stack">
    <p className="subtle">{t('relay.binding.description')}</p>
    {bindings.length === 0 ? <p>{t('relay.binding.empty')}</p> : <table><thead><tr><th>{t('relay.binding.channel')}</th><th>{t('relay.binding.destination')}</th><th>{t('relay.binding.status')}</th>{canEdit && <th>{t('relay.binding.action')}</th>}</tr></thead><tbody>{bindings.map(binding => <tr key={binding.id}><td>{binding.channel}</td><td className="mono">{binding.chatRef ?? '—'}</td><td><span className={`badge ${binding.enabled ? 'good' : 'mute'}`}>{binding.enabled ? t('relay.binding.enabled') : t('relay.binding.disabled')}</span></td>{canEdit && <td><button className="btn secondary" type="button" disabled={busy} onClick={() => toggle(binding)}>{binding.enabled ? t('relay.binding.disable') : t('relay.binding.enable')}</button></td>}</tr>)}</tbody></table>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{t('relay.binding.formLegend')}</legend><div className="row"><label>{t('relay.binding.channel')}<select aria-label={t('relay.binding.channel')} value={channel} onChange={event => setChannel(event.target.value as typeof channel)}>{CHANNELS.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>{t('relay.binding.channelReference')}<input aria-label={t('relay.binding.channelReference')} value={chatRef} onChange={event => setChatRef(event.target.value)} maxLength={256} placeholder={t('relay.binding.channelReferencePlaceholder')} /></label><button className="btn" type="button" onClick={add}>{t('relay.binding.add')}</button></div></fieldset> : <p className="subtle">{t('relay.binding.roleRequired')}</p>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>{t('relay.binding.retry')}</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
