'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgentPermission } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const TIERS = ['viewer', 'operator', 'manager', 'autonomous'] as const;
type Intent = { path: string; method: 'POST'; body: string; key: string };

export default function AgentPermissionManager({ modelId, permissions, canEdit }: { modelId: string; permissions: AgentPermission[]; canEdit: boolean }) {
  const router = useRouter();
  const { t } = useLocale();
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
    if (!ref || ref.length > 128) { setError(t('agent.validationError')); return; }
    if (tier === 'autonomous' && !window.confirm(t('agent.autonomousConfirm'))) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/agent-permissions`, method: 'POST', body: JSON.stringify({ agentRef: ref, tier, canPublish, canEdit: canEditAgent }) }, () => {
      setAgentRef(''); setMessage(t('agent.permissionSaved'));
    });
  }

  function issueToken(permission: AgentPermission) {
    if (!window.confirm(t('agent.issueConfirm', { tier: tierLabel(permission.tier), ref: permission.agentRef }))) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/agent-permissions/${encodeURIComponent(permission.id)}/tokens`, method: 'POST', body: JSON.stringify({ ttlSeconds: 900 }) }, (data) => {
      const issued = data as { token?: unknown };
      if (typeof issued.token !== 'string' || issued.token.length < 20) throw new Error('Token was not returned for one-time display');
      setIssuedToken(issued.token);
      setMessage(t('agent.tokenIssued', { ref: permission.agentRef }));
    });
  }

  function revokeToken(permission: AgentPermission, tokenId: string) {
    if (!window.confirm(t('agent.revokeConfirm', { ref: permission.agentRef }))) return;
    void run({ path: `/api/v1/models/${encodeURIComponent(modelId)}/agent-permissions/${encodeURIComponent(permission.id)}/tokens/${encodeURIComponent(tokenId)}/revoke`, method: 'POST', body: '{}' }, () => {
      setMessage(t('agent.tokenRevoked'));
    });
  }

  function tierLabel(value: string): string {
    return TIERS.includes(value as (typeof TIERS)[number]) ? t(`agent.tier.${value}`) : value;
  }

  return <div className="stack">
    <p className="subtle">{t('agent.grantsDescription')}</p>
    {permissions.length === 0 ? <p>{t('agent.noGrants')}</p> : <div className="stack">{permissions.map(permission => <article className="card stack" key={permission.id}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}><div><h3>{permission.agentRef}</h3><p className="subtle">{tierLabel(permission.tier)} · {permission.canPublish ? t('agent.publishingScopeEnabled') : t('agent.publishingScopeDisabled')} · {permission.canEdit ? t('agent.canEdit') : t('agent.readOnlyEdits')}</p></div>{canEdit && <button className="btn secondary" type="button" disabled={busy} onClick={() => issueToken(permission)}>{t('agent.issueToken')}</button>}</div>
      {permission.tokens.length > 0 && <div className="stack"><strong>{t('agent.issuedTokens')}</strong>{permission.tokens.map(token => <div className="row" style={{ justifyContent: 'space-between' }} key={token.tokenId}><span className="mono">{token.tokenId} · {t('agent.expires', { value: new Date(token.expiresAt).toLocaleString() })}</span>{canEdit && !token.revokedAt && <button className="btn secondary" type="button" disabled={busy} onClick={() => revokeToken(permission, token.tokenId)}>{t('agent.revoke')}</button>}</div>)}</div>}
    </article>)}</div>}
    {issuedToken && <div className="card stack" role="status"><strong>{t('agent.oneTimeToken')}</strong><p className="subtle">{t('agent.oneTimeTokenDescription')}</p><textarea readOnly value={issuedToken} rows={4} aria-label={t('agent.oneTimeToken')} /></div>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{t('agent.grantTitle')}</legend><div className="row"><label>{t('agent.agentReference')}<input value={agentRef} onChange={event => setAgentRef(event.target.value)} maxLength={128} placeholder={t('agent.agentReferencePlaceholder')} /></label><label>{t('agent.tier')}<select value={tier} onChange={event => setTier(event.target.value as typeof tier)}>{TIERS.map(value => <option key={value} value={value}>{t(`agent.tier.${value}`)}</option>)}</select></label><label><input type="checkbox" checked={canPublish} onChange={event => setCanPublish(event.target.checked)} /> {t('agent.publishingScope')}</label><label><input type="checkbox" checked={canEditAgent} onChange={event => setCanEditAgent(event.target.checked)} /> {t('agent.editScope')}</label><button className="btn" type="button" onClick={saveGrant}>{t('agent.saveGrant')}</button></div></fieldset> : <p className="subtle">{t('agent.ownerRequired')}</p>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>{t('agent.retryChange')}</button>}
    {error && <p role="alert">{error === 'Agent permission change was not confirmed. Retry the same intent.' ? `${t('agent.unconfirmed')} ${t('agent.retry')}` : error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
