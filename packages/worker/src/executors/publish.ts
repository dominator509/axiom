// ─── publish.target executor (L3.4 §2, L2.0 canonical flow) ───
// One job per platform target. Inside the txn:
//  1. Kill-switch gate — publishing_enabled=false ⇒ park (L3.4 §5).
//  2. Idempotency ledger — key hit ⇒ return stored result, no platform call.
//  3. connector.publish() via the target's encrypted platform connection.
//  4. post_target → published + remote_id, idempotency ledger row — same txn.
//  5. Enqueue metrics.poll for the published target (L2.8 §1).

import { eq, and } from 'drizzle-orm';
import { isProductionEnvironment, tosReportPassesForPlatforms } from '@axiom/core';
import {
  schema,
  getPublishingConsentStatus,
  consentRequirementMessage,
  getTosScanState,
} from '@axiom/db';
import { asPlatform, connectorForTarget } from '../connection.js';
import { enqueueJob } from '../enqueue.js';
import { ParkJobError } from './context.js';
import { runPrePostBefore, runPrePostAfter } from './pre_post.js';
import type { Executor, ExecutorContext } from './context.js';

const KILL_SWITCH_PARK_MS = 60_000;
const PENDING_PUBLISH_RETRY_MS = 60_000;

/** Target states that must not be dispatched to a connector again. */
export function isTerminalPublishTargetState(state: string): boolean {
  return state === 'published' || state === 'skipped' || state === 'canceled';
}

type PublishAsset = {
  id: string;
  orgId: string;
  modelId: string;
  kind: string;
  storageKey: string;
};

/**
 * Keep media publication tenant- and model-scoped, and reject kinds for which
 * the publish pipeline has no media-plane contract.
 */
export function validatePublishAsset(
  asset: PublishAsset | undefined,
  requestedAssetId: string | null,
  orgId: string,
  modelId: string,
): 'image' | 'video' | undefined {
  if (!requestedAssetId) return undefined;
  if (
    !asset ||
    asset.id !== requestedAssetId ||
    asset.orgId !== orgId ||
    asset.modelId !== modelId
  ) {
    throw new Error(`publish.target: asset ${requestedAssetId} is not owned by model ${modelId}`);
  }
  if (asset.kind !== 'image' && asset.kind !== 'video') {
    throw new Error(`publish.target: unsupported asset kind ${asset.kind}`);
  }
  return asset.kind;
}

/**
 * Resolve the persisted local storage key into the provider-facing URL that
 * social APIs can fetch. The Rust media plane continues to receive the local
 * key through `mediaPath`; only the connector boundary gets this URL.
 *
 * The base URL is deliberately explicit. Falling back to an asset ID or a
 * local path would either be unusable by providers or leak an internal path.
 */
export function resolveProviderAssetUrl(asset: Pick<PublishAsset, 'id' | 'storageKey'>): string {
  const storageKey = asset.storageKey.trim().replaceAll('\\', '/');
  if (!storageKey) {
    throw new Error(`publish.target: asset ${asset.id} has no storage key`);
  }

  const segments = storageKey.split('/');
  if (
    storageKey.startsWith('/') ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`publish.target: asset ${asset.id} has an invalid storage key`);
  }

  const configuredBase = process.env.AXIOM_ASSET_DELIVERY_BASE_URL?.trim();
  if (!configuredBase) {
    throw new Error(
      `publish.target: asset ${asset.id} cannot be delivered; AXIOM_ASSET_DELIVERY_BASE_URL is required`,
    );
  }

  let base: URL;
  try {
    base = new URL(configuredBase);
  } catch {
    throw new Error('publish.target: AXIOM_ASSET_DELIVERY_BASE_URL must be a valid http(s) URL');
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('publish.target: AXIOM_ASSET_DELIVERY_BASE_URL must use http(s)');
  }
  if (isProductionEnvironment(process.env) && base.protocol !== 'https:') {
    throw new Error('publish.target: AXIOM_ASSET_DELIVERY_BASE_URL must use https in production');
  }
  if (base.username || base.password || base.search || base.hash) {
    throw new Error(
      'publish.target: AXIOM_ASSET_DELIVERY_BASE_URL must not contain credentials, query, or fragment data',
    );
  }

  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const encodedKey = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return new URL(encodedKey, base).toString();
}

