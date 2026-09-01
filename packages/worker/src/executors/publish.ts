// ─── publish.target executor (L3.4 §2, L2.0 canonical flow) ───
// One job per platform target. Inside the txn:
//  1. Kill-switch gate — publishing_enabled=false ⇒ park (L3.4 §5).
//  2. Idempotency ledger — key hit ⇒ return stored result, no platform call.
//  3. connector.publish() via the target's encrypted platform connection.
//  4. post_target → published + remote_id, idempotency ledger row — same txn.
//  5. Enqueue metrics.poll for the published target (L2.8 §1).

import { eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { asPlatform, connectorForTarget } from '../connection.js';
import { ParkJobError } from './context.js';
import { runPrePostBefore, runPrePostAfter } from './pre_post.js';
import type { Executor, ExecutorContext } from './context.js';

const KILL_SWITCH_PARK_MS = 60_000;
const PENDING_PUBLISH_RETRY_MS = 60_000;

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
    .where(eq(schema.postTarget.id, targetId))
    .limit(1);
  if (targets.length === 0) throw new Error(`publish.target: target ${targetId} not found`);
  const target = targets[0];
  if (target.state === 'published') {
    // Already published — idempotent re-run no-op (LBI-05). Some providers
    // confirm the side effect with a successful empty response (for example,
    // Discord can return 204), so a null remote_id is still terminal.
    return;
  }

  const bundles = await tx
    .select()
    .from(schema.contentBundle)
    .where(eq(schema.contentBundle.id, target.bundleId))
    .limit(1);
  if (bundles.length === 0) throw new Error(`publish.target: bundle ${target.bundleId} not found`);
  const bundle = bundles[0];

  const models = await tx
    .select()
    .from(schema.modelProfile)
    .where(eq(schema.modelProfile.id, bundle.modelId))
    .limit(1);
  if (models.length === 0) throw new Error(`publish.target: model ${bundle.modelId} not found`);
  const model = models[0];

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
        .where(eq(schema.postTarget.id, targetId));
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
      .where(eq(schema.postTarget.id, targetId));
  }
  const caption = (bundle.captions as Record<string, string> | null)?.[platform] ?? '';
  const hashtags = (bundle.hashtags as string[] | null) ?? [];
  const mediaUrls = bundle.assetId ? [`asset://${bundle.assetId}`] : [];

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

  const validation = await connector.validate(stagedInput);
  if (!validation.valid) {
    throw new Error(
      `publish.target: validation failed for ${platform}: ${validation.errors.map((e) => e.message).join('; ')}`,
    );
  }

  const result = await connector.publish(stagedInput);

  if (result.state === 'pending') {
    await tx
      .update(schema.postTarget)
      .set({ state: 'pending', remoteId: result.remoteId, error: result.error ?? null })
      .where(eq(schema.postTarget.id, targetId));

    await tx.insert(schema.job).values({
      orgId: job.org_id,
      queue: 'publish',
      kind: 'publish.target',
      payload: { targetId },
      state: 'ready',
      runAfter: new Date(Date.now() + PENDING_PUBLISH_RETRY_MS),
    });
    return;
  }

  if (result.state === 'failed' || (result.state !== 'published' && !result.remoteId)) {
    throw new Error(`publish.target: connector publish failed: ${result.error ?? 'no remote_id'}`);
  }

  // 3b. Post-publish hook (recorded in pre_post_run; fire-and-forget hooks).
  await runPrePostAfter(ctx, prePostInput, result);

  // 4. Mark published + write idempotency ledger in the SAME txn (L3.4 §4).
  await tx
    .update(schema.postTarget)
    .set({ state: 'published', remoteId: result.remoteId, error: null })
    .where(eq(schema.postTarget.id, targetId));

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

  // 5. Enqueue metrics.poll only when the provider returned a remote ID. A
  // successful empty response is terminal, but there is no provider resource
  // to query (Discord webhook execution with a 204 response is one example).
  if (result.remoteId) {
    const runAfter = new Date(Date.now() + 60_000); // first poll ~1 min after publish
    await tx
      .insert(schema.job)
      .values({
        orgId: job.org_id,
        queue: 'metrics',
        kind: 'metrics.poll',
        payload: { targetId },
        state: 'ready',
        runAfter,
      })
      .onConflictDoNothing();
  }
};
