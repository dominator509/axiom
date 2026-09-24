'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@axiom/core';
import type { AgentPermission } from '@/lib/api';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const TIERS = ['viewer', 'operator', 'manager', 'autonomous'] as const;

/**
 * Stable operator-facing error boundary states.
 *
 * Every non-success response and every uncertain failure maps to one of these
 * catalog-backed states. A backend-provided message is never rendered: the raw
 * string is discarded at the boundary so untrusted server text cannot reach the
 * operator surface.
 */
type ErrorState =
  | { kind: 'none' }
  | { kind: 'notAccepted' }
  | { kind: 'denied' }
  | { kind: 'notFound' }
  | { kind: 'invalid' }
  | { kind: 'conflict' }
  | { kind: 'validation' }
  | { kind: 'unconfirmed' };

export const ERROR_MESSAGE_KEYS: Record<Exclude<ErrorState['kind'], 'none'>, string> = {
  notAccepted: 'agent.notAccepted',
  denied: 'agent.status.denied',
  notFound: 'agent.status.notFound',
  invalid: 'agent.status.invalid',
  conflict: 'agent.status.conflict',
  validation: 'agent.validationError',
  unconfirmed: 'agent.unconfirmed',
};

// Statuses whose intent is terminal: the held intent must be cleared so the
// operator cannot blindly resend a request the server already rejected.
export const TERMINAL_STATUSES = [400, 401, 403, 404, 409, 422] as const;

/**
 * Map a non-success HTTP status to a bounded operator-facing error state.
 * The backend response body is intentionally not an input: no backend-provided
 * message can influence this classification.
 */
export function classifyStatus(status: number): ErrorState {
  if (status === 401 || status === 403) return { kind: 'denied' };
  if (status === 404) return { kind: 'notFound' };
  if (status === 400 || status === 422) return { kind: 'invalid' };
  if (status === 409) return { kind: 'conflict' };
  return { kind: 'notAccepted' };
}

/**
 * Resolve a localized operator message for an error state. Only catalog keys
 * are consulted; a raw backend error string can never reach the rendered DOM.
 */
export function errorText(state: ErrorState, t: (key: string) => string): string {
  if (state.kind === 'none') return '';
  const key = ERROR_MESSAGE_KEYS[state.kind];
  return state.kind === 'unconfirmed' ? `${t(key)} ${t('agent.retry')}` : t(key);
}

/** Build shell-safe OpenClaw setup commands without embedding a bearer token. */
export function buildOpenClawSetupCommands(origin: string): string | null {
  try {
    const parsedOrigin = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsedOrigin.protocol) ||
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== '/' ||
      parsedOrigin.search ||
      parsedOrigin.hash
    ) {
      return null;
    }

    const definition = JSON.stringify({
      url: new URL('/api/mcp', parsedOrigin.origin).toString(),
      transport: 'streamable-http',
      headers: { Authorization: 'Bearer ${AXIOM_MCP_TOKEN}' },
    });
    return `openclaw mcp set axiom '${definition}'\nopenclaw mcp doctor axiom --probe`;
  } catch {
    return null;
  }
}

type Intent = { path: string; method: 'POST'; body: string; key: string };

