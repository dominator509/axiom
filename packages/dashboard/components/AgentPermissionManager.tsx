'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgentPermission } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const TIERS = ['viewer', 'operator', 'manager', 'autonomous'] as const;
type Intent = { path: string; method: 'POST'; body: string; key: string };

export default function AgentPermissionManager({ modelId, permissions, canEdit }: { modelId: string; permissions: AgentPermission[]; canEdit: boolean }) {
  const router = useRouter();
  const [agentRef, setAgentRef] = useState('');
  const [tier, setTier] = useState<(typeof TIERS)[number]>('viewer');
  const [canPublish, setCanPublish] = useState(false);
  const [canEditAgent, setCanEditAgent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const intent = useRef<Intent | null>(null);

  async function run(next?: Omit<Intent, 'key'>, onSuccess?: (data: unknown) => void) {
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
        setError(details?.error?.message ?? 'Agent permission change was not accepted.');
        return;
      }
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (!result.data || typeof result.data !== 'object') throw new Error('Unconfirmed agent permission response');
      onSuccess?.(result.data);
      intent.current = null;
      router.refresh();
    } catch { setError('Agent permission change was not confirmed. Retry the same intent.'); }
    finally { setBusy(false); }
  }

  function saveGrant() {
    const ref = agentRef.trim();
    if (!ref || ref.length > 128) { setError('Enter an agent reference of 1–128 characters.'); return; }
    if (tier === 'autonomous' && !window.confirm('Granting Autonomous exposes the highest MCP tier for this model. Continue?')) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/agent-permissions`, method: 'POST', body: JSON.stringify({ agentRef: ref, tier, canPublish, canEdit: canEditAgent }) }, () => {
      setAgentRef(''); setMessage('Agent permission saved. Existing tokens do not change tier until reissued.');
    });
  }

  function issueToken(permission: AgentPermission) {
    if (!window.confirm(`Issue a 15-minute ${permission.tier} token for ${permission.agentRef}?`)) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/agent-permissions/${encodeURIComponent(permission.id)}/tokens`, method: 'POST', body: JSON.stringify({ ttlSeconds: 900 }) }, (data) => {
      const issued = data as { token?: unknown };
      if (typeof issued.token !== 'string' || issued.token.length < 20) throw new Error('Token was not returned for one-time display');
      setIssuedToken(issued.token);
      setMessage(`Token issued for ${permission.agentRef}. Copy it now; it will not be shown again.`);
    });
  }

  function revokeToken(permission: AgentPermission, tokenId: string) {
    if (!window.confirm(`Revoke this token for ${permission.agentRef}?`)) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/agent-permissions/${encodeURIComponent(permission.id)}/tokens/${encodeURIComponent(tokenId)}/revoke`, method: 'POST', body: '{}' }, () => {
      setMessage('Agent token revoked.');
    });
  }

  return <div className="stack">
    <p className="subtle">Capability grants are model-scoped and owner-controlled. Tokens expire after 15 minutes, are stored only as non-secret metadata, and are rejected when the grant is deleted or changed.</p>
    {permissions.length === 0 ? <p>No agent grants exist for this model.</p> : <div className="stack">{permissions.map(permission => <article className="card stack" key={permission.id}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}><div><h3>{permission.agentRef}</h3><p className="subtle">{permission.tier} · {permission.canPublish ? 'publishing scope enabled' : 'publishing scope disabled'} · {permission.canEdit ? 'can edit' : 'read-only edits'}</p></div>{canEdit && <button className="btn secondary" type="button" disabled={busy} onClick={() => issueToken(permission)}>Issue 15-minute token</button>}</div>
      {permission.tokens.length > 0 && <div className="stack"><strong>Issued tokens</strong>{permission.tokens.map(token => <div className="row" style={{ justifyContent: 'space-between' }} key={token.tokenId}><span className="mono">{token.tokenId} · expires {new Date(token.expiresAt).toLocaleString()}</span>{canEdit && !token.revokedAt && <button className="btn secondary" type="button" disabled={busy} onClick={() => revokeToken(permission, token.tokenId)}>Revoke</button>}</div>)}</div>}
    </article>)}</div>}
    {issuedToken && <div className="card stack" role="status"><strong>One-time token</strong><p className="subtle">Copy this bearer token into the agent now. FanThynks will never display it again.</p><textarea readOnly value={issuedToken} rows={4} aria-label="One-time agent capability token" /></div>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>Grant an agent</legend><div className="row"><label>Agent reference<input value={agentRef} onChange={event => setAgentRef(event.target.value)} maxLength={128} placeholder="hermes-production" /></label><label>Tier<select value={tier} onChange={event => setTier(event.target.value as typeof tier)}>{TIERS.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label><input type="checkbox" checked={canPublish} onChange={event => setCanPublish(event.target.checked)} /> publishing scope</label><label><input type="checkbox" checked={canEditAgent} onChange={event => setCanEditAgent(event.target.checked)} /> edit scope</label><button className="btn" type="button" onClick={saveGrant}>Save agent grant</button></div></fieldset> : <p className="subtle">Agent grants and token issuance require the workspace owner.</p>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>Retry same agent change</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
