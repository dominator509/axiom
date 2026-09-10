/** Maximum body size accepted by public provider webhook handlers. */
export const RELAY_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`request body exceeds the maximum size of ${maxBytes} bytes`);
    this.name = 'RequestBodyTooLargeError';
  }
}

export class InvalidContentLengthError extends Error {
  constructor() {
    super('request body has an invalid Content-Length header');
    this.name = 'InvalidContentLengthError';
  }
}

/**
 * Read a request body incrementally so chunked requests cannot bypass the
 * webhook size ceiling before JSON parsing or signature verification.
 */
export async function readBoundedText(
  request: Request,
  maxBytes = RELAY_WEBHOOK_MAX_BODY_BYTES,
): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new InvalidContentLengthError();
    }
    if (declaredLength > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readBoundedJson<T>(
  request: Request,
  maxBytes = RELAY_WEBHOOK_MAX_BODY_BYTES,
): Promise<T> {
  return JSON.parse(await readBoundedText(request, maxBytes)) as T;
}
