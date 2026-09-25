// Egress-aware fetch for the LLM gateway (L2.6).
//
// When a model profile has a bound egress (see egress-plane :9090), the
// gateway routes that model's provider calls through the model's sidecar
// proxy — the same fail-closed namespace the egress-plane built. The client
// factory requires a healthy bound sidecar. Missing/unhealthy status is NOT
// an implicit opt-in to direct egress; consumers must reject a null result.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
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

type DnsAddress = { address: string; family: number };

function ipv6Bytes(address: string): number[] | null {
  let input = address.toLowerCase();
  if (input.includes('.')) {
    const separator = input.lastIndexOf(':');
    const octets = input.slice(separator + 1).split('.').map(Number);
    if (separator < 0 || octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      return null;
    }
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    input = `${input.slice(0, separator)}:${high}:${low}`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const words = [...left, ...Array(halves.length === 2 ? 8 - left.length - right.length : 0).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.flatMap((word) => {
    const value = Number.parseInt(word, 16);
    return [value >> 8, value & 0xff];
  });
}

/** True only for globally routable IPv4/IPv6 addresses suitable for custom-domain egress. */
export function isPublicEgressAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 88 && c === 99)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6) return false;

  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const first = (bytes[0] << 8) | bytes[1];
  const second = (bytes[2] << 8) | bytes[3];
  const third = (bytes[4] << 8) | bytes[5];
  const fourth = (bytes[6] << 8) | bytes[7];
  const globalUnicast = (first & 0xe000) === 0x2000; // 2000::/3
  const protocolAssignment = first === 0x2001 && second <= 0x01ff; // 2001::/23
  const documentation = first === 0x2001 && second === 0x0db8; // 2001:db8::/32
  const sixToFour = first === 0x2002; // 2002::/16
  const documentationV2 = first === 0x3fff && second <= 0x000f; // 3fff::/20
  const orchidV2 = first === 0x2001 && second === 0x0020; // 2001:20::/28
  const specialFirstWord = third === 0 && fourth === 0 && second === 0;
  return globalUnicast && !protocolAssignment && !documentation && !sixToFour
    && !documentationV2 && !orchidV2 && !(first === 0x2001 && specialFirstWord);
}

export function assertPublicEgressAnswers(addresses: readonly DnsAddress[]): void {
  if (addresses.length === 0) throw new Error('DNS returned no addresses');
  if (addresses.some(({ address }) => !isPublicEgressAddress(address))) {
    throw new Error('DNS returned a non-public address');
  }
}

/**
 * Make an Undici connector that resolves all A/AAAA answers at socket-connect
 * time, rejects mixed/public-private sets, then hands Undici only checked
 * numeric answers. Node follows CNAMEs as part of lookup; the connector will
 * not resolve the original hostname a second time after this callback returns.
 * The resolver seam allows the local security harness to supply controlled DNS.
 */
function createPublicEgressAgent(
  resolve: (hostname: string) => Promise<DnsAddress[]> = async (hostname) =>
    await dnsLookup(hostname, { all: true, verbatim: true }),
): Agent {
  const publicLookup = (
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: (...args: unknown[]) => void,
  ): void => {
    const complete = callback as (...args: unknown[]) => void;
    void resolve(hostname).then((addresses) => {
      assertPublicEgressAnswers(addresses);
      const candidates = options.family
        ? addresses.filter((record) => record.family === options.family)
        : addresses;
      if (options.all) {
        complete(null, candidates);
      } else {
        const selected = candidates[0];
        if (!selected) {
          complete(Object.assign(new Error('Egress target has no address in the requested family'), { code: 'ENOTFOUND' }), '', 0);
          return;
        }
        complete(null, selected.address, selected.family);
      }
    }).catch((cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error('Egress target DNS lookup failed');
      const codedError = Object.assign(error, {
        code: (error as NodeJS.ErrnoException).code ?? 'EACCES',
      });
      complete(codedError, options.all ? [] : '', 0);
    });
  };
  return new Agent({ connect: { lookup: publicLookup as never } });
}

function assertPublicLiteralAddress(input: Parameters<typeof fetch>[0]): void {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return; // Let Undici produce its normal invalid-URL error.
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  // Node's connector skips lookup callbacks for IP literals, so reject them
  // before dispatch. DNS names are checked and pinned by the Agent below.
  if (isIP(hostname) !== 0 && !isPublicEgressAddress(hostname)) {
    throw new TypeError('Egress target is a non-public IP address');
  }
}

/** Build the protected direct fetch surface; the resolver parameter is for controlled local tests. */
export function createPublicEgressFetch(
  resolve?: (hostname: string) => Promise<DnsAddress[]>,
): typeof fetch {
  const agent = createPublicEgressAgent(resolve);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assertPublicLiteralAddress(input);
    return undiciFetch(
      input as never,
      { ...init, dispatcher: agent } as never,
    ) as unknown as Promise<Response>;
  }) as typeof fetch;
}

const directEgressFetch = createPublicEgressFetch();

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
 * Direct bindings use a public-address checked socket dispatcher; proxy
 * bindings use the model sidecar proxy, which applies the same policy at its
 * own connect boundary. This function does not infer direct egress.
 * IMPORTANT: uses undici's OWN fetch (8.x) with the ProxyAgent (8.x), NOT
 * the global fetch (Node 24 bundles undici 7.x — passing an 8.x dispatcher
 * to the global fetch fails with `invalid onRequestStart method`).
 */
export function buildEgressFetch(binding: EgressBinding): typeof fetch {
  assertEgressFetchCaller();
  if (binding.kind === 'direct') {
    return directEgressFetch;
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