/**
 * Connector media inputs are provider-facing URLs. `asset://` is an internal
 * identifier used by the local media plane and must never cross the connector
 * boundary; providers cannot dereference it and would otherwise fail after a
 * potentially side-effecting request. The configured media delivery path is
 * responsible for converting persisted assets to short-lived HTTP(S) URLs.
 */
export function assertProviderReadableMediaUrls(
  mediaUrls: readonly string[],
  assetId?: string | null,
): void {
  for (const [index, mediaUrl] of mediaUrls.entries()) {
    let parsed: URL;
    try {
      parsed = new URL(mediaUrl);
    } catch {
      throw new Error(
        `publish.target: media URL ${index} is not provider-readable${assetId ? ` for asset ${assetId}` : ''}`,
      );
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `publish.target: media URL ${index} is not provider-readable${assetId ? ` for asset ${assetId}` : ''}; expected an http(s) URL`,
      );
    }
  }
}

/**
 * A connector with no declared metrics must not create a synthetic all-zero
 * metric row. That row would look like real provider data to viral scoring.
 */
export function shouldEnqueueMetrics(
  remoteId: string | null | undefined,
  metrics: readonly string[],
): boolean {
  return Boolean(remoteId && metrics.length > 0);
}

/**
 * Build the durable reconciliation record written immediately before a
 * provider publish. Keep the marker deliberately narrow: it must identify the
 * attempt without persisting captions, media URLs, or credentials.
 */
export function publishDispatchMarkerValues(
  orgId: string,
  modelId: string,
  targetId: string,
  platform: string,
  idempotencyKey: string,
  startedAt = new Date(),
) {
  return {
    orgId,
    modelId,
    targetId,
    script: 'publish.dispatch',
    status: 'pending',
    input: { platform, idempotencyKey },
    startedAt,
  };
}

