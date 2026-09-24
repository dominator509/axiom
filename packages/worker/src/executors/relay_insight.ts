// ─── Model-scoped viral insight Relay dispatch (F-85, L2.7/L2.8) ─────────
// The viral.insight executor stores an internal evidence card. This executor
// is the separate provider boundary: it resolves the model's enabled Relay
// bindings, commits one pending marker per destination before I/O, and only
// marks that marker sent after the adapter resolves.

import { and, eq, isNotNull } from 'drizzle-orm';
import { schema } from '@axiom/db';
import {
  CardRenderer,
  DiscordAdapter,
  IMessageAdapter,
  SignalAdapter,
  TelegramAdapter,
} from '@axiom/relay';
import type { InsightGroup, RelayCard } from '@axiom/relay';
import { ParkJobError } from './context.js';
import type { ExecutorContext } from './context.js';
import { assertRelayBindingDispatchable, type RelayBindingForDispatch } from './relay_policy.js';

const NO_BINDING_PARK_MS = 5 * 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StoredInsightCard = {
  id: string;
  orgId: string;
  modelId: string | null;
  channel: string | null;
  externalRef: string | null;
  state: string;
  title: string;
  description: string | null;
  icon: string | null;
  priority: number;
  config: Record<string, unknown> | null;
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function insightGroups(card: StoredInsightCard): InsightGroup[] {
  const config = recordOf(card.config);
  const viralInsight = recordOf(config?.viralInsight);
  const rawGroups = viralInsight?.groups;
  if (!Array.isArray(rawGroups)) throw new Error('relay.insight: source card has no evidence groups');

  const groups = rawGroups.map((raw): InsightGroup | null => {
    const row = recordOf(raw);
    if (!row) return null;
    const platform = boundedString(row.platform, 48);
    const learningArm = boundedString(row.learningArm, 96);
    const learningContext = boundedString(row.learningContext, 96);
    const sampleSize = Number(row.sampleSize);
    const meanScore = Number(row.meanScore);
    const publishedHourUtc = row.publishedHourUtc == null ? null : Number(row.publishedHourUtc);
    if (!platform || !learningArm || !learningContext || !Number.isInteger(sampleSize) || sampleSize < 3
      || !Number.isFinite(meanScore)
      || (publishedHourUtc !== null && (!Number.isInteger(publishedHourUtc) || publishedHourUtc < 0 || publishedHourUtc > 23))) {
      return null;
    }
    return { platform, learningArm, learningContext, sampleSize, meanScore, publishedHourUtc };
  }).filter((group): group is InsightGroup => group !== null);
  if (groups.length === 0) throw new Error('relay.insight: source card has no valid evidence groups');
  return groups;
}

function asDispatchBinding(binding: RelayBindingForDispatch, channel: string) {
  return { binding, channel, chatRef: binding.chatRef?.trim() ?? '' };
}

async function sendInsightCard(
  channel: string,
  chatRef: string,
  card: RelayCard,
  ctx: ExecutorContext,
): Promise<void> {
  switch (channel) {
    case 'telegram': {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) throw new Error('relay.insight: TELEGRAM_BOT_TOKEN not configured');
      const adapter = new TelegramAdapter({ token });
      ctx.markExternalSideEffect?.();
      await adapter.sendCard(chatRef, card);
      return;
    }
    case 'discord': {
      const token = process.env.DISCORD_BOT_TOKEN;
      const clientId = process.env.DISCORD_APPLICATION_ID;
      if (!token || !clientId) throw new Error('relay.insight: Discord bot env not configured');
      const adapter = new DiscordAdapter({ token, clientId });
      try {
        await adapter.login();
        ctx.markExternalSideEffect?.();
        await adapter.sendCard(chatRef, card);
      } finally {
        adapter.getClient().destroy();
      }
      return;
    }
    case 'signal': {
      const cliPath = process.env.SIGNAL_CLI_PATH;
      const account = process.env.SIGNAL_ACCOUNT;
      if (!cliPath || !account) throw new Error('relay.insight: Signal CLI env not configured');
      const adapter = new SignalAdapter({ cliPath, account });
      ctx.markExternalSideEffect?.();
      await adapter.sendCard(chatRef, card);
      return;
    }
    case 'imessage': {
      const blueBubblesUrl = process.env.BLUEBUBBLES_URL;
      const password = process.env.BLUEBUBBLES_PASSWORD ?? process.env.BLUEBUBBLES_API_KEY;
      if (!blueBubblesUrl || !password) {
        throw new Error('relay.insight: BlueBubbles env not configured');
      }
      const adapter = new IMessageAdapter({ blueBubblesUrl, password });
      ctx.markExternalSideEffect?.();
      await adapter.sendCard(chatRef, card);
      return;
    }
    default:
      throw new Error(`relay.insight: channel '${channel}' dispatch not implemented`);
  }
}

