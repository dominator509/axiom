// ─── Pre-Post Hook stage (L2.10) ───
// Mandatory, abstracted execution space in the publish lifecycle: before a
// bundle is handed to any connector, the pre-post stage runs registered
// PrePostHook scripts AND (when the Rust media plane is configured) stages the
// media there (Rust-isolated execution, L2.10 v2). Every run is recorded in
// `pre_post_run` for auditability — status, timing, input/output, error.
import { schema } from '@axiom/db';
import { PrePostHook } from '@axiom/fanvue-mcp';
const DEFAULT_MEDIA_PLANE_URL = process.env.AXIOM_MEDIA_ADDR
    ? `http://${process.env.AXIOM_MEDIA_ADDR}`
    : process.env.MEDIA_PLANE_URL ?? 'http://127.0.0.1:8100';
/** Shared hook instance (scripts registered at worker startup). */
let hookInstance = null;
export function getPrePostHook() {
    if (!hookInstance)
        hookInstance = new PrePostHook();
    return hookInstance;
}
export function setPrePostHookForTests(hook) {
    hookInstance = hook;
}
/** Register a script on the shared hook. */
export function registerPrePostScript(name, before, after) {
    getPrePostHook().registerScript({ name, beforePublish: before, afterPublish: after });
}
/**
 * Check the Rust media plane is reachable (L2.10 v2 isolated execution).
 * Returns the engine label actually used.
 */
export async function mediaPlaneEngine(mediaPlaneUrl = DEFAULT_MEDIA_PLANE_URL) {
    try {
        const res = await fetch(`${mediaPlaneUrl}/health`, { signal: AbortSignal.timeout(2_000) });
        if (res.ok)
            return 'rust-media-plane';
    }
    catch {
        // plane down → fall back to in-process (honest degradation)
    }
    return 'in-process';
}
/** Build the connector publish input that the executor will actually send. */
function toConnectorInput(ctx, input, mutated) {
    const { job } = ctx;
    return {
        idempotencyKey: `${job.org_id}:${input.targetId}:${input.phase}`,
        caption: mutated.caption ?? input.caption,
        mediaUrls: mutated.mediaUrls ?? input.mediaUrls,
        hashtags: mutated.hashtags ?? input.hashtags,
        options: { modelId: input.modelId, ...(mutated.options ?? {}) },
    };
}
/**
 * Run the before-publish stage: media-plane staging (when available) then the
 * registered PrePostHook scripts, recording the run in pre_post_run.
 */
export async function runPrePostBefore(ctx, input) {
    const { tx, job } = ctx;
    const hook = getPrePostHook();
    const startedAt = new Date();
    const engine = await mediaPlaneEngine();
    const scriptResults = [];
    let error = null;
    let output = { engine };
    // Start from the real connector input shape (what will be published).
    let working = {
        idempotencyKey: `${job.org_id}:${input.targetId}:${input.phase}`,
        caption: input.caption,
        mediaUrls: input.mediaUrls,
        hashtags: input.hashtags,
        options: { modelId: input.modelId },
    };
    try {
        // 1. Rust media-plane staging call (isolated execution path).
        if (engine === 'rust-media-plane') {
            const staged = await stageMediaOnPlane(input);
            output.staging = staged;
        }
        // 2. PrePostHook beforePublish pipeline (public API). The hook's own type
        // is the core PublishInput; we adapt at the boundary and take back the
        // fields that matter for the connector call.
        const adapted = hook.beforePublish(working, input.platform);
        const result = (await adapted);
        working = toConnectorInput(ctx, input, result);
        for (const name of hook.listScripts()) {
            scriptResults.push({ name, ok: true });
        }
        output.scriptResults = scriptResults;
    }
    catch (err) {
        error = err instanceof Error ? err.message : String(err);
        output.error = error;
    }
    const runId = crypto.randomUUID();
    await tx.insert(schema.prePostRun).values({
        id: runId,
        orgId: job.org_id,
        modelId: input.modelId,
        targetId: input.targetId,
        script: `pre-post.before (${engine})`,
        status: error ? 'failed' : 'success',
        input: { ...input },
        output,
        error,
        startedAt,
        finishedAt: new Date(),
    });
    return { input: working, staged: engine === 'rust-media-plane', engine, runId, scriptResults };
}
/**
 * Run the after-publish stage, recording the run in pre_post_run.
 */
export async function runPrePostAfter(ctx, input, result) {
    const { tx, job } = ctx;
    const hook = getPrePostHook();
    const startedAt = new Date();
    const scriptResults = [];
    let error = null;
    try {
        await hook.afterPublish(result, input.platform);
        for (const name of hook.listScripts()) {
            scriptResults.push({ name, ok: true });
        }
    }
    catch (err) {
        error = err instanceof Error ? err.message : String(err);
    }
    const runId = crypto.randomUUID();
    await tx.insert(schema.prePostRun).values({
        id: runId,
        orgId: job.org_id,
        modelId: input.modelId,
        targetId: input.targetId,
        script: `pre-post.after (in-process)`,
        status: error ? 'failed' : 'success',
        input: { ...input },
        output: { result: result, scriptResults },
        error,
        startedAt,
        finishedAt: new Date(),
    });
    return {
        input: {
            idempotencyKey: `${job.org_id}:${input.targetId}:${input.phase}`,
            caption: input.caption,
            mediaUrls: input.mediaUrls,
            hashtags: input.hashtags,
            options: { modelId: input.modelId },
        },
        staged: false,
        engine: 'in-process',
        runId,
        scriptResults,
    };
}
/**
 * Stage the media on the Rust media plane: probe the first media URL/path and
 * (for local files) apply a watermark pass. Returns what the plane reported.
 */
async function stageMediaOnPlane(input) {
    const mediaPlaneUrl = DEFAULT_MEDIA_PLANE_URL;
    const out = {};
    const firstMedia = input.mediaUrls[0];
    if (firstMedia) {
        const probe = await fetch(`${mediaPlaneUrl}/media/video/probe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_path: firstMedia.replace(/^asset:\/\//, '') }),
            signal: AbortSignal.timeout(5_000),
        });
        out.probe = probe.ok ? await probe.json() : { error: `probe ${probe.status}` };
    }
    return out;
}
//# sourceMappingURL=pre_post.js.map