import { schema } from '@axiom/db';
/** Resolve the owning org of a model (cross-org lookup via SECURITY DEFINER). */
export declare function orgForModel(modelId: string): Promise<string>;
/**
 * Run a callback inside a transaction scoped to the model's org (RLS FORCE).
 * Mirrors the API's withOrgContext helper without importing it (keeps the
 * mcp-server package self-contained for its tool surface).
 */
export declare function withModelOrg<T>(modelId: string, fn: (tx: any, orgId: string) => Promise<T> | T): Promise<T>;
export { schema };
//# sourceMappingURL=org-context.d.ts.map