// ─── Bounded HTTP response readers ─────────────────────────────────────────
// Every response crossing a service boundary is untrusted input. Keep the
// limit byte-based and stream incrementally so a missing or dishonest
// Content-Length header cannot turn JSON parsing into an allocation sink.

/** Maximum size of a normal JSON response envelope. */
export const AXIOM_JSON_RESPONSE_MAX_BYTES = 1 * 1024 * 1024;

/** Smaller ceiling for response bodies used only as error details. */
export const AXIOM_ERROR_RESPONSE_MAX_BYTES = 64 * 1024;

export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  label: string,
  timeoutMs?: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError(`${label} maximum size must be a non-negative safe integer`);
  }
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new RangeError(`${label} timeout must be a positive finite number`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new Error(`${label} returned an invalid content length`);
    }
    if (declaredLength > maxBytes) {
      throw new Error(`${label} exceeds the maximum supported size of ${maxBytes} bytes`);
    }
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`${label} exceeds the maximum supported size of ${maxBytes} bytes`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = timeoutMs === undefined ? undefined : new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} body timed out after ${timeoutMs}ms`));
      // A stalled transport's cancellation promise must not delay the deadline.
      void reader.cancel().catch(() => undefined);
    }, timeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const read = reader.read();
      const { done, value } = await (deadline ? Promise.race([read, deadline]) : read);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds the maximum supported size of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  label: string,
  timeoutMs?: number,
): Promise<string> {
  const bytes = await readBoundedResponseBytes(response, maxBytes, label, timeoutMs);
  return new TextDecoder().decode(bytes);
}

export async function readBoundedResponseJson<T>(response: Response, timeoutMs?: number): Promise<T> {
  return JSON.parse(
    await readBoundedResponseText(response, AXIOM_JSON_RESPONSE_MAX_BYTES, 'service JSON response', timeoutMs),
  ) as T;
}

export async function readBoundedResponseErrorText(response: Response): Promise<string> {
  return readBoundedResponseText(
    response,
    AXIOM_ERROR_RESPONSE_MAX_BYTES,
    'service error response',
  ).catch(() => '');
}
