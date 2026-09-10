import { zValidator, type Hook } from '@hono/zod-validator';
import type { Env, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import {
  readBoundedText,
  RequestBodyTooLargeError,
  InvalidContentLengthError,
} from './webhook-body.js';

export const API_JSON_MAX_BODY_BYTES = 256 * 1024;

type HasUndefined<T> = undefined extends T ? true : false;
type JsonValidatorInput<T extends z.ZodTypeAny> =
  HasUndefined<z.input<T>> extends true
    ? { in: { json?: z.input<T> | undefined }; out: { json: z.output<T> } }
    : { in: { json: z.input<T> }; out: { json: z.output<T> } };

const JSON_CONTENT_TYPE = /^application\/([a-z.-]+\+)?json(?:;|$)/i;

/**
 * Match @hono/zod-validator's JSON behavior while bounding the raw body
 * before Hono parses it. The body is placed in Hono's public body cache so the
 * upstream validator still owns schema parsing, hooks, and validated-data
 * typing.
 */
export function boundedJsonValidator<
  T extends z.ZodTypeAny,
  E extends Env = Env,
  P extends string = string,
>(
  target: 'json',
  schema: T,
  hook?: Hook<z.TypeOf<T>, E, P, 'json', object>,
): MiddlewareHandler<E, P, JsonValidatorInput<T>> {
  const validate = zValidator(target, schema, hook);

  return async (c, next) => {
    const contentType = c.req.header('Content-Type');
    if (contentType && JSON_CONTENT_TYPE.test(contentType)) {
      try {
        const text = await readBoundedText(c.req.raw, API_JSON_MAX_BODY_BYTES);
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

    return validate(c as Parameters<typeof validate>[0], next);
  };
}
