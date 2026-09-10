/** Maximum size of a non-streaming provider completion envelope. */
export const LLM_PROVIDER_JSON_MAX_BYTES = 1 * 1024 * 1024;
const LLM_PROVIDER_ERROR_MAX_BYTES = 64 * 1024;

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