export const publishTarget: Executor = async (ctx: ExecutorContext) => {
  const { tx, job, killSwitchEnabled } = ctx;
  const payload = (job.payload ?? {}) as { targetId?: string };
  const targetId = payload.targetId;
  if (!targetId) throw new Error('publish.target: payload.targetId required');

  // 1. Kill switch (L3.4 §5) — park, don't fail.
  if (killSwitchEnabled) {
    throw new ParkJobError('publish.target: kill switch enabled — parked', KILL_SWITCH_PARK_MS);
  }

  // Load target + bundle + model in the org context.
  const targets = await tx
    .select()
    .from(schema.postTarget)
    .where(and(eq(schema.postTarget.id, targetId), eq(schema.postTarget.orgId, job.org_id)))
    .limit(1)
    // Serialize publish attempts for one target before any provider I/O. A
    // second worker waits for the first transaction, then observes its
    // committed terminal state instead of racing into another publish call.
    .for('update');
  if (targets.length === 0) throw new Error(`publish.target: target ${targetId} not found`);
  const target = targets[0];
  if (isTerminalPublishTargetState(target.state)) {
    // Already published — idempotent re-run no-op (LBI-05). Some providers
    // confirm the side effect with a successful empty response (for example,
    // Discord can return 204), so a null remote_id is still terminal. An
    // assisted connector's skipped handoff is also terminal: the operator
    // must complete it manually rather than causing an automatic retry loop.
    return;
  }

  // The job may have been claimed before an operator postponed the target.
  // Recheck the authoritative schedule under its lock before provider I/O;
  // updating only a ready job's run_after cannot cover that claim race.
  if (!target.remoteId && target.scheduledFor) {
    const delayMs = new Date(target.scheduledFor).getTime() - Date.now();
    if (delayMs > 0) {
      throw new ParkJobError('publish.target: target rescheduled into the future', delayMs);
    }
  }

  const bundles = await tx
    .select()
    .from(schema.contentBundle)
    .where(
      and(eq(schema.contentBundle.id, target.bundleId), eq(schema.contentBundle.orgId, job.org_id)),
    )
    .limit(1);
  if (bundles.length === 0) throw new Error(`publish.target: bundle ${target.bundleId} not found`);
  const bundle = bundles[0];
  if (bundle.state !== 'approved') {
    throw new Error(
      `publish.target: bundle ${target.bundleId} is ${bundle.state}; publishing requires approved state`,
    );
  }

  const tosScanState = await getTosScanState(tx, job.org_id, target.bundleId);
  if (tosScanState === 'pending') {
    throw new ParkJobError(
      `publish.target: ToS scan for bundle ${target.bundleId} is still running`,
      PENDING_PUBLISH_RETRY_MS,
    );
  }
  if (tosScanState !== 'completed') {
    throw new Error(
      `publish.target: ToS scan for bundle ${target.bundleId} is ${tosScanState}; refusing provider dispatch`,
    );
  }

  // Defense-in-depth for every producer of post_targets, including MCP and
  // operator tooling: no connector call is allowed without a complete,
  // passing ToS report for the exact destination.
  if (!tosReportPassesForPlatforms(bundle.tosReport, [target.platform])) {
    throw new Error(
      `publish.target: ToS check unavailable or not passing for ${target.platform}; refusing provider dispatch`,
    );
  }

  const models = await tx
    .select()
    .from(schema.modelProfile)
    .where(
      and(eq(schema.modelProfile.id, bundle.modelId), eq(schema.modelProfile.orgId, job.org_id)),
    )
    .limit(1);
  if (models.length === 0) throw new Error(`publish.target: model ${bundle.modelId} not found`);
  const model = models[0];

  // Compliance interlock (LBI-12): re-check immediately before the first
  // media-plane or provider call so records revoked after approval cannot
  // publish. A missing/expired set remains retryable for operator repair and
  // is surfaced through the normal DLQ/incident view.
  const consent = await getPublishingConsentStatus(tx, job.org_id, model.id, target.platform);
  if (!consent.ok) {
    throw new Error(consentRequirementMessage(consent, target.platform));
  }

  // 2. Idempotency ledger (L3.4 §4).
  const idemKeyHex = (target.idemKey as unknown as Buffer | null)
    ? Buffer.from(target.idemKey as unknown as Uint8Array).toString('hex')
    : null;
  if (idemKeyHex) {
    const ledger = await tx
      .select()
      .from(schema.idempotencyLedger)
      .where(
        and(
          eq(schema.idempotencyLedger.orgId, job.org_id),
          eq(schema.idempotencyLedger.idemKey, idemKeyHex),
        ),
      )
      .limit(1);
    if (ledger.length > 0) {
      // Key hit — return stored result without any platform call.
      const stored = (ledger[0].responseHash ?? '') as string;
      await tx
        .update(schema.postTarget)
        .set({ state: 'published', remoteId: stored || null, error: null })
        .where(and(eq(schema.postTarget.id, targetId), eq(schema.postTarget.orgId, job.org_id)));
      return;
    }
  }

  // 3. Resolve the target's org/model/platform connection and its healthy
  // model-scoped egress client. Never fall back to deployment-wide env auth.
  const platform = asPlatform(target.platform);
  const { connection, connector } = await connectorForTarget(tx, job.org_id, model.id, {
    connectionId: target.connectionId,
    platform,
  });
  if (!target.connectionId) {
    await tx
      .update(schema.postTarget)
      .set({ connectionId: connection.id })
      .where(and(eq(schema.postTarget.id, targetId), eq(schema.postTarget.orgId, job.org_id)));
  }
  const caption = (bundle.captions as Record<string, string> | null)?.[platform] ?? '';
  const hashtags = (bundle.hashtags as string[] | null) ?? [];
  const assets = bundle.assetId
    ? await tx
        .select({
          id: schema.asset.id,
          orgId: schema.asset.orgId,
          modelId: schema.asset.modelId,
          kind: schema.asset.kind,
          storageKey: schema.asset.storageKey,
        })
        .from(schema.asset)
        .where(
          and(
            eq(schema.asset.id, bundle.assetId),
            eq(schema.asset.orgId, job.org_id),
            eq(schema.asset.modelId, model.id),
          ),
        )
        .limit(1)
    : [];
  const asset = assets[0];
  const mediaKind = validatePublishAsset(asset, bundle.assetId, job.org_id, model.id);
  const mediaUrls = asset ? [resolveProviderAssetUrl(asset)] : [];

  const input = {
    idempotencyKey: idemKeyHex ?? `${bundle.id}:${platform}`,
    caption,
    mediaUrls,
    hashtags,
    scheduledFor: target.scheduledFor ? new Date(target.scheduledFor).toISOString() : undefined,
    options: {
      modelId: model.id,
      ...(target.state === 'pending' && target.remoteId ? { publishId: target.remoteId } : {}),
    },
  };

  // 3a. Pre-post stage (L2.10): Rust media-plane staging + registered hook
  // scripts, recorded in pre_post_run — before ANY connector handoff.
  const prePostInput = {
    targetId,
    bundleId: bundle.id,
    platform,
    modelId: model.id,
    caption,
    mediaUrls,
    mediaKind,
    mediaPath: asset?.storageKey,
    hashtags,
    phase: 'before' as const,
  };
  const preStage = await runPrePostBefore(ctx, prePostInput);
  const stagedInput = {
    ...preStage.input,
    // Preserve the durable target idempotency key across the pre-post
    // adapter boundary; the hook's phase key is only for hook bookkeeping.
    idempotencyKey: input.idempotencyKey,
    // Pre-post hooks intentionally expose only their public input shape. Keep
    // the persisted TikTok publish_id across a pending-status retry.
    options: {
      ...(preStage.input.options ?? {}),
      ...(target.state === 'pending' && target.remoteId ? { publishId: target.remoteId } : {}),
    },
  };

  // The media plane receives the persisted local path above, while connectors
  // receive the provider-facing delivery URL resolved before staging.
  assertProviderReadableMediaUrls(stagedInput.mediaUrls, bundle.assetId);

  const validation = await connector.validate(stagedInput);
  if (!validation.valid) {
    throw new Error(
      `publish.target: validation failed for ${platform}: ${validation.errors.map((e) => e.message).join('; ')}`,
    );
  }

  // A marker left in its initial state means a previous worker may have
  // reached the provider and died before committing the target result. Treat
  // that outcome as unknown and dead-letter for reconciliation; never issue a
  // blind second provider call. Legitimate asynchronous provider results use
  // the distinct `provider-pending` state below and remain retryable.
  const unresolvedDispatch = await tx
    .select({ id: schema.prePostRun.id })
    .from(schema.prePostRun)
    .where(
      and(
        eq(schema.prePostRun.orgId, job.org_id),
        eq(schema.prePostRun.targetId, targetId),
        eq(schema.prePostRun.script, 'publish.dispatch'),
        eq(schema.prePostRun.status, 'pending'),
      ),
    )
    .limit(1);
  if (unresolvedDispatch.length > 0) {
    ctx.markExternalSideEffect?.();
    throw new Error(
      `publish.target: unresolved dispatch marker ${unresolvedDispatch[0].id}; provider reconciliation required before retry`,
    );
  }

  // Commit an independent reconciliation anchor before provider I/O. If the
  // provider accepts the post and this executor process crashes before its
  // transaction commits, the pending marker survives stale-job recovery and
  // tells operators that the target requires provider reconciliation instead
  // of an unsafe blind retry.
  const persistSideEffectMarker: NonNullable<ExecutorContext['persistSideEffectMarker']> =
    ctx.persistSideEffectMarker ??
    (async <T>(operation: (markerTx: any) => Promise<T>): Promise<T> => operation(tx));
  const [dispatchMarker] = await persistSideEffectMarker<Array<{ id: string }>>((markerTx) =>
    markerTx
      .insert(schema.prePostRun)
      .values(
        publishDispatchMarkerValues(job.org_id, model.id, targetId, platform, input.idempotencyKey),
      )
      .returning({ id: schema.prePostRun.id }),
  );
  if (!dispatchMarker?.id) {
    throw new Error('publish.target: dispatch marker insert returned no id');
  }

  // From this point onward the provider may have accepted the request. If
  // local persistence fails after this call, the worker must not retry the
  // target automatically because that can double-post.
  ctx.markExternalSideEffect?.();
  const result = await connector.publish(stagedInput);

  if (result.state === 'pending') {
    await tx
      .update(schema.prePostRun)
      .set({
        status: 'provider-pending',
        output: { state: result.state, remoteId: result.remoteId },
        error: result.error ?? null,
      })
      .where(
        and(eq(schema.prePostRun.id, dispatchMarker.id), eq(schema.prePostRun.orgId, job.org_id)),
      );
    await tx
      .update(schema.postTarget)
      .set({ state: 'pending', remoteId: result.remoteId, error: result.error ?? null })
      .where(and(eq(schema.postTarget.id, targetId), eq(schema.postTarget.orgId, job.org_id)));

    // The current job already owns the canonical publish.target dedupe key.
    // Use the source job ID for the successor key so exactly one retry is
    // created for this pending attempt without preventing later status polls.
    await enqueueJob(tx, {
      orgId: job.org_id,
      queue: 'publish',
      kind: 'publish.target',
      payload: { targetId },
      runAfter: new Date(Date.now() + PENDING_PUBLISH_RETRY_MS),
      maxAttempts: job.max_attempts,
      dedupeParts: ['publish.target.retry', targetId, job.id],
    });
    return;
  }

  if (result.state === 'skipped') {
    await tx
      .update(schema.prePostRun)
      .set({
        status: 'skipped',
        output: { state: result.state, remoteId: result.remoteId },
        error: result.error ?? null,
        finishedAt: new Date(),
      })
      .where(
        and(eq(schema.prePostRun.id, dispatchMarker.id), eq(schema.prePostRun.orgId, job.org_id)),
      );
    // Assisted connectors intentionally have no provider remote ID. Persist
    // the handoff as terminal so the worker marks the job done and does not
    // retry the same operator action as though it were a failed API call.
    await tx
      .update(schema.postTarget)
      .set({ state: 'skipped', remoteId: result.remoteId, error: result.error ?? null })
      .where(and(eq(schema.postTarget.id, targetId), eq(schema.postTarget.orgId, job.org_id)));
    return;
  }

  if (result.state !== 'published') {
    throw new Error(`publish.target: connector publish failed: ${result.error ?? 'no remote_id'}`);
  }

  await tx
    .update(schema.prePostRun)
    .set({
      status: 'success',
      output: { state: result.state, remoteId: result.remoteId },
      error: null,
      finishedAt: new Date(),
    })
    .where(
      and(eq(schema.prePostRun.id, dispatchMarker.id), eq(schema.prePostRun.orgId, job.org_id)),
    );

  // 3b. Post-publish hook (recorded in pre_post_run; fire-and-forget hooks).
  await runPrePostAfter(ctx, { ...prePostInput, phase: 'after' }, result);

  // 4. Mark published + write idempotency ledger in the SAME txn (L3.4 §4).
  await tx
    .update(schema.postTarget)
    .set({ state: 'published', remoteId: result.remoteId, error: null })
    .where(and(eq(schema.postTarget.id, targetId), eq(schema.postTarget.orgId, job.org_id)));

  if (idemKeyHex) {
    await tx
      .insert(schema.idempotencyLedger)
      .values({
        orgId: job.org_id,
        idemKey: idemKeyHex,
        responseHash: result.remoteId,
        locked: false,
      })
      .onConflictDoNothing();
  }

  // 5. Enqueue metrics.poll only when the provider returned a remote ID and
  // declared metrics. A successful empty response is terminal, but there is
  // no provider resource to query (Discord webhook execution with a 204
  // response is one example).
  if (shouldEnqueueMetrics(result.remoteId, connector.capability().metrics)) {
    const runAfter = new Date(Date.now() + 60_000); // first poll ~1 min after publish
    await enqueueJob(tx, {
      orgId: job.org_id,
      queue: 'metrics',
      kind: 'metrics.poll',
      payload: { targetId },
      runAfter,
      maxAttempts: job.max_attempts,
      dedupeParts: ['metrics.poll', targetId, job.id],
    });
  }
};