export default function AgentPermissionManager({ modelId, permissions, canEdit }: { modelId: string; permissions: AgentPermission[]; canEdit: boolean }) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const [agentRef, setAgentRef] = useState('');
  const [tier, setTier] = useState<(typeof TIERS)[number]>('viewer');
  const [canPublish, setCanPublish] = useState(false);
  const [canEditAgent, setCanEditAgent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorState>({ kind: 'none' });
  const [message, setMessage] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [mcpOrigin, setMcpOrigin] = useState('');
  const intent = useRef<Intent | null>(null);

  useEffect(() => {
    setMcpOrigin(window.location.origin);
  }, []);

  const openClawCommands = buildOpenClawSetupCommands(mcpOrigin);

  async function run(next?: Omit<Intent, 'key'>, onSuccess?: (data: unknown) => void) {
    if (busy) return;
    if (next) intent.current ??= { ...next, key: createIdempotencyKey() };
    const request = intent.current;
    if (!request) return;
    setBusy(true); setError({ kind: 'none' }); setMessage('');
    try {
      const response = await mutationFetch(request.path, { method: request.method, headers: { 'content-type': 'application/json' }, body: request.body }, { idempotencyKey: request.key, retries: 0 });
      if (!response.ok) {
        // Read and discard the body: never trust or render a backend message.
        await readDashboardError(response);
        if ((TERMINAL_STATUSES as readonly number[]).includes(response.status)) intent.current = null;
        setError(classifyStatus(response.status));
        return;
      }
      const result = await readDashboardJson<{ data?: unknown }>(response);
      if (!result.data || typeof result.data !== 'object') throw new Error('Unconfirmed agent permission response');
      onSuccess?.(result.data);
      intent.current = null;
      router.refresh();
    } catch { setError({ kind: 'unconfirmed' }); }
    finally { setBusy(false); }
  }

  function saveGrant() {
    const ref = agentRef.trim();
    if (!ref || ref.length > 128) { setError({ kind: 'validation' }); setMessage(''); return; }
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
      {permission.tokens.length > 0 && <div className="stack"><strong>{t('agent.issuedTokens')}</strong>{permission.tokens.map(token => <div className="row" style={{ justifyContent: 'space-between' }} key={token.tokenId}><span className="mono">{token.tokenId} · {t('agent.expires', { value: formatDate(new Date(token.expiresAt), locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) })}</span>{canEdit && !token.revokedAt && <button className="btn secondary" type="button" disabled={busy} onClick={() => revokeToken(permission, token.tokenId)}>{t('agent.revoke')}</button>}</div>)}</div>}
      <details className="stack">
        <summary>{t('agent.openclawTitle')}</summary>
        <p className="subtle">{t('agent.openclawDescription')}</p>
        <label>{t('agent.openclawEndpointLabel')}<input value={mcpOrigin} onChange={event => setMcpOrigin(event.target.value)} inputMode="url" /></label>
        <p className="subtle">{t('agent.openclawEnvironment')}</p>
        {openClawCommands
          ? <><p className="subtle">{t('agent.openclawCommandDescription')}</p><textarea readOnly value={openClawCommands} rows={4} aria-label={t('agent.openclawCommandDescription')} /></>
          : <p role="alert">{t('agent.openclawEndpointInvalid')}</p>}
        <p className="subtle">{t('agent.openclawExpiry')}</p>
      </details>
    </article>)}</div>}
    {issuedToken && <div className="card stack" role="status"><strong>{t('agent.oneTimeToken')}</strong><p className="subtle">{t('agent.oneTimeTokenDescription')}</p><textarea readOnly value={issuedToken} rows={4} aria-label={t('agent.oneTimeToken')} /></div>}
    {canEdit ? <fieldset className="stack" disabled={busy || intent.current !== null} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{t('agent.grantTitle')}</legend><div className="row"><label>{t('agent.agentReference')}<input value={agentRef} onChange={event => setAgentRef(event.target.value)} maxLength={128} placeholder={t('agent.agentReferencePlaceholder')} /></label><label>{t('agent.tier')}<select value={tier} onChange={event => setTier(event.target.value as typeof tier)}>{TIERS.map(value => <option key={value} value={value}>{t(`agent.tier.${value}`)}</option>)}</select></label><label><input type="checkbox" checked={canPublish} onChange={event => setCanPublish(event.target.checked)} /> {t('agent.publishingScope')}</label><label><input type="checkbox" checked={canEditAgent} onChange={event => setCanEditAgent(event.target.checked)} /> {t('agent.editScope')}</label><button className="btn" type="button" onClick={saveGrant}>{t('agent.saveGrant')}</button></div></fieldset> : <p className="subtle">{t('agent.ownerRequired')}</p>}
    {intent.current && <button className="btn secondary" type="button" disabled={busy} onClick={() => void run()}>{t('agent.retryChange')}</button>}
    {error.kind !== 'none' && <p role="alert">{errorText(error, t)}</p>}{message && <p role="status">{message}</p>}
  </div>;
}
