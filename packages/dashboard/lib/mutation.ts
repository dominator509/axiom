// ─── Browser mutation client ───────────────────────────────────────────────
// Every user intent gets one idempotency key. Transport retries reuse that
// key, so a lost response cannot turn one click into multiple mutations.

export interface MutationOptions {
  /** Non-negative integer number of network-error retries; all attempts reuse the same key. */
  retries?: number;
  /** Supply a key when resuming an already-created user intent. */
  idempotencyKey?: string;
  /** Maximum time allowed for each network attempt. */
  timeoutMs?: number;
}

export const DEFAULT_MUTATION_TIMEOUT_MS = 30_000;

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `axiom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createAttemptSignal(
  parentSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`mutation timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', forwardAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', forwardAbort);
    },
  };
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive finite number');
  }
}

/**
 * Send a browser mutation with a stable Idempotency-Key. Only transport
 * failures are retried; caller cancellation is terminal and HTTP responses
 * are returned to the caller unchanged.
 */
export async function mutationFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: MutationOptions = {},
): Promise<Response> {
  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();
  const retries = options.retries ?? 1;
  if (!Number.isSafeInteger(retries) || retries < 0) {
    throw new TypeError('retries must be a non-negative safe integer');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS;
  validateTimeout(timeoutMs);
  const headers = new Headers(init.headers);
  headers.set('Idempotency-Key', idempotencyKey);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    init.signal?.throwIfAborted();
    const attemptSignal = createAttemptSignal(init.signal, timeoutMs);
    try {
      return await fetch(input, { ...init, headers, signal: attemptSignal.signal });
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt === retries) throw error;
    } finally {
      attemptSignal.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
