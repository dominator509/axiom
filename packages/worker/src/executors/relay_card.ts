// ─── relay.card executor (L3.4 §2, L3.3) ───
// Pushes an approval card for a generated bundle to the model's bound channel
// (relay_binding). Renders via CardRenderer and dispatches through the channel
// adapter. Commands never publish directly — this is the operator-decision step.

import { eq, and } from 'drizzle-orm';
import { resolveRelaySecret } from '@axiom/core';
import { schema } from '@axiom/db';
import {
  CardRenderer,
  CommandRouter,
  DiscordAdapter,
  IMessageAdapter,
  SignalAdapter,
  TelegramAdapter,
} from '@axiom/relay';
import type { BundleContent } from '@axiom/relay';
import { ParkJobError } from './context.js';
import { resolveProviderAssetUrl, validatePublishAsset } from './publish.js';
import type { Executor, ExecutorContext } from './context.js';

const NO_BINDING_PARK_MS = 5 * 60_000;

type RelayBindingForDispatch = {
  id: string;
  channel: string;
  chatRef: string | null;
};

const SUPPORTED_RELAY_CHANNELS = new Set(['telegram', 'discord', 'signal', 'imessage']);

/**
 * Validate every binding before the first provider side effect. A relay job
 * can fan out to several bindings; discovering a bad later binding after an
 * earlier adapter already sent its card would make the outer transaction roll
 * back and retry the earlier external send.
 */
export function assertRelayBindingDispatchable(
  binding: RelayBindingForDispatch,
  env: Record<string, string | undefined> = process.env,
): string {
  const channel = binding.channel.trim().toLowerCase();
  if (!SUPPORTED_RELAY_CHANNELS.has(channel)) {
    throw new Error(`relay.card: channel '${binding.channel}' dispatch not implemented`);
  }
  if (!binding.chatRef?.trim()) {
    throw new Error(`relay.card: binding ${binding.id} has no chat_ref`);
  }

  switch (channel) {
    case 'telegram':
      if (!env.TELEGRAM_BOT_TOKEN) {
        throw new Error('relay.card: TELEGRAM_BOT_TOKEN not configured');
      }
      break;
    case 'discord':
      if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APPLICATION_ID) {
        throw new Error('relay.card: Discord bot env not configured');
      }
      break;
    case 'signal':
      if (!env.SIGNAL_CLI_PATH || !env.SIGNAL_ACCOUNT) {
        throw new Error('relay.card: Signal CLI env not configured');
      }
      break;
    case 'imessage':
      if (!env.BLUEBUBBLES_URL || !(env.BLUEBUBBLES_PASSWORD ?? env.BLUEBUBBLES_API_KEY)) {
        throw new Error('relay.card: BlueBubbles env not configured');
      }
      break;
  }

  return channel;
}

