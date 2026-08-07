// ─── Shared DB org-context helper for MCP tools (H-2) ───────────────────────
// Capability tokens scope an agent to a model but carry no org id. Every tool
// resolves the model's org via the SECURITY DEFINER resolver (migration 0007),
// then runs its domain work inside that org's RLS context (LBI-02).
import { sql } from 'drizzle-orm';
import { db, schema } from '@axiom/db';
/** Resolve the owning org of a model (cross-org lookup via SECURITY DEFINER). */
export async function orgForModel(modelId) {
    const res = await db.execute(sql `SELECT resolve_model_org(${modelId}) AS org_id`);
    const rows = (res?.rows ?? []);
    const orgId = rows[0]?.org_id;
    if (!orgId)
        throw new Error(`Model ${modelId} not found`);
    return orgId;
}
/**
 * Run a callback inside a transaction scoped to the model's org (RLS FORCE).
 * Mirrors the API's withOrgContext helper without importing it (keeps the
 * mcp-server package self-contained for its tool surface).
 */
export async function withModelOrg(modelId, fn) {
    const orgId = await orgForModel(modelId);
    return db.transaction(async (tx) => {
        await tx.execute(sql `SELECT set_config('app.current_org_id', ${orgId}, true)`);
        return await fn(tx, orgId);
    });
}
export { schema };
//# sourceMappingURL=org-context.js.map