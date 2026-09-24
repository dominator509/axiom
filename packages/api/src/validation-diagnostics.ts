import { z } from 'zod';
import type { Context } from 'hono';

/** Log schema-owned labels only, never request bodies, messages or received values.
 * Keep the upstream validator's success:false/error response contract.
 */
export function validationDiagnostics(route: string, allowedFields: readonly string[]) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(route)) throw new Error('Invalid diagnostic route label');
  const fields = new Set(allowedFields);
  const codes = new Set<string>(Object.values(z.ZodIssueCode));
  return (result: { success: boolean; error?: { issues: readonly z.ZodIssue[] } }, c: Context) => {
    if (result.success) return;
    const issues = result.error?.issues ?? [];
    const summary = issues.slice(0, 20).map(issue => ({
      field: typeof issue.path[0] === 'string' && fields.has(issue.path[0]) ? issue.path[0] : '(other)',
      code: codes.has(issue.code) ? issue.code : 'unknown',
    }));
    try {
      console.warn(JSON.stringify({ event: 'validation_failed', route, status: 400,
        issueCount: issues.length, issues: summary, truncated: issues.length > summary.length }));
    } catch {
      // Observability failure must not change request acceptance or its response.
    }
    // Reading Zod's lazy error getter creates an enumerable _error cache on
    // the result. Do not leak that implementation detail into the response.
    return c.json({ success: false, error: result.error }, 400);
  };
}
