// Egress-aware fetch for the LLM gateway (L2.6).
//
// When a model profile has a bound egress (see egress-plane :9090), the
// gateway routes that model's provider calls through the model's sidecar
// proxy — the same fail-closed namespace the egress-plane built. The client
// factory requires a healthy bound sidecar. Missing/unhealthy status is NOT
// an implicit opt-in to direct egress; consumers must reject a null result.

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { statSync, type Stats } from 'node:fs';
import { DEFAULT_EGRESS_PLANE_URL, readBoundedResponseJson } from '@axiom/core';

const EGRESS_PLANE_URL = process.env.EGRESS_PLANE_URL ?? DEFAULT_EGRESS_PLANE_URL;
const EGRESS_PLANE_HEADERS: Record<string, string> = process.env.EGRESS_PLANE_TOKEN?.trim()
  ? { 'x-egress-plane-token': process.env.EGRESS_PLANE_TOKEN.trim() }
  : {};

interface EgressStatusModel {
  model_id?: string;
  mode?: string;
  host_ip?: string;
  healthy?: boolean;
}

interface EgressStatus {
  models?: EgressStatusModel[];
}

/**
 * A healthy egress binding selected by the egress plane.  `direct` is an
 * explicit, persisted egress policy — never the fallback for a missing or
 * unhealthy model.  Consumers must therefore reject `null` rather than
 * treating it as permission to use the host route.
 */
export type EgressBinding = { kind: 'direct' } | { kind: 'proxy'; proxyUrl: string };

const cache = new Map<string, { binding: EgressBinding | null; at: number }>();
const CACHE_TTL_MS = 5000;

/** Resolve an explicit healthy egress binding, or null when unbound/unhealthy. */
export async function resolveEgressBinding(modelId: string): Promise<EgressBinding | null> {
  if (!modelId) return null;
  const cached = cache.get(modelId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.binding;

  let binding: EgressBinding | null = null;
  try {
    const res = await fetch(`${EGRESS_PLANE_URL}/egress/status`, {
      headers: EGRESS_PLANE_HEADERS,
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const status = await readBoundedResponseJson<EgressStatus>(res);
      const model = status.models?.find((m) => m.model_id === modelId);
      if (model?.healthy && model.mode === 'direct') {
        binding = { kind: 'direct' };
      } else if (model?.healthy && model.host_ip) {
        binding = { kind: 'proxy', proxyUrl: `http://${model.host_ip}:8080` };
      }
    }
  } catch {
    // Egress plane unreachable — return null so callers requiring model-bound
    // routing fail closed instead of silently using the host route.
    binding = null;
  }
  cache.set(modelId, { binding, at: Date.now() });
  return binding;
}

const agents = new Map<string, ProxyAgent>();

/**
 * A process running under mandatory egress confinement must be the explicit
 * model runner in its assigned namespace. This guard prevents shared callers
 * (API, OAuth, gateway, or an accidentally-global worker) from treating a
 * proxy binding or an environment marker as sufficient isolation and opening
 * a host-network connection.
 *
 * Leaving the flag unset preserves the existing, explicit-binding behavior.
 * A malformed value is intentionally not interpreted as "off".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Enforce the shared egress-fetch boundary. Exported so its namespace proof
 * can be unit-tested without mutating the host's network namespace.
 */
export function assertEgressFetchCaller(
  env: Record<string, string | undefined> = process.env,
  options: { platform?: NodeJS.Platform; stat?: (path: string) => Pick<Stats, 'dev' | 'ino'> } = {},
): void {
  const required = env.AXIOM_EGRESS_CONFINEMENT_REQUIRED;
  if (required === undefined) return;
  if (required !== '1') {
    throw new Error('AXIOM_EGRESS_CONFINEMENT_REQUIRED must be exactly 1 when set');
  }
  const modelId = env.WORKER_EGRESS_MODEL_ID;
  if (env.AXIOM_EGRESS_RUNNER !== '1' || !UUID.test(modelId ?? '')) {
    throw new Error('Egress fetch requires the isolated model egress runner');
  }
  const platform = options.platform ?? process.platform;
  const stat = options.stat ?? statSync;
  if (platform !== 'linux') throw new Error('Egress fetch confinement requires a Linux network namespace');
  // Named network namespaces are bind-mounted under /run/netns, not symlinks.
  // Their nsfs device/inode pair is the kernel identity suitable for exact
  // comparison with /proc/self/ns/net; readlink() would fail with EINVAL.
  const current = stat('/proc/self/ns/net');
  const expected = stat(`/run/netns/egress_${modelId}`);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error('Egress fetch caller is not running in its assigned network namespace');
  }
}

/**
 * Build a fetch implementation for an explicit egress binding.
 * Direct bindings use undici's own fetch without a dispatcher; proxy bindings
 * use the model sidecar proxy.  This function does not infer direct egress.
 * IMPORTANT: uses undici's OWN fetch (8.x) with the ProxyAgent (8.x), NOT
 * the global fetch (Node 24 bundles undici 7.x — passing an 8.x dispatcher
 * to the global fetch fails with `invalid onRequestStart method`).
 */
export function buildEgressFetch(binding: EgressBinding): typeof fetch {
  assertEgressFetchCaller();
  if (binding.kind === 'direct') {
    return undiciFetch as unknown as typeof fetch;
  }
  const { proxyUrl } = binding;
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
