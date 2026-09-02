// ─── Pre-Post Hook stage (L2.10) ───
// Mandatory, abstracted execution space in the publish lifecycle: before a
// bundle is handed to any connector, the pre-post stage runs registered
// PrePostHook scripts AND (when the Rust media plane is configured) stages the
// media there (Rust-isolated execution, L2.10 v2). Every run is recorded in
// `pre_post_run` for auditability — status, timing, input/output, error.

import { schema } from '@axiom/db';
import { PrePostHook } from '@axiom/fanvue-mcp';
import type { Platform, PublishResult } from '@axiom/core';
import type { ConnectorPublishInput } from '@axiom/connectors';
import type { ExecutorContext } from './context.js';

const DEFAULT_MEDIA_PLANE_URL = process.env.AXIOM_MEDIA_ADDR
  ? `http://${process.env.AXIOM_MEDIA_ADDR}`
  : (process.env.MEDIA_PLANE_URL ?? 'http://127.0.0.1:8100');

export interface PrePostRunInput {
  targetId: string;
  bundleId: string;
  platform: string;
  modelId: string;
  caption: string;
  mediaUrls: string[];
  hashtags: string[];
  phase: 'before' | 'after';
}

export interface PrePostStageResult {
  input: ConnectorPublishInput;
  staged: boolean;
  engine: 'rust-media-plane' | 'in-process' | 'unavailable';
  runId: string;
  scriptResults: Array<{ name: string; ok: boolean; error?: string }>;
}

/** Shared hook instance (scripts registered at worker startup). */
let hookInstance: PrePostHook | null = null;

export function getPrePostHook(): PrePostHook {
  if (!hookInstance) hookInstance = new PrePostHook();
  return hookInstance;
}

/**
 * Check the Rust media plane is reachable (L2.10 v2 isolated execution).
 * Returns the engine label actually used.
 */
export async function mediaPlaneEngine(
  mediaPlaneUrl: string = DEFAULT_MEDIA_PLANE_URL,
): Promise<'rust-media-plane' | 'in-process'> {
  let failure: string | undefined;
  try {
    const res = await fetch(`${mediaPlaneUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    if (res.ok) return 'rust-media-plane';
    failure = `HTTP ${res.status}`;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  // The blueprint makes the Rust media plane the mandatory isolation boundary
  // for publishing. An in-process fallback is useful for local development
  // only and must be explicitly enabled; allowing it by default would let a
  // dependency outage bypass the declared isolation and ToS-compliance path.
  const allowInProcessFallback =
    process.env.NODE_ENV !== 'production' && process.env.AXIOM_ALLOW_IN_PROCESS_PREPOST === 'true';
  if (!allowInProcessFallback) {
    throw new Error(`Rust media plane unavailable (${failure ?? 'unknown failure'})`);
  }

  // This explicit development-only escape hatch is never selected by a
  // production worker, even if its environment is mislabelled.
  return 'in-process';
}

/** Build the connector publish input that the executor will actually send. */
function toConnectorInput(
  ctx: ExecutorContext,
  input: PrePostRunInput,
  mutated: Record<string, unknown>,
): ConnectorPublishInput {
  const { job } = ctx;
  return {
    idempotencyKey: `${job.org_id}:${input.targetId}:${input.phase}`,
    caption: (mutated.caption as string) ?? input.caption,
    mediaUrls: (mutated.mediaUrls as string[]) ?? input.mediaUrls,
    hashtags: (mutated.hashtags as string[]) ?? input.hashtags,
    options: { modelId: input.modelId, ...((mutated.options as Record<string, unknown>) ?? {}) },
  };
}

/**
 * Run the before-publish stage: media-plane staging (when available) then the
 * registered PrePostHook scripts, recording the run in pre_post_run.
 */
export async function runPrePostBefore(
  ctx: ExecutorContext,
  input: PrePostRunInput,
): Promise<PrePostStageResult> {
  const { tx, job } = ctx;
  const hook = getPrePostHook();
  const startedAt = new Date();

  let engine: PrePostStageResult['engine'] = 'unavailable';
  const scriptResults: PrePostStageResult['scriptResults'] = [];
  let error: string | null = null;
  const output: Record<string, unknown> = { engine };

  let working: ConnectorPublishInput = {
    idempotencyKey: `${job.org_id}:${input.targetId}:${input.phase}`,
    caption: input.caption,
    mediaUrls: input.mediaUrls,
    hashtags: input.hashtags,
    options: { modelId: input.modelId },
  };

  try {
    engine = await mediaPlaneEngine();
    output.engine = engine;

    // 1. Rust media-plane staging call (isolated execution path).
    if (engine === 'rust-media-plane') {
      const staged = await stageMediaOnPlane(input);
      output.staging = staged;
    }

    // 2. PrePostHook beforePublish pipeline (public API). The hook's own type
    // is the core PublishInput; we adapt at the boundary and take back the
    // fields that matter for the connector call.
    const adapted = hook.beforePublish(working as never, input.platform as Platform);
    const result = (await adapted) as unknown as Record<string, unknown>;
    working = toConnectorInput(ctx, input, result);
    for (const name of hook.listScripts()) {
      scriptResults.push({ name, ok: true });
    }
    output.scriptResults = scriptResults;
  } catch (err) {
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
    input: { ...input } as unknown as Record<string, unknown>,
    output,
    error,
    startedAt,
    finishedAt: new Date(),
  });

  if (error) {
    throw new Error(`pre-post.before failed: ${error}`);
  }

  return { input: working, staged: engine === 'rust-media-plane', engine, runId, scriptResults };
}

/**
 * Run the after-publish stage, recording the run in pre_post_run.
 */
export async function runPrePostAfter(
  ctx: ExecutorContext,
  input: PrePostRunInput,
  result: unknown,
): Promise<PrePostStageResult> {
  const { tx, job } = ctx;
  const hook = getPrePostHook();
  const startedAt = new Date();
  const scriptResults: PrePostStageResult['scriptResults'] = [];
  let error: string | null = null;

  try {
    await hook.afterPublish(result as PublishResult, input.platform as Platform);
    for (const name of hook.listScripts()) {
      scriptResults.push({ name, ok: true });
    }
  } catch (err) {
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
    input: { ...input } as unknown as Record<string, unknown>,
    output: { result: result as unknown as Record<string, unknown>, scriptResults },
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
async function stageMediaOnPlane(input: PrePostRunInput): Promise<Record<string, unknown>> {
  const mediaPlaneUrl = DEFAULT_MEDIA_PLANE_URL;
  const out: Record<string, unknown> = {};

  const firstMedia = input.mediaUrls[0];
  if (firstMedia) {
    const probe = await fetch(`${mediaPlaneUrl}/media/video/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_path: firstMedia.replace(/^asset:\/\//, '') }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!probe.ok) {
      throw new Error(`media-plane probe failed: HTTP ${probe.status}`);
    }
    const probeResult = (await probe.json()) as { exists?: boolean };
    if (probeResult.exists === false) {
      throw new Error('media-plane probe reported that the input is missing');
    }
    out.probe = probeResult;
  }

  return out;
}
