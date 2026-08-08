// ─── relay.card executor (L3.4 §2, L3.3) ───
// Pushes an approval card for a generated bundle to the model's bound channel
// (relay_binding). Renders via CardRenderer and dispatches through the channel
// adapter. Commands never publish directly — this is the operator-decision step.

import { eq, and } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { CardRenderer, TelegramAdapter, DiscordAdapter } from '@axiom/relay';
import type { BundleContent } from '@axiom/relay';
import { ParkJobError } from './context.js';
import type { Executor, ExecutorContext } from './context.js';

const NO_BINDING_PARK_MS = 5 * 60_000;

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
    .where(eq(schema.contentBundle.id, bundleId))
    .limit(1);
  if (bundles.length === 0) throw new Error(`relay.card: bundle ${bundleId} not found`);
  const bundle = bundles[0];

  // Resolve the model's relay binding (which channel receives cards).
  const bindings = await tx
    .select()
    .from(schema.relayBinding)
    .where(
      and(
        eq(schema.relayBinding.modelId, bundle.modelId),
        eq(schema.relayBinding.enabled, true),
        ...(payload.channel ? [eq(schema.relayBinding.channel, payload.channel)] : []),
      ),
    )
    .limit(1);

  if (bindings.length === 0) {
    // Fail-safe (L3.3 §5): no reachable channel → stay generated, never auto-publish.
    throw new ParkJobError(
      `relay.card: no relay binding for model ${bundle.modelId}`,
      NO_BINDING_PARK_MS,
    );
  }
  const binding = bindings[0];

  const tosReport = (bundle.tosReport as Record<string, unknown> | null) ?? {};
  const captions = (bundle.captions as Record<string, string> | null) ?? {};
  const content: BundleContent = {
    id: bundle.id,
    mediaUrls: [],
    caption: captions[binding.channel] ?? captions['instagram'] ?? '',
    captionVariants: captions,
    hashtagSets: { [binding.channel]: (bundle.hashtags as string[]) ?? [] },
    tosScores: Object.fromEntries(
      Object.entries((tosReport.scores as Array<{ platform: string; score: number }>) ?? []).map(
        ([, s]) => [s.platform, s.score / 100],
      ),
    ),
    targetPlatforms: Object.keys(captions).length > 0 ? Object.keys(captions) : ['instagram'],
  };
  const renderer = new CardRenderer();
  const card = renderer.renderBundleCard(content);

  // Dispatch through the configured channel adapter.
  const chatRef = binding.chatRef;
  if (!chatRef) throw new Error(`relay.card: binding ${binding.id} has no chat_ref`);

  switch (binding.channel) {
    case 'telegram': {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) throw new Error('relay.card: TELEGRAM_BOT_TOKEN not configured');
      const adapter = new TelegramAdapter({ token });
      await adapter.sendCard(chatRef, card);
      break;
    }
    case 'discord': {
      const token = process.env.DISCORD_BOT_TOKEN;
      const clientId = process.env.DISCORD_APPLICATION_ID;
      if (!token || !clientId) throw new Error('relay.card: Discord bot env not configured');
      const adapter = new DiscordAdapter({ token, clientId });
      await adapter.sendCard(chatRef, card);
      break;
    }
    default:
      throw new Error(`relay.card: channel '${binding.channel}' dispatch not implemented`);
  }
};