/** Dispatch one stored viral insight card to every configured model binding. */
export async function relayInsightCard(ctx: ExecutorContext, cardId: string): Promise<void> {
  const { tx, job, killSwitchEnabled } = ctx;
  if (!UUID_RE.test(cardId)) throw new Error('relay.insight: payload.cardId must be a UUID');
  if (killSwitchEnabled) throw new ParkJobError('relay.insight: kill switch enabled — parked', 60_000);

  const rows = await tx
    .select()
    .from(schema.relayCard)
    .where(and(
      eq(schema.relayCard.id, cardId),
      eq(schema.relayCard.orgId, job.org_id),
      eq(schema.relayCard.channel, 'viral_insight'),
      isNotNull(schema.relayCard.modelId),
    ))
    .limit(1)
    .for('no key update');
  const source = rows[0] as StoredInsightCard | undefined;
  if (!source) throw new Error(`relay.insight: source card ${cardId} not found`);
  if (source.state !== 'stored') return;
  if (!source.modelId || !UUID_RE.test(source.modelId)) throw new Error('relay.insight: source card has invalid model scope');
  if (!source.externalRef) throw new Error('relay.insight: source card has no external reference');

  const bindings = await tx
    .select()
    .from(schema.relayBinding)
    .where(and(
      eq(schema.relayBinding.orgId, job.org_id),
      eq(schema.relayBinding.modelId, source.modelId),
      eq(schema.relayBinding.enabled, true),
    ));
  if (bindings.length === 0) {
    throw new ParkJobError(`relay.insight: no relay binding for model ${source.modelId}`, NO_BINDING_PARK_MS);
  }

  // Validate all configured bindings before creating a marker or contacting a
  // provider. A later bad binding must not strand an earlier delivery.
  const dispatchBindings = (bindings as RelayBindingForDispatch[]).map(binding =>
    asDispatchBinding(binding, assertRelayBindingDispatchable(binding)),
  );
  const groups = insightGroups(source);
  const renderer = new CardRenderer();
  const persistSideEffectMarker: NonNullable<ExecutorContext['persistSideEffectMarker']> =
    ctx.persistSideEffectMarker ?? (async <T>(operation: (markerTx: any) => Promise<T>): Promise<T> => operation(tx));

  for (const { binding, channel, chatRef } of dispatchBindings) {
    const externalRef = `${source.externalRef}:binding:${binding.id}`;
    const existing = await tx
      .select({ id: schema.relayCard.id, state: schema.relayCard.state })
      .from(schema.relayCard)
      .where(and(
        eq(schema.relayCard.orgId, job.org_id),
        eq(schema.relayCard.modelId, source.modelId),
        eq(schema.relayCard.channel, channel),
        eq(schema.relayCard.externalRef, externalRef),
      ))
      .limit(1);
    const priorState = existing[0]?.state as string | undefined;
    if (priorState === 'sent') continue;
    if (priorState === 'pending' || priorState === 'unknown') {
      ctx.markExternalSideEffect?.();
      throw new Error(`relay.insight: unresolved dispatch marker ${existing[0].id}; provider reconciliation required before retry`);
    }

    const [marker] = await persistSideEffectMarker<Array<{ id: string }>>((markerTx) =>
      markerTx
        .insert(schema.relayCard)
        .values({
          orgId: job.org_id,
          modelId: source.modelId,
          channel,
          externalRef,
          state: 'pending',
          title: source.title,
          description: source.description,
          icon: source.icon,
          config: {
            sourceCardId: source.id,
            sourceExternalRef: source.externalRef,
            viralInsight: recordOf(source.config)?.viralInsight ?? null,
            externalDelivery: 'attempted',
          },
          priority: source.priority ?? 4,
        })
        .onConflictDoNothing()
        .returning({ id: schema.relayCard.id }),
    );
    if (!marker?.id) {
      ctx.markExternalSideEffect?.();
      throw new Error(`relay.insight: concurrent dispatch marker already exists for ${externalRef}; provider reconciliation required before retry`);
    }

    const rendered = renderer.renderInsightCard({
      id: source.id,
      cardId: marker.id,
      title: source.title,
      description: source.description ?? '',
      groups,
      icon: source.icon ?? undefined,
    });
    await sendInsightCard(channel, chatRef, rendered, ctx);
    await tx
      .update(schema.relayCard)
      .set({ state: 'sent' })
      .where(and(eq(schema.relayCard.id, marker.id), eq(schema.relayCard.orgId, job.org_id), eq(schema.relayCard.state, 'pending')));
  }
}
