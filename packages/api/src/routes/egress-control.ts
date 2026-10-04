import { DEFAULT_EGRESS_PLANE_URL, readBoundedResponseJson } from '@axiom/core';

const ORG_KILL_SWITCH_TIMEOUT_MS = 4_000;

/**
 * Apply an organization-scoped egress gate and require the plane's readback.
 * The database setting is persisted by the caller before this control request;
 * a failed readback is therefore surfaced as an incomplete operation.
 */
export async function setEgressOrgGate(orgId: string, blocked: boolean): Promise<boolean> {
  const action = blocked ? 'drain' : 'release';
  const url = process.env.EGRESS_PLANE_URL ?? DEFAULT_EGRESS_PLANE_URL;
  const token = process.env.EGRESS_PLANE_TOKEN?.trim();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-egress-plane-token'] = token;

  try {
    const response = await fetch(`${url}/kill-switch/org/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ org_id: orgId }),
      signal: AbortSignal.timeout(ORG_KILL_SWITCH_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    const body = await readBoundedResponseJson<{
      org_id?: unknown;
      org_blocked?: unknown;
    }>(response);
    return body.org_id === orgId && body.org_blocked === blocked;
  } catch {
    return false;
  }
}