export const relayCard: Executor = async (ctx: ExecutorContext) => {
  const { tx, job, killSwitchEnabled } = ctx;
  const payload = (job.payload ?? {}) as { bundleId?: string; channel?: string };
  const bundleId = payload.bundleId;
  if (!bundleId) throw new Error('relay.card: payload.bundleId required');

  // Kill switch also gates card dispatch (L3.4 §5: every *.card worker).
  if (killSwitchEnabled) {
    throw new ParkJobError('relay.card: kill switch enabled — parked', 60_000);
  }

  const bundles = await tx
    .select()
    .from(schema.contentBundle)
    .where(and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, job.org_id)))
    .limit(1);
  if (bundles.length === 0) throw new Error(`relay.card: bundle ${bundleId} not found`);
  const bundle = bundles[0];

  // A parked card can outlive the operator's dashboard decision. Do not send
  // another approval request for content that has left the decision stage.
  // Revision completion enqueues a fresh scan/card, so the old card job can
  // also finish while caption revision is in progress.
  switch (bundle.state) {
    case 'generated':
    case 'hold':
      break;
    case 'approved':
    case 'scheduled':
    case 'publishing':
    case 'published':
    case 'rejected':
    case 'revising':
      return;
    default:
      throw new Error('relay.card: unknown bundle lifecycle state; refusing dispatch');
  }

  // Approval cards must show the same provider-readable preview that the
  // publish executor will use. Resolve it before inserting a relay card or
  // calling an external channel so an invalid or cross-tenant asset fails
  // closed without leaving a dispatchable pending card behind.
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
            eq(schema.asset.modelId, bundle.modelId),
          ),
        )
        .limit(1)
    : [];
  const asset = assets[0];
  validatePublishAsset(asset, bundle.assetId, job.org_id, bundle.modelId);
  const mediaUrls = asset ? [resolveProviderAssetUrl(asset)] : [];

  // Resolve the model's relay binding (which channel receives cards).
  const bindings = await tx
    .select()
    .from(schema.relayBinding)
    .where(
      and(
        eq(schema.relayBinding.orgId, job.org_id),
        eq(schema.relayBinding.modelId, bundle.modelId),
        eq(schema.relayBinding.enabled, true),
        ...(payload.channel ? [eq(schema.relayBinding.channel, payload.channel)] : []),
      ),
    );

  if (bindings.length === 0) {
    // Fail-safe (L3.3 §5): no reachable channel → stay generated, never auto-publish.
    throw new ParkJobError(
      `relay.card: no relay binding for model ${bundle.modelId}`,
      NO_BINDING_PARK_MS,
    );
  }
  const dispatchBindings = bindings.map((binding: RelayBindingForDispatch) => ({
    binding,
    channel: assertRelayBindingDispatchable(binding),
    // The preflight above rejects null/blank refs; the fallback only satisfies
    // TypeScript because the DB transaction row is intentionally untyped.
    chatRef: binding.chatRef?.trim() ?? '',
  }));
  const commandRouter = new CommandRouter(resolveRelaySecret(process.env));

  const tosReport = (bundle.tosReport as Record<string, unknown> | null) ?? {};
  const captions = (bundle.captions as Record<string, string> | null) ?? {};
  const scores =
    (tosReport.scores as Array<{
      platform: string;
      score: number;
      verdict?: string;
    }>) ?? [];
  // evaluateTextToS stores a risk score (0 is safe, 100 is risky), while the
  // relay renderer consumes a safety score (1 is safe, 0 is unsafe).
  const tosScores = Object.fromEntries(
    scores.map((score) => {
      const rawRisk = Number(score.score);
      const safety =
        score.verdict === 'block'
          ? 0
          : score.verdict === 'review'
            ? 0.5
            : Number.isFinite(rawRisk)
              ? Math.max(0, Math.min(1, 1 - rawRisk / 100))
              : 0;
      return [score.platform, safety];
    }),
  );
  const targetPlatforms = Object.keys(captions).length > 0 ? Object.keys(captions) : ['instagram'];
  const primaryPlatform = targetPlatforms[0] ?? 'instagram';
  const primaryCaption = captions[primaryPlatform] ?? Object.values(captions)[0] ?? '';
  const hashtagSets = Object.fromEntries(
    targetPlatforms.map((platform) => [platform, (bundle.hashtags as string[]) ?? []]),
  );
  const renderer = new CardRenderer();
  for (const { binding, channel, chatRef } of dispatchBindings) {
    // A pending relay row is durable evidence that an earlier worker may
    // already have handed this exact card to the provider. The provider does
    // not expose a portable idempotency key across Telegram, Discord, Signal,
    // and BlueBubbles, so a retry cannot safely send the card again. Leave the
    // row available for operator reconciliation and dead-letter the job rather
    // than creating a duplicate approval prompt.
    const unresolvedRelayCard = await tx
      .select({ id: schema.relayCard.id })
      .from(schema.relayCard)
      .where(
        and(
          eq(schema.relayCard.orgId, job.org_id),
          eq(schema.relayCard.bundleId, bundle.id),
          eq(schema.relayCard.channel, channel),
          eq(schema.relayCard.externalRef, chatRef),
          eq(schema.relayCard.state, 'pending'),
        ),
      )
      .limit(1);
    if (unresolvedRelayCard.length > 0) {
      ctx.markExternalSideEffect?.();
      throw new Error(
        `relay.card: unresolved dispatch marker ${unresolvedRelayCard[0].id}; provider reconciliation required before retry`,
      );
    }

    // Commit the dispatch log before provider I/O. If the provider accepts the
    // card and the executor transaction later rolls back, the pending row is
    // still available to reconcile the unknown external outcome.
    const persistSideEffectMarker: NonNullable<ExecutorContext['persistSideEffectMarker']> =
      ctx.persistSideEffectMarker ??
      (async <T>(operation: (markerTx: any) => Promise<T>): Promise<T> => operation(tx));
    const [relayCardRow] = await persistSideEffectMarker<Array<{ id: string }>>((markerTx) =>
      markerTx
        .insert(schema.relayCard)
        .values({
          orgId: job.org_id,
          bundleId: bundle.id,
          channel,
          externalRef: chatRef,
          state: 'pending',
          title: `Bundle approval — ${bundle.id}`,
          description: captions['instagram'] ?? Object.values(captions)[0] ?? '',
          config: { targetPlatforms, tosScores, revisionId: tosReport.revisionId ?? null },
        })
        // The pending-dispatch partial unique index is the concurrency guard
        // for jobs that race after the read above. A losing insert must not
        // proceed without its own durable marker.
        .onConflictDoNothing()
        .returning({ id: schema.relayCard.id }),
    );
    if (!relayCardRow?.id) {
      ctx.markExternalSideEffect?.();
      throw new Error(
        `relay.card: concurrent dispatch marker already exists for ${bundle.id}/${channel}/${chatRef}; provider reconciliation required before retry`,
      );
    }

    const content: BundleContent = {
      id: bundle.id,
      cardId: relayCardRow.id,
      mediaUrls,
      // Relay channel names are transport bindings, not target-platform keys.
      // Use the selected platform caption so a TikTok-only (or any
      // non-Instagram-only) bundle is not rendered as an empty approval card.
      caption: captions[channel] ?? captions[primaryPlatform] ?? primaryCaption,
      captionVariants: captions,
      hashtagSets,
      tosScores,
      targetPlatforms,
    };
    const card = renderer.renderBundleCard(content);
    card.commandTokens = Object.fromEntries(
      card.actions.map((action) => [
        action,
        commandRouter.createCommandToken(action, relayCardRow.id),
      ]),
    );

    // Dispatch through the configured channel adapter.

    switch (channel) {
      case 'telegram': {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) throw new Error('relay.card: TELEGRAM_BOT_TOKEN not configured');
        const adapter = new TelegramAdapter({ token });
        ctx.markExternalSideEffect?.();
        await adapter.sendCard(chatRef, card);
        break;
      }
      case 'discord': {
        const token = process.env.DISCORD_BOT_TOKEN;
        const clientId = process.env.DISCORD_APPLICATION_ID;
        if (!token || !clientId) throw new Error('relay.card: Discord bot env not configured');
        const adapter = new DiscordAdapter({ token, clientId });
        // Worker relay jobs construct a short-lived adapter instead of using
        // the API process's long-lived gateway client. Authenticate that
        // client before resolving the channel, then tear it down after the
        // one-shot send so the worker neither dispatches anonymously nor
        // leaks a gateway connection per job.
        try {
          await adapter.login();
          ctx.markExternalSideEffect?.();
          await adapter.sendCard(chatRef, card);
        } finally {
          adapter.getClient().destroy();
        }
        break;
      }
      case 'signal': {
        const cliPath = process.env.SIGNAL_CLI_PATH;
        const account = process.env.SIGNAL_ACCOUNT;
        if (!cliPath || !account) throw new Error('relay.card: Signal CLI env not configured');
        const adapter = new SignalAdapter({ cliPath, account });
        ctx.markExternalSideEffect?.();
        await adapter.sendCard(chatRef, card);
        break;
      }
      case 'imessage': {
        const blueBubblesUrl = process.env.BLUEBUBBLES_URL;
        const password = process.env.BLUEBUBBLES_PASSWORD ?? process.env.BLUEBUBBLES_API_KEY;
        if (!blueBubblesUrl || !password) {
          throw new Error('relay.card: BlueBubbles env not configured');
        }
        const adapter = new IMessageAdapter({ blueBubblesUrl, password });
        ctx.markExternalSideEffect?.();
        await adapter.sendCard(chatRef, card);
        break;
      }
      default:
        throw new Error(`relay.card: channel '${binding.channel}' dispatch not implemented`);
    }

    await tx
      .update(schema.relayCard)
      .set({ state: 'sent' })
      .where(and(eq(schema.relayCard.id, relayCardRow.id), eq(schema.relayCard.orgId, job.org_id)));
  }
};
