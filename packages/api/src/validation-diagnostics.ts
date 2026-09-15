// Validation diagnostics hook — proposed upstream change.
//
// WHY THIS EXISTS
// POST /api/v1/models/:modelId/generate returned HTTP 400 with no logged
// detail. The failure had to be inferred from the schema (twice, incorrectly)
// before it was identified by logging the concrete Zod issue list. Any route
// using zValidator can adopt this hook to make validation failures
// self-diagnosing in the service journal.
//
// OBSERVED FAILURE THIS UNCOVERED
// packages/dashboard/components/GenerateForm.tsx sent style/outfit/location/
// mood/lighting as empty strings when an operator cleared those inputs. The
// generateSchema declares them z.string().min(1).default(...), so '' is invalid
// and the default only applies when the key is ABSENT. Every submission with a
// cleared field was rejected in ~71ms, before the media provider was contacted.
// Fixed separately in GenerateForm.tsx; this hook is what made it visible.
//
// SCOPE
// Diagnostics only. It does not alter a schema, bypass a check, or change which
// requests are accepted: the 400 response shape is preserved and the issue
// list is additive. Credential-shaped keys are redacted before logging.
//
// INTENDED LOCATION
// packages/api/src/validation-diagnostics.ts
// and used as:
//   zValidator('json', generateSchema, validationDiagnostics('generate'))

const MAX_PREVIEW = 120;

function preview(value: unknown): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof s !== 'string') return `<${typeof value}>`;
    return s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW)}…` : s;
  } catch {
    return '<unserialisable>';
  }
}

/** Strip anything credential-shaped before it can reach the journal. */
function redact(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return preview(body);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = /pass|secret|token|key|auth|credential|bearer/i.test(k)
      ? '[REDACTED]'
      : v && typeof v === 'object'
        ? Array.isArray(v)
          ? `[array len=${v.length}]`
          : preview(v)
        : v;
  }
  return out;
}

export interface ValidationIssueSummary {
  path: string;
  code: string;
  message: string;
  received?: unknown;
}

/**
 * Build a @hono/zod-validator hook that logs validation failures and preserves
 * the existing 400 response shape.
 *
 * @param route short label used in the journal line, e.g. 'generate'
 */
export function validationDiagnostics(route: string) {
  return (result: any, c: any) => {
    if (result.success) return;
    const issues: ValidationIssueSummary[] = (result.error?.issues ?? []).map(
      (i: any) => ({
        path: i.path.join('.') || '(root)',
        code: i.code,
        message: i.message,
        ...(i.received !== undefined ? { received: i.received } : {}),
      }),
    );
    // NOTE: c.req.bodyCache.text is typed as a resolved string in Hono but
    // holds a pending promise at this point in the middleware chain. Parsing
    // it here is best-effort; the issue list is the authoritative signal.
    let bodyPreview: unknown;
    try {
      const raw = (c.req as any).bodyCache?.text;
      bodyPreview = redact(raw && typeof raw === 'string' ? JSON.parse(raw) : null);
    } catch {
      bodyPreview = '<unparseable>';
    }
    console.error(
      `[validation:${route}] 400 ${issues.length} issue(s) ` +
        JSON.stringify({ issues, body: bodyPreview }),
    );
    return c.json(
      {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'Invalid request body',
        issues: issues.map(({ path, code, message }) => ({ path, code, message })),
      },
      400,
    );
  };
}
