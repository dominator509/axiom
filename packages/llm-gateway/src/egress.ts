// Egress-aware fetch for the LLM gateway (L2.6).
//
// When a model profile has a bound egress (see egress-plane :3000), the
// gateway routes that model's provider calls through the model's sidecar
// proxy — the same fail-closed namespace the egress-plane built. The client
// factory is namespace-scoped: a model WITHOUT a healthy bound egress gets
// the plain global fetch (direct egress, explicit opt-in).

import { ProxyAgent, fetch as undiciFetch } from 'undici';

const EGRESS_PLANE_URL = process.env.EGRESS_PLANE_URL ?? 'http://127.0.0.1:3000';

interface EgressStatusModel {
  model_id?: string;
  mode?: string;
  host_ip?: string;
  healthy?: boolean;
}

interface EgressStatus {
  models?: EgressStatusModel[];
}

const cache = new Map<string, { proxy: string | null; at: number }>();
const CACHE_TTL_MS = 5000;

/** Resolve the sidecar proxy URL for a model, or null when unbound/unhealthy. */
export async function resolveEgressProxy(modelId: string): Promise<string | null> {
  if (!modelId) return null;
  const cached = cache.get(modelId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.proxy;

  let proxy: string | null = null;
  try {
    const res = await fetch(`${EGRESS_PLANE_URL}/egress/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const status = (await res.json()) as EgressStatus;
      const model = status.models?.find((m) => m.model_id === modelId);
      if (model?.healthy && model.host_ip) {
        proxy = `http://${model.host_ip}:8080`;
      }
    }
  } catch {
    // Egress plane unreachable — degrade to direct (documented opt-out).
    proxy = null;
  }
  cache.set(modelId, { proxy, at: Date.now() });
  return proxy;
}

const agents = new Map<string, ProxyAgent>();

/**
 * Build a fetch implementation that routes through a sidecar proxy.
 * IMPORTANT: uses undici's OWN fetch (8.x) with the ProxyAgent (8.x), NOT
 * the global fetch (Node 24 bundles undici 7.x — passing an 8.x dispatcher
 * to the global fetch fails with `invalid onRequestStart method`).
 */
export function buildEgressFetch(proxyUrl: string): typeof fetch {
  let agent = agents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    agents.set(proxyUrl, agent);
  }
  // undici's fetch types differ from Node's global fetch (bytes/textStream);
  // the cast through unknown reconciles the two surfaces.
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    undiciFetch(
      input as never,
      { ...init, dispatcher: agent } as never,
    ) as unknown as Promise<Response>) as typeof fetch;
}

/** Clear the status cache (used by tests). */
export function clearEgressCache(): void {
  cache.clear();
}
