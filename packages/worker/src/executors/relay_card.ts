// ─── relay.card executor (L3.4 §2, L3.3) ───
// Pushes an approval card for a generated bundle to the model's bound channel
// (relay_binding). Renders via CardRenderer and dispatches through the channel
// adapter. Commands never publish directly — this is the operator-decision step.

import { eq, and } from 'drizzle-orm';
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

  if (bindings.length === 0) {
    // Fail-safe (L3.3 §5): no reachable channel → stay generated, never auto-publish.
    throw new ParkJobError(
      `relay.card: no relay binding for model ${bundle.modelId}`,
      NO_BINDING_PARK_MS,
    );
  }
  const relaySecret = process.env.RELAY_SECRET;
  if (process.env.NODE_ENV === 'production' && !relaySecret) {
    throw new Error('relay.card: RELAY_SECRET is required in production');
  }
  const commandRouter = new CommandRouter(relaySecret || 'axiom-dev-secret');

  const tosReport = (bundle.tosReport as Record<string, unknown> | null) ?? {};
  const captions = (bundle.captions as Record<string, string> | null) ?? {};
  const scores = (tosReport.scores as Array<{
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
  const renderer = new CardRenderer();
  for (const binding of bindings) {
    const channel = binding.channel.toLowerCase();
    const chatRef = binding.chatRef;
    if (!chatRef) throw new Error(`relay.card: binding ${binding.id} has no chat_ref`);

    const [relayCardRow] = await tx
      .insert(schema.relayCard)
      .values({
        orgId: job.org_id,
        bundleId: bundle.id,
        channel,
        externalRef: chatRef,
        state: 'pending',
        title: `Bundle approval — ${bundle.id}`,
        description: captions['instagram'] ?? Object.values(captions)[0] ?? '',
        config: { targetPlatforms, tosScores },
      })
      .returning({ id: schema.relayCard.id });
    if (!relayCardRow?.id) throw new Error('relay.card: relay card insert returned no id');

    const content: BundleContent = {
      id: bundle.id,
      cardId: relayCardRow.id,
      mediaUrls: [],
      caption: captions[channel] ?? captions['instagram'] ?? '',
      captionVariants: captions,
      hashtagSets: { [channel]: (bundle.hashtags as string[]) ?? [] },
      tosScores,
      targetPlatforms,
    };
    const card = renderer.renderBundleCard(content);
    card.commandTokens = Object.fromEntries(
      card.actions.map((action) => [action, commandRouter.createCommandToken(action, relayCardRow.id)]),
    );

    // Dispatch through the configured channel adapter.

    switch (channel) {
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
      case 'signal': {
        const cliPath = process.env.SIGNAL_CLI_PATH;
        const account = process.env.SIGNAL_ACCOUNT;
        if (!cliPath || !account) throw new Error('relay.card: Signal CLI env not configured');
        const adapter = new SignalAdapter({ cliPath, account });
        await adapter.sendCard(chatRef, card);
        break;
      }
      case 'imessage': {
        const blueBubblesUrl = process.env.BLUEBUBBLES_URL;
        const apiKey = process.env.BLUEBUBBLES_API_KEY;
        if (!blueBubblesUrl || !apiKey) {
          throw new Error('relay.card: BlueBubbles env not configured');
        }
        const adapter = new IMessageAdapter({ blueBubblesUrl, apiKey });
        await adapter.sendCard(chatRef, card);
        break;
      }
      default:
        throw new Error(`relay.card: channel '${binding.channel}' dispatch not implemented`);
    }

    await tx
      .update(schema.relayCard)
      .set({ state: 'sent' })
      .where(eq(schema.relayCard.id, relayCardRow.id));
  }
};
