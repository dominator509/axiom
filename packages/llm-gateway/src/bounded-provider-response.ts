/** Maximum size of a non-streaming provider completion envelope. */
export const LLM_PROVIDER_JSON_MAX_BYTES = 1 * 1024 * 1024;
/** Maximum raw bytes retained from one provider SSE completion. */
export const LLM_PROVIDER_STREAM_MAX_BYTES = 4 * 1024 * 1024;
/** Maximum size of one SSE line before JSON parsing. */
export const LLM_PROVIDER_SSE_LINE_MAX_BYTES = 1 * 1024 * 1024;
const LLM_PROVIDER_ERROR_MAX_BYTES = 64 * 1024;

/**
 * Read provider SSE lines with independent total-stream and line ceilings.
 * Provider streams are untrusted even when they come from a local model
 * server: a missing terminator or malformed line must not grow memory without
 * bound. Cancelling on early termination also releases the upstream request.
 */
export async function* readBoundedProviderSseLines(
  stream: ReadableStream<Uint8Array>,
  label = 'provider SSE stream',
  maxBytes = LLM_PROVIDER_STREAM_MAX_BYTES,
  maxLineBytes = LLM_PROVIDER_SSE_LINE_MAX_BYTES,
): AsyncIterable<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError(`${label} maximum size must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 0) {
    throw new RangeError(`${label} maximum line size must be a non-negative safe integer`);
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalBytes = 0;
  let completed = false;

  const yieldLine = (line: string): string => {
    if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
      throw new Error(`${label} line exceeds the maximum supported size of ${maxLineBytes} bytes`);
    }
    return line;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`${label} exceeds the maximum supported size of ${maxBytes} bytes`);
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) yield yieldLine(line);
      if (Buffer.byteLength(buffer, 'utf8') > maxLineBytes) {
        throw new Error(`${label} line exceeds the maximum supported size of ${maxLineBytes} bytes`);
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) yield yieldLine(buffer);
    completed = true;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Append streamed model output without allowing a provider to grow memory indefinitely. */
export function appendBoundedProviderContent(
  current: string,
  delta: string,
  maxBytes = LLM_PROVIDER_STREAM_MAX_BYTES,
): string {
  if (Buffer.byteLength(current, 'utf8') + Buffer.byteLength(delta, 'utf8') > maxBytes) {
    throw new Error(`provider completion exceeds the maximum supported size of ${maxBytes} bytes`);
  }
  return current + delta;
}

/** Read an upstream response body incrementally up to a hard byte ceiling. */
export async function readBoundedProviderText(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
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
    return new TextDecoder().decode(bytes);
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
  return new TextDecoder().decode(bytes);
}

/** Parse a bounded successful provider JSON envelope. */
export async function readProviderJson<T>(response: Response): Promise<T> {
  const text = await readBoundedProviderText(
    response,
    LLM_PROVIDER_JSON_MAX_BYTES,
    'provider JSON response',
  );
  return JSON.parse(text) as T;
}

/** Read a bounded provider error body, suppressing secondary read failures. */
export async function readProviderErrorText(response: Response): Promise<string> {
  return readBoundedProviderText(
    response,
    LLM_PROVIDER_ERROR_MAX_BYTES,
    'provider error response',
  ).catch(() => '');
}
