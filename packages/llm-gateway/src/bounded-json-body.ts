import type { Context, Next } from 'hono';

export const LLM_JSON_MAX_BODY_BYTES = 256 * 1024;

class RequestBodyTooLargeError extends Error {}
class InvalidContentLengthError extends Error {}

async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new InvalidContentLengthError();
    }
    if (declaredLength > maxBytes) throw new RequestBodyTooLargeError();
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
        throw new RequestBodyTooLargeError();
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

const JSON_CONTENT_TYPE = /^application\/([a-z.-]+\+)?json(?:;|$)/i;

/** Bound JSON before any Hono validator or route handler parses it. */
export async function boundedJsonBody(c: Context, next: Next): Promise<Response | void> {
  const contentType = c.req.header('Content-Type');
  if (contentType && JSON_CONTENT_TYPE.test(contentType)) {
    try {
      const text = await readBoundedText(c.req.raw, LLM_JSON_MAX_BODY_BYTES);
      // Hono's runtime body cache stores the pending parser promise even
      // though its public type is declared as the resolved string value.
      c.req.bodyCache.text = Promise.resolve(text) as unknown as string;
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: 'payload too large' }, 413);
      }
      if (error instanceof InvalidContentLengthError) {
        return c.json({ error: 'invalid Content-Length header' }, 400);
      }
      throw error;
    }
  }

  return next();
}
