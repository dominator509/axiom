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
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError(`${label} maximum size must be a non-negative safe integer`);
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
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds the maximum supported size of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
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
): Promise<string> {
  const bytes = await readBoundedResponseBytes(response, maxBytes, label);
  return new TextDecoder().decode(bytes);
}

export async function readBoundedResponseJson<T>(response: Response): Promise<T> {
  return JSON.parse(
    await readBoundedResponseText(response, AXIOM_JSON_RESPONSE_MAX_BYTES, 'service JSON response'),
  ) as T;
}

export async function readBoundedResponseErrorText(response: Response): Promise<string> {
  return readBoundedResponseText(
    response,
    AXIOM_ERROR_RESPONSE_MAX_BYTES,
    'service error response',
  ).catch(() => '');
}
