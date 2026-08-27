// ─── Browser mutation client ───────────────────────────────────────────────
// Every user intent gets one idempotency key. Transport retries reuse that
// key, so a lost response cannot turn one click into multiple mutations.

export interface MutationOptions {
  /** Number of network-error retries; all attempts reuse the same key. */
  retries?: number;
  /** Supply a key when resuming an already-created user intent. */
  idempotencyKey?: string;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `axiom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Send a browser mutation with a stable Idempotency-Key. Only transport
 * failures are retried; HTTP responses are returned to the caller unchanged.
 */
export async function mutationFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: MutationOptions = {},
): Promise<Response> {
  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();
  const retries = Math.max(0, options.retries ?? 1);
  const headers = new Headers(init.headers);
  headers.set('Idempotency-Key', idempotencyKey);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(input, { ...init, headers });
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
