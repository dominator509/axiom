import { Hono } from 'hono';
import { isProductionEnvironment, resolveRelaySecret, type UserRole } from '@axiom/core';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { readFileSync, existsSync } from 'node:fs';
import { modelsRouter } from './routes/models.js';
import { bundlesRouter } from './routes/bundles.js';
import { socialRouter } from './routes/social.js';
import { killswitchRouter } from './routes/killswitch.js';
import { egressRouter } from './routes/egress.js';
import { networkRouter } from './routes/network.js';
import { postsRouter, hasUnknownPublishOutcome } from './routes/posts.js';
import { queueBundleRevision } from './bundle-revision.js';
import { linkbioRouter, publicLinkbioRouter } from './routes/linkbio.js';
import { fansRouter } from './routes/fans.js';
import { analyticsRouter } from './routes/analytics.js';
import { viralRouter } from './routes/viral.js';
import { playbookRouter } from './routes/playbook.js';
import { generateRouter } from './routes/generate.js';
import { mediaUploadRouter } from './routes/media-upload.js';
import { auditRouter } from './routes/audit.js';
import { incidentsRouter } from './routes/incidents.js';
import { digestsRouter } from './routes/digests.js';
import { crashReportsRouter } from './routes/crash-reports.js';
import { orgSettingsRouter } from './routes/org-settings.js';
import { fanvueAuthRouter } from './routes/fanvue-auth.js';
import { threadsAuthRouter } from './routes/threads-auth.js';
import { consentRouter } from './routes/consent.js';
import {
  auth,
  normalizeAuthOrigin,
  requireAuth,
  requireMutationRole,
  requireRole,
} from '@axiom/auth';
import { LLMGateway, createLLMRouter } from '@axiom/llm-gateway';
import { asPlatform, enqueueJob, registerConnectors, resolveCapabilities } from '@axiom/worker';
import { createMcpServerAsync, isModelKillSwitchEnabled, withModelOrg } from '@axiom/mcp-server';
import {
  TelegramAdapter,
  DiscordAdapter,
  SignalAdapter,
  IMessageAdapter,
  ThreadsAdapter,
  createRelayRoutes,
  CardRenderer,
  CommandRouter,
  Bandit,
  IncidentManager,
  HealthCheckRegistry,
  CARD_ACTIONS,
  type CommandContext,
  type CardAction,
} from '@axiom/relay';
import { relayViralPersistence } from './relay-viral.js';
import { relayIncidentPageHandler } from './relay-incidents.js';
import { correlationId, onError, idempotency, rateLimit } from './contract.js';
import {
  checkDatabase,
  db,
  schema,
  getPublishingConsentStatus,
  consentRequirementMessage,
  getTosScanState,
} from '@axiom/db';
import { sql, eq, and } from 'drizzle-orm';
import {
  resolvePublishConnections,
  tosApprovalFailure,
  withOrgContext,
  writeAudit,
} from './routes/helpers.js';
import {
  relayCaptionUpdate,
  relayConnectionIds,
  relayScheduledFor,
} from './relay-command-inputs.js';
import { relayCommandAlreadyRecorded } from './relay-command-guard.js';
import { validateProductionRelayConfig } from './production-config.js';
import { readBoundedJson, readBoundedText, RequestBodyTooLargeError } from './webhook-body.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const MCP_MAX_BODY_BYTES = 256 * 1024;

type InboundRelayAdapter = {
  onCommand(
    action: CardAction,
    handler: (action: CardAction, cardId: string, context?: CommandContext) => Promise<void>,
  ): void;
};

type InboundRelayChannel = 'telegram' | 'discord' | 'signal' | 'imessage';

type PublishIntent = {
  action: 'schedule' | 'publish';
  platform: string;
  scheduledAt: string | null;
};

function parsePublishIntent(value: unknown): PublishIntent | null {
  if (!value || typeof value !== 'object') return null;
  const intent = value as Record<string, unknown>;
  if (intent.action !== 'schedule' && intent.action !== 'publish') return null;
  if (typeof intent.platform !== 'string' || intent.platform.length === 0) return null;
  if (intent.scheduledAt !== null && typeof intent.scheduledAt !== 'string') return null;
  return {
    action: intent.action,
    platform: intent.platform,
    scheduledAt: intent.scheduledAt,
  };
}

// Route construction creates the adapter without provider I/O. Runtime startup
// reuses this instance so webhook delivery and outbound relay commands share the
// same registered handlers and command router.
let telegramRuntimeAdapter: TelegramAdapter | undefined;

function registerRelayHandlers(
  adapter: InboundRelayAdapter,
  channel: InboundRelayChannel,
  commandRouter: CommandRouter,
): void {
  for (const action of CARD_ACTIONS) {
    adapter.onCommand(action, async (receivedAction, cardId, context) => {
      if (!context || context.channel !== channel || !context.sourceId) {
        throw new Error('relay command: missing or invalid provider source');
      }
      const result = await commandRouter.processCommand(
        cardId,
        receivedAction,
        context.params ?? {},
        context,
      );
      if (!result.success) {
        throw new Error(result.error ?? 'relay command failed');
      }
    });
  }
}

function matchesWebhookSecret(expected: string, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

/**
 * Executes a verified relay command against real domain state (H-3).
 * The relay package stays persistence-free; this injection lives here because
 * the API process owns @axiom/db. Org context is resolved from the card row
 * (HTTP signed commands carry no session; provider callbacks additionally
 * carry a channel identity that must match the persisted card binding).
 */
export async function relayCommandExecutor(
  action: CardAction,
  cardId: string,
  params: Record<string, unknown>,
  context?: CommandContext,
): Promise<string | void> {
  const card = await withOrgContext('00000000-0000-0000-0000-000000000000', async (tx) => {
    // Resolve the card via SECURITY DEFINER resolver (migration 0006) — the
    // signed command carries no session, so the card's org is unknown until
    // here; RLS FORCE would block a plain cross-org SELECT (LBI-02).
    const rows = await tx.execute(sql`SELECT * FROM resolve_relay_card(${cardId})`);
    const res = (rows?.rows ?? []) as Array<{ org_id: string; bundle_id: string | null }>;
    return res[0] ?? null;
  });
  if (!card) throw new Error(`relay command: card ${cardId} not found`);
  const orgId = card.org_id as string;
  const bundleId = card.bundle_id as string | null;

  return withOrgContext(orgId, async (tx) => {
    const relayCards = await tx
      .select({
        channel: schema.relayCard.channel,
        externalRef: schema.relayCard.externalRef,
        config: schema.relayCard.config,
      })
      .from(schema.relayCard)
      .where(and(eq(schema.relayCard.id, cardId), eq(schema.relayCard.orgId, orgId)))
      .limit(1)
      // Serialize callbacks for one card so the durable command check below
      // closes the race between duplicate provider deliveries.
      .for('update');
    const relayCard = relayCards[0];
    if (!relayCard) throw new Error(`relay command: card ${cardId} not found`);
    if (
      context &&
      (context.channel !== relayCard.channel || context.sourceId !== relayCard.externalRef)
    ) {
      throw new Error('relay command: source is not bound to this relay card');
    }

    if (await relayCommandAlreadyRecorded(tx, orgId, cardId, action)) {
      // Provider callbacks may be replayed after an API restart. The durable
      // ledger makes the signed command one-use across processes; report a
      // successful no-op so the provider does not retry the same delivery.
      return `relay command ${action} already processed`;
    }

    let note: string | undefined;

    if (action === 'change_price') {
      throw new Error(
        'relay command: change_price is unavailable because content bundles have no persisted price field',
      );
    }

    // Transition the bundle state per action (mirrors bundles.ts state machine).
    if (bundleId) {
      const bundle = await tx
        .select()
        .from(schema.contentBundle)
        .where(and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, orgId)))
        .limit(1)
        .for('update');
      if (bundle.length === 0) throw new Error(`relay command: bundle ${bundleId} not found`);

      const currentState = bundle[0].state as string;
      if ((relayCard.config?.revisionId ?? null) !== (bundle[0].tosReport?.revisionId ?? null)) {
        throw new Error(
          'relay command: this card is superseded; use the card for the latest revision',
        );
      }
      if (
        action === 'approve' ||
        action === 'approve_all' ||
        action === 'publish_now' ||
        (action === 'reschedule' && (currentState === 'generated' || currentState === 'hold'))
      ) {
        if (currentState !== 'generated' && currentState !== 'hold') {
          throw new Error(
            `relay command: bundle is already ${currentState}; only generated or held bundles can be approved`,
          );
        }

        const captions = (bundle[0].captions as Record<string, string> | null) ?? {};
        const publishIntent = parsePublishIntent(bundle[0].publishIntent);
        const requestedPlatforms =
          Object.keys(captions).length > 0
            ? Object.keys(captions)
            : publishIntent?.platform
              ? [publishIntent.platform]
              : ['instagram'];
        const platforms = requestedPlatforms.map((value) => {
          try {
            return asPlatform(value);
          } catch {
            throw new Error(`relay command: unsupported target platform '${value}'`);
          }
        });
        const tosFailure = tosApprovalFailure(bundle[0].tosReport, platforms);
        if (tosFailure) {
          throw new Error(`relay command: ${tosFailure}`);
        }
        const tosScanState = await getTosScanState(tx, orgId, bundleId);
        if (tosScanState !== 'completed') {
          throw new Error(
            tosScanState === 'pending'
              ? 'relay command: ToS scan is still running; approval must wait for completion'
              : tosScanState === 'failed'
                ? 'relay command: ToS scan failed; approval is blocked'
                : 'relay command: ToS scan is missing; approval is blocked',
          );
        }
        for (const platform of platforms) {
          const consent = await getPublishingConsentStatus(tx, orgId, bundle[0].modelId, platform);
          if (!consent.ok) {
            throw new Error(consentRequirementMessage(consent, platform));
          }
        }
        if (!bundle[0].assetId) {
          for (const platform of platforms) {
            try {
              if (resolveCapabilities(platform).media.includes('text')) continue;
            } catch {
              throw new Error(
                `relay command: cannot resolve ${platform} capabilities; media requirement is unknown`,
              );
            }
            throw new Error(
              `relay command: bundle has no media asset; ${platform} requires media before approval`,
            );
          }
        }

        if (bundle[0].assetId) {
          const assets = await tx
            .select({ id: schema.asset.id, orgId: schema.asset.orgId, modelId: schema.asset.modelId, kind: schema.asset.kind })
            .from(schema.asset)
            .where(and(
              eq(schema.asset.id, bundle[0].assetId),
              eq(schema.asset.orgId, orgId),
              eq(schema.asset.modelId, bundle[0].modelId),
            ))
            .limit(1);
          const asset = assets[0];
          if (!asset || asset.id !== bundle[0].assetId || asset.orgId !== orgId ||
              asset.modelId !== bundle[0].modelId || (asset.kind !== 'image' && asset.kind !== 'video')) {
            throw new Error('relay command: bundle references an unavailable or unsupported media asset; approval cannot continue');
          }
          for (const platform of platforms) {
            let supported: boolean;
            try {
              supported = resolveCapabilities(platform).media.includes(asset.kind);
            } catch {
              throw new Error(`relay command: cannot resolve ${platform} capabilities; media support is unknown`);
            }
            if (!supported) throw new Error(`relay command: ${platform} does not support ${asset.kind} assets; approval cannot continue`);
          }
        }

        const rawSlot =
          action === 'reschedule'
            ? relayScheduledFor(params, action).toISOString()
            : typeof params.slot === 'string'
              ? params.slot
              : typeof params.scheduledFor === 'string'
                ? params.scheduledFor
                : undefined;
        const immediateIntent = !rawSlot && publishIntent?.action === 'publish';
        const slot =
          action === 'publish_now' || immediateIntent
            ? new Date()
            : rawSlot
              ? new Date(rawSlot)
              : publishIntent?.scheduledAt
                ? new Date(publishIntent.scheduledAt)
                : new Date(Date.now() + 3600_000);
        if (
          action !== 'publish_now' &&
          !immediateIntent &&
          (Number.isNaN(slot.getTime()) || slot.getTime() <= Date.now())
        ) {
          throw new Error('relay command: approval slot must be a valid future timestamp');
        }

        const connectionResolution = await resolvePublishConnections(
          tx,
          orgId,
          bundle[0].modelId,
          platforms,
          relayConnectionIds(params),
        );
        if ('error' in connectionResolution) {
          throw new Error(`relay command: ${connectionResolution.error}`);
        }

        const transitioned = await tx
          .update(schema.contentBundle)
          .set({ state: 'approved', updatedAt: new Date() })
          .where(
            and(
              eq(schema.contentBundle.id, bundleId),
              eq(schema.contentBundle.orgId, orgId),
              eq(schema.contentBundle.state, currentState),
            ),
          )
          .returning({ id: schema.contentBundle.id });
        if (transitioned.length === 0) {
          throw new Error('relay command: bundle changed while approval was being applied');
        }

        for (const platform of platforms) {
          const [target] = await tx
            .insert(schema.postTarget)
            .values({
              orgId,
              bundleId,
              platform,
              connectionId: connectionResolution.connections.get(platform),
              scheduledFor: slot,
              state: 'pending',
              remoteId: null,
              error: null,
              idemKey: Buffer.from(`${bundleId}|${platform}|${slot.toISOString()}`),
            })
            .returning({ id: schema.postTarget.id });
          if (!target?.id) throw new Error('relay command: target insert returned no id');
          await enqueueJob(tx, {
            orgId,
            queue: 'publish',
            kind: 'publish.target',
            payload: { targetId: target.id },
            runAfter: slot,
            dedupeParts: ['publish.target', target.id],
          });
        }

        note =
          action === 'publish_now'
            ? `bundle ${bundleId} → approved for immediate publish (${platforms.join(', ')})`
            : action === 'reschedule'
              ? `bundle ${bundleId} → approved for ${slot.toISOString()} (${platforms.join(', ')})`
              : `bundle ${bundleId} → approved (${platforms.join(', ')})`;
      } else if (action === 'edit_caption') {
        if (
          currentState !== 'generated' &&
          currentState !== 'hold' &&
          currentState !== 'approved'
        ) {
          throw new Error(
            `relay command: bundle is already ${currentState}; caption edits are no longer allowed`,
          );
        }
        const targets: Array<{ id: string; state: string; remoteId: string | null }> = await tx
          .select({
            id: schema.postTarget.id,
            state: schema.postTarget.state,
            remoteId: schema.postTarget.remoteId,
          })
          .from(schema.postTarget)
          .where(and(eq(schema.postTarget.bundleId, bundleId), eq(schema.postTarget.orgId, orgId)))
          .orderBy(schema.postTarget.id)
          .for('update');
        if (
          targets.some(
            (target) =>
              (target.state !== 'pending' && target.state !== 'canceled') || target.remoteId,
          )
        ) {
          throw new Error('relay command: caption edits are not allowed after publication begins');
        }
        for (const target of targets) {
          if (await hasUnknownPublishOutcome(tx, orgId, target.id)) {
            throw new Error(
              'relay command: provider outcome is unknown; reconcile before editing captions',
            );
          }
        }
        const currentCaptions = (bundle[0].captions as Record<string, string> | null) ?? {};
        const update = relayCaptionUpdate(params, currentCaptions);
        const revisionId = randomUUID();
        const transitioned = await tx
          .update(schema.contentBundle)
          .set({
            captions: { ...currentCaptions, [update.platform]: update.caption },
            state: 'generated',
            tosReport: { verdict: 'pending', revisionId },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.contentBundle.id, bundleId),
              eq(schema.contentBundle.orgId, orgId),
              eq(schema.contentBundle.state, currentState),
            ),
          )
          .returning({ id: schema.contentBundle.id });
        if (transitioned.length === 0) {
          throw new Error('relay command: bundle changed while caption edit was being applied');
        }
        // Existing scheduled jobs may already be claimed. The target lock
        // serializes with publish.target; its terminal-state guard makes a
        // canceled target a no-op even for jobs claimed before this edit.
        await tx
          .update(schema.postTarget)
          .set({ state: 'canceled', error: 'caption edited; fresh approval required' })
          .where(
            and(
              eq(schema.postTarget.bundleId, bundleId),
              eq(schema.postTarget.orgId, orgId),
              eq(schema.postTarget.state, 'pending'),
            ),
          );
        await enqueueJob(tx, {
          orgId,
          queue: 'tos',
          kind: 'tos.scan',
          payload: { bundleId },
          dedupeParts: ['tos.scan', bundleId, revisionId],
        });
        note = `bundle ${bundleId} → caption updated for ${update.platform}; fresh ToS scan and approval required`;
      } else if (action === 'reschedule') {
        if (currentState !== 'approved') {
          throw new Error(
            `relay command: bundle is ${currentState}; reschedule requires an approved bundle`,
          );
        }
        const scheduledFor = relayScheduledFor(params, action);
        const targets: Array<{
          id: string;
          platform: string;
          state: string;
          remoteId: string | null;
        }> = await tx
          .select({
            id: schema.postTarget.id,
            platform: schema.postTarget.platform,
            state: schema.postTarget.state,
            remoteId: schema.postTarget.remoteId,
          })
          .from(schema.postTarget)
          .where(and(eq(schema.postTarget.bundleId, bundleId), eq(schema.postTarget.orgId, orgId)))
          // Match dashboard/worker lock ownership and order multiple targets
          // consistently when commands from different relay cards race.
          .orderBy(schema.postTarget.id)
          .for('update');
        if (targets.length === 0) {
          throw new Error('relay command: approved bundle has no publish targets to reschedule');
        }
        if (targets.some((target) => target.state !== 'pending' || target.remoteId)) {
          throw new Error('relay command: reschedule is not allowed after publication begins');
        }
        for (const target of targets) {
          if (await hasUnknownPublishOutcome(tx, orgId, target.id)) {
            throw new Error(
              'relay command: provider outcome is unknown; reconcile before rescheduling',
            );
          }
        }
        for (const target of targets) {
          const updated = await tx
            .update(schema.postTarget)
            .set({
              scheduledFor,
              idemKey: Buffer.from(`${bundleId}|${target.platform}|${scheduledFor.toISOString()}`),
            })
            .where(
              and(
                eq(schema.postTarget.id, target.id),
                eq(schema.postTarget.orgId, orgId),
                eq(schema.postTarget.state, 'pending'),
              ),
            )
            .returning({ id: schema.postTarget.id });
          if (updated.length === 0) {
            throw new Error('relay command: target changed while rescheduling was being applied');
          }
          await enqueueJob(tx, {
            orgId,
            queue: 'publish',
            kind: 'publish.target',
            payload: { targetId: target.id },
            runAfter: scheduledFor,
            dedupeParts: ['publish.target', target.id],
          });
          await tx.execute(sql`
            UPDATE job
               SET run_after = ${scheduledFor}
             WHERE org_id = ${orgId}
               AND kind = 'publish.target'
               AND state = 'ready'
               AND payload ->> 'targetId' = ${target.id}
          `);
        }
        note = `bundle ${bundleId} → rescheduled for ${scheduledFor.toISOString()}`;
      } else if (action === 'revise' || action === 'regenerate') {
        if (currentState !== 'generated' && currentState !== 'hold') {
          throw new Error(
            `relay command: bundle is already ${currentState}; revision requires a generated or held bundle`,
          );
        }
        const supplied = params.instructions;
        if (
          supplied !== undefined &&
          (typeof supplied !== 'string' || !supplied.trim() || supplied.trim().length > 2000)
        ) {
          throw new Error('relay command: revision instructions must contain 1 to 2000 characters');
        }
        const instructions =
          typeof supplied === 'string'
            ? supplied.trim()
            : action === 'revise'
              ? 'Revise the caption to comply with the platform ToS rules while preserving its intent.'
              : 'Write a distinct new caption for the same content and platform, following the ToS rules.';
        await queueBundleRevision(tx, orgId, bundleId, currentState, instructions);
        note = `bundle ${bundleId} → caption revision queued; fresh ToS review required`;
      } else {
        const stateByAction: Partial<Record<CardAction, string>> = {
          reject: 'rejected',
          hold: 'hold',
        };
        const nextState = stateByAction[action];
        if (nextState && currentState !== 'generated' && currentState !== 'hold') {
          throw new Error(
            `relay command: bundle is already ${currentState}; action '${action}' requires a generated or held bundle`,
          );
        }
        if (nextState) {
          const transitioned = await tx
            .update(schema.contentBundle)
            .set({ state: nextState, updatedAt: new Date() })
            .where(
              and(
                eq(schema.contentBundle.id, bundleId),
                eq(schema.contentBundle.orgId, orgId),
                eq(schema.contentBundle.state, currentState),
              ),
            )
            .returning({ id: schema.contentBundle.id });
          if (transitioned.length === 0) {
            throw new Error(`relay command: bundle changed while '${action}' was being applied`);
          }
          note = `bundle ${bundleId} → ${nextState}`;
        }
      }
    }

    // Persist the command (relay_command row) for auditability (L2.7).
    await tx.insert(schema.relayCommand).values({
      orgId,
      cardId,
      trigger: 'relay',
      action,
      params,
      enabled: true,
    });

    // Append to the hash-chained audit log (LBI-08).
    await writeAudit(tx, orgId, 'relay', `relay.command.${action}`, cardId, {
      action,
      params,
      note,
    });

    return note;
  });
}

// Register the real platform connectors into the shared registry so API-side
// connector lookups (social-accounts capabilities, validate-for-platform, etc.)
// work in this process. Idempotent; the worker process registers the same set.
registerConnectors();
console.log('Connectors registered (API process)');

export type AppBindings = {
  Variables: {
    userId: string;
    orgId: string;
    role: UserRole | null;
  };
};

let relayCommandRouter: CommandRouter | undefined;

function getRelayCommandRouter(): CommandRouter {
  if (!relayCommandRouter) {
    const relaySecret = resolveRelaySecret(process.env);
    relayCommandRouter = new CommandRouter(relaySecret, 5, relayCommandExecutor);
  }
  return relayCommandRouter;
}

const app = new Hono<AppBindings>();

// Browser clients are credentialed, so never reflect arbitrary origins.
// BETTER_AUTH_URL is the canonical application origin used by the dashboard;
// non-browser clients (mobile/agents) do not send an Origin header.
app.use(
  '*',
  cors({
    origin: normalizeAuthOrigin(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3001'),
    credentials: true,
  }),
);
app.use('*', logger());
app.use('*', secureHeaders());
// L3.0 contract: correlation_id on every request, then per-token rate limits.
app.use('*', correlationId);
app.use('/api/v1/*', rateLimit());
// MCP is an authenticated agent surface, but it is outside the REST prefix;
// apply the same per-credential bucket before JSON-RPC dispatch.
app.use('/api/mcp', rateLimit());
app.onError(onError);

// Health check
app.get('/api/v1/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));
app.get('/api/v1/ready', async (c) => {
  try {
    await checkDatabase();
    return c.json({ status: 'ok', dependencies: { postgres: 'ok' } });
  } catch {
    return c.json({ status: 'unavailable', dependencies: { postgres: 'unavailable' } }, 503);
  }
});

// Build-time OpenAPI document (L3.0) — served as a live endpoint.
// Generated by gen-openapi.ts on `pnpm build`; the file lives in dist/ next
// to the compiled server (not in src, so it cannot go stale vs the build).
app.get('/api/v1/openapi.json', (c) => {
  const specUrl = new URL('./openapi.json', import.meta.url);
  return c.json(
    existsSync(specUrl)
      ? JSON.parse(readFileSync(specUrl, 'utf8'))
      : { openapi: '3.0.3', info: { title: 'AXIOM FanvueCRM API', version: '0.1.0' }, paths: {} },
  );
});

// Public Native Link-in-Bio page and click redirects. Operator CRUD remains
// under /api/v1 and is session-authenticated below.
app.route('/linkbio', publicLinkbioRouter);

// Better Auth is a public password/account-processing boundary, so it needs
// its own anonymous budget rather than inheriting only the /api/v1 limiter.
// Keep this before the handler so every auth method, including future ones,
// receives the same abuse-control boundary and Retry-After response.
app.use('/api/auth/*', rateLimit({ capacity: 20, refillPerSec: 1, maxBuckets: 100_000 }));

// ── Better Auth — mounted at /api/auth/* (replaces the 501 placeholder) ──
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
console.log('Better Auth mounted at /api/auth/*');

// ── Mount dashboard + CRM routes ──
// Every route group behind requireAuth: session → userId/orgId injected,
// orgId then scopes all RLS transactions (LBI-02).
app.use('/api/v1/models/*', requireAuth);
app.use('/api/v1/bundles/*', requireAuth);
app.use('/api/v1/social-accounts/*', requireAuth);
app.use('/api/v1/egress/*', requireAuth);
app.use('/api/v1/models/:modelId/network/*', requireAuth);
app.use('/api/v1/posts/*', requireAuth);
app.use('/api/v1/models/:modelId/calendar/*', requireAuth);
app.use('/api/v1/models/:modelId/linkbio/*', requireAuth);
app.use('/api/v1/linkbio/*', requireAuth);
app.use('/api/v1/models/:modelId/fans/*', requireAuth);
app.use('/api/v1/fans/*', requireAuth);
app.use('/api/v1/custom-requests/*', requireAuth);
app.use('/api/v1/models/:modelId/custom-requests/*', requireAuth);
app.use('/api/v1/models/:modelId/analytics/*', requireAuth);
app.use('/api/v1/models/:modelId/viral/*', requireAuth);
app.use('/api/v1/models/:modelId/playbook-score/*', requireAuth);
app.use('/api/v1/models/:modelId/generate/*', requireAuth);
app.use('/api/v1/audit/*', requireAuth);
app.use('/api/v1/incidents/*', requireAuth);
app.use('/api/v1/killswitch/*', requireAuth);
app.use('/api/v1/kill-switch/*', requireAuth);
app.use('/api/v1/digests/*', requireAuth);
app.use('/api/v1/crash-reports/*', requireAuth);
app.use('/api/v1/models/:modelId/consent-records/*', requireAuth);
app.use('/api/v1/models/:modelId/consent-status', requireAuth);
app.use('/api/v1/org-settings/*', requireAuth);
// LLM requests can spend provider credits and reveal provider/runtime state.
app.use('/api/v1/llm/*', requireAuth);
// OAuth initiation and token refresh are session-authenticated. The sealed
// callback state carries the org/model target, so public provider callbacks
// cannot attach credentials to another tenant or a deployment-wide .env file.
app.use('/api/v1/connectors/fanvue/authorize', requireAuth);
app.use('/api/v1/connectors/fanvue/refresh', requireAuth);
app.use('/api/v1/connectors/threads/authorize', requireAuth);
// Card rendering is an operator surface. Signed relay commands, provider
// webhooks, metrics, and health probes retain their protocol-specific access.
app.use('/api/v1/relay/card', requireAuth);
// Relay viral ingest/exemplars are DB-backed (M-7) — require a session so
// orgId comes from the auth context, never from the request body.
app.use('/api/v1/viral/ingest', requireAuth);
app.use('/api/v1/viral/exemplars', requireAuth);

// REST role enforcement (L3.0 / L1.0). The session role is loaded from the
// server-owned auth_user.role field by requireAuth; it is never accepted from
// request input. Read routes remain available to authenticated roles, while
// mutation groups name the operational roles that may change state.
const operationalMutation = requireMutationRole('owner', 'manager', 'operator');
const ownerOnly = requireRole('owner');

app.use('/api/v1/models', operationalMutation);
app.use('/api/v1/models/*', operationalMutation);
app.use('/api/v1/bundles', operationalMutation);
app.use('/api/v1/bundles/*', operationalMutation);
app.use('/api/v1/social-accounts', operationalMutation);
app.use('/api/v1/social-accounts/*', operationalMutation);
app.use('/api/v1/posts', operationalMutation);
app.use('/api/v1/posts/*', operationalMutation);
app.use('/api/v1/models/:modelId/linkbio', operationalMutation);
app.use('/api/v1/models/:modelId/linkbio/*', operationalMutation);
app.use('/api/v1/models/:modelId/fans/*', operationalMutation);
app.use('/api/v1/fans/*', operationalMutation);
app.use('/api/v1/custom-requests', operationalMutation);
app.use('/api/v1/custom-requests/*', operationalMutation);
app.use('/api/v1/models/:modelId/custom-requests/*', operationalMutation);
app.use('/api/v1/models/:modelId/generate', operationalMutation);
app.use('/api/v1/models/:modelId/generate/*', operationalMutation);
app.use('/api/v1/models/:modelId/consent-records', operationalMutation);
app.use('/api/v1/models/:modelId/consent-records/*', operationalMutation);
app.use('/api/v1/models/:modelId/playbook-score/record', operationalMutation);
app.use('/api/v1/incidents', operationalMutation);
app.use('/api/v1/incidents/*', operationalMutation);
app.use('/api/v1/digests/generate', operationalMutation);
app.use('/api/v1/llm/*', operationalMutation);
app.use('/api/v1/connectors/fanvue/*', operationalMutation);
app.use('/api/v1/connectors/threads/*', operationalMutation);
app.use('/api/v1/relay/card', operationalMutation);
app.use('/api/v1/viral/ingest', operationalMutation);
app.use('/api/v1/viral/exemplars', operationalMutation);

// Network and deployment controls are owner-only, including read access to
// the sensitive egress state and kill-switch/org control surfaces.
app.use('/api/v1/egress', ownerOnly);
app.use('/api/v1/egress/*', ownerOnly);
app.use('/api/v1/models/:modelId/network', ownerOnly);
app.use('/api/v1/models/:modelId/network/*', ownerOnly);
app.use('/api/v1/killswitch', ownerOnly);
app.use('/api/v1/killswitch/*', ownerOnly);
app.use('/api/v1/kill-switch', ownerOnly);
app.use('/api/v1/kill-switch/*', ownerOnly);
app.use('/api/v1/org-settings', ownerOnly);
app.use('/api/v1/org-settings/*', ownerOnly);

// L3.0: durable mutations require Idempotency-Key. This reservation is
// committed before the handler runs, so a lost response cannot repeat a DB,
// queue, or provider-side effect when the caller retries its intent.
// Hono's wildcard includes the base path; register once to avoid hashing and
// reserving the same request twice.
app.use('/api/v1/models/:modelId/generate/*', idempotency());
app.use('/api/v1/models/:modelId/media-upload', idempotency(true, 64 * 1024 * 1024));
app.use('/api/v1/models/:id', idempotency());
app.use('/api/v1/bundles/*/approve', idempotency());
app.use('/api/v1/bundles/*/revise', idempotency());
app.use('/api/v1/bundles/*/reject', idempotency());
app.use('/api/v1/bundles/*/video-review', idempotency());
app.use('/api/v1/bundles', idempotency());
// DLQ replay resets a durable job and requeues its side effect. Protect the
// dashboard retry action with the same durable key/replay contract.
app.use('/api/v1/incidents/:jobId/replay', idempotency());
app.use('/api/v1/incidents/report', idempotency());
app.use('/api/v1/killswitch/enable', idempotency());
app.use('/api/v1/killswitch/disable', idempotency());
app.use('/api/v1/kill-switch', idempotency());
app.use('/api/v1/models', idempotency());
app.use('/api/v1/models/:modelId/network', idempotency());
app.use('/api/v1/org-settings', idempotency());
app.use('/api/v1/digests/generate', idempotency());
app.use('/api/v1/crash-reports/*', idempotency());
app.use('/api/v1/models/:modelId/consent-records/*', idempotency());
app.use('/api/v1/models/:modelId/linkbio/*', idempotency());
app.use('/api/v1/posts', idempotency());
app.use('/api/v1/posts/:id', idempotency());
app.use('/api/v1/social-accounts', idempotency());
app.use('/api/v1/social-accounts/:id', idempotency());
app.use('/api/v1/egress', idempotency());
app.use('/api/v1/egress/:id', idempotency());
app.use('/api/v1/egress/plane/bind', idempotency());
app.use('/api/v1/egress/plane/unbind', idempotency());
app.use('/api/v1/egress/plane/sync', idempotency());
app.use('/api/v1/models/:modelId/fans', idempotency());
app.use('/api/v1/fans/:fanId/touchpoints', idempotency());
app.use('/api/v1/custom-requests', idempotency());
app.use('/api/v1/custom-requests/:id', idempotency());
app.use('/api/v1/models/:modelId/playbook-score/record', idempotency());
app.use('/api/v1/connectors/fanvue/refresh', idempotency());
app.use('/api/v1/viral/ingest', idempotency());

app.route('/api/v1/models', modelsRouter);
app.route('/api/v1/bundles', bundlesRouter);
app.route('/api/v1/social-accounts', socialRouter);
app.route('/api/v1/connectors/fanvue', fanvueAuthRouter);
app.route('/api/v1/connectors/threads', threadsAuthRouter);
app.route('/api/v1', killswitchRouter);
app.route('/api/v1/egress', egressRouter);
app.route('/api/v1/models', networkRouter);
app.route('/api/v1', postsRouter);
app.route('/api/v1', linkbioRouter);
app.route('/api/v1', fansRouter);
app.route('/api/v1', analyticsRouter);
app.route('/api/v1', viralRouter);
app.route('/api/v1', playbookRouter);
app.route('/api/v1', generateRouter);
app.route('/api/v1', mediaUploadRouter);
app.route('/api/v1', auditRouter);
app.route('/api/v1', incidentsRouter);
app.route('/api/v1', digestsRouter);
app.route('/api/v1', crashReportsRouter);
app.route('/api/v1', consentRouter);
app.route('/api/v1', orgSettingsRouter);

// LLM gateway — unified multi-provider chat completions
const llmGateway = new LLMGateway();
app.route('/api/v1/llm', createLLMRouter(llmGateway));

// ── CRM MCP endpoint (F-45 / L2.11) ────────────────────────────────────────
// Agents invoke MCP tools with a capability token (Bearer). Each request is
// authenticated into a tier-scoped McpServer instance; tools execute real DB
// work in the model's org context (H-2).
app.post('/api/mcp', async (c) => {
  const headers: Record<string, string> = {};
  const authHeader = c.req.header('authorization');
  if (authHeader) headers.authorization = authHeader;
  let body: Record<string, unknown> = {};
  try {
    const parsed = await readBoundedJson<unknown>(c.req.raw, MCP_MAX_BODY_BYTES);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return c.json(
        { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid request' }, id: null },
        400,
      );
    }
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return c.json(
        { jsonrpc: '2.0', error: { code: -32000, message: 'Request body too large' }, id: null },
        413,
      );
    }
    return c.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
      400,
    );
  }
  let server: Awaited<ReturnType<typeof createMcpServerAsync>>;
  try {
    server = await createMcpServerAsync(
      { headers, params: body as Record<string, unknown> },
      {
        isTokenRevoked: async (tokenId) => {
          const result = await db.execute(
            sql`SELECT 1 FROM mcp_token_revocation WHERE token_id = ${tokenId} LIMIT 1`,
          );
          return ((result?.rows ?? []) as unknown[]).length > 0;
        },
        onToolCall: async ({ agentId, modelId, tier, toolName, requestId }) => {
          await withModelOrg(modelId, async (tx, orgId) => {
            await writeAudit(tx, orgId, `mcp:${agentId}`, 'mcp.tool.call', toolName, {
              modelId,
              tier,
              requestId,
            });
          });
        },
      },
    );
  } catch {
    return c.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'Authentication failed' }, id: null },
      401,
    );
  }
  const requestId =
    typeof body.id === 'string' || typeof body.id === 'number' || body.id === null ? body.id : null;
  try {
    if (await isModelKillSwitchEnabled(server.getModelId())) {
      return c.json(
        { jsonrpc: '2.0', error: { code: -32003, message: 'MCP surface disabled' }, id: requestId },
        423,
      );
    }
    const response = await server.handleRequest(body as never);
    return c.json(response);
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'MCP service unavailable' },
        id: requestId,
      },
      503,
    );
  }
});
app.get('/api/mcp', async (c) => {
  // GET is not part of the JSON-RPC transport; used only as a liveness probe.
  return c.json({ jsonrpc: '2.0', result: { status: 'mcp endpoint ready' }, id: null });
});
console.log('LLM gateway routes mounted');

// ── Relay initialization ──────────────────────────────────────

export function createRelayApp(): Hono {
  validateProductionRelayConfig(process.env);
  const cardRenderer = new CardRenderer();
  const commandRouter = getRelayCommandRouter();
  const bandit = new Bandit();
  const incidentManager = new IncidentManager();
  // F-78 (L2.9): sev-1 / crash-loop incidents auto-page into the Relay —
  // the page handler writes a durable, org-scoped relay card + audit entry.
  incidentManager.setPageHandler(relayIncidentPageHandler);
  const healthRegistry = new HealthCheckRegistry();

  const relay = createRelayRoutes({
    cardRenderer,
    commandRouter,
    bandit,
    incidentManager,
    healthRegistry,
    viralPersistence: relayViralPersistence,
  });
  // Provider webhooks are public transport surfaces. Apply the same
  // transport-aware limiter used by the REST API before any body parsing or
  // signature work, so a valid secret is not an unlimited memory/CPU budget.
  relay.use('/webhooks/*', rateLimit({ capacity: 120, refillPerSec: 2, maxBuckets: 100_000 }));

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramWebhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
  const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (telegramToken) {
    if (telegramWebhookUrl && !telegramWebhookSecret) {
      throw new Error('Telegram webhook configuration requires TELEGRAM_WEBHOOK_SECRET');
    }
    const telegram = new TelegramAdapter(
      {
        token: telegramToken,
        webhookUrl: telegramWebhookUrl,
        webhookSecret: telegramWebhookSecret,
      },
      commandRouter,
    );
    registerRelayHandlers(telegram, 'telegram', commandRouter);
    telegramRuntimeAdapter = telegram;

    if (telegramWebhookUrl && telegramWebhookSecret) {
      relay.post('/webhooks/telegram', async (c) => {
        if (
          !matchesWebhookSecret(
            telegramWebhookSecret,
            c.req.header('X-Telegram-Bot-Api-Secret-Token'),
          )
        ) {
          return c.json({ error: 'unauthorized' }, 401);
        }

        let payload: unknown;
        try {
          payload = await readBoundedJson(c.req.raw);
        } catch (error) {
          return c.json(
            {
              error:
                error instanceof RequestBodyTooLargeError
                  ? 'payload too large'
                  : 'invalid JSON payload',
            },
            error instanceof RequestBodyTooLargeError ? 413 : 400,
          );
        }
        try {
          await telegram.handleWebhook(payload as Parameters<TelegramAdapter['handleWebhook']>[0]);
          return c.json({ ok: true });
        } catch (error) {
          console.error('Telegram relay webhook failed', error);
          return c.json({ error: 'relay command failed' }, 500);
        }
      });
      console.log('Telegram webhook route mounted at /webhooks/telegram');
    }
  }

  // Initialize Threads adapter if client ID configured
  const threadsClientId = process.env.THREADS_CLIENT_ID;
  const threadsClientSecret = process.env.THREADS_CLIENT_SECRET;
  const configuredThreadsVerifyToken = process.env.THREADS_WEBHOOK_VERIFY_TOKEN;
  const environment = (process.env.AXIOM_ENV ?? process.env.NODE_ENV)?.trim();
  const localDevelopment = environment === 'development' || environment === 'test';
  if (
    !localDevelopment &&
    threadsClientId &&
    threadsClientSecret &&
    !configuredThreadsVerifyToken
  ) {
    throw new Error('THREADS_WEBHOOK_VERIFY_TOKEN is required when Threads is enabled');
  }
  const threadsVerifyToken = configuredThreadsVerifyToken || 'axiom-threads-verify';
  if (threadsClientId && threadsClientSecret) {
    const threads = new ThreadsAdapter({
      clientId: threadsClientId,
      clientSecret: threadsClientSecret,
      verifyToken: threadsVerifyToken,
    });

    // Mount Threads webhook handler on the relay Hono app
    relay.get('/webhooks/threads', (c) => {
      const query = c.req.query();
      const result = threads.handleVerification(query as Record<string, string | undefined>);
      return c.body(result.body, result.status as 200 | 403);
    });

    relay.post('/webhooks/threads', async (c) => {
      let rawBody: string;
      try {
        rawBody = await readBoundedText(c.req.raw);
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof RequestBodyTooLargeError
                ? 'payload too large'
                : 'invalid request body',
          },
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return c.json({ error: 'invalid JSON payload' }, 400);
      }
      const signature = c.req.header('X-Hub-Signature-256') || undefined;
      const result = await threads.handleWebhook(
        payload as Parameters<ThreadsAdapter['handleWebhook']>[0],
        rawBody,
        signature,
      );
      return c.body(result.body, result.status as 200 | 400 | 403);
    });

    console.log('Threads adapter initialized');
  }

  const blueBubblesUrl = process.env.BLUEBUBBLES_URL;
  const blueBubblesPassword = process.env.BLUEBUBBLES_PASSWORD ?? process.env.BLUEBUBBLES_API_KEY;
  const blueBubblesWebhookSecret = process.env.BLUEBUBBLES_WEBHOOK_SECRET;
  if (blueBubblesUrl && blueBubblesPassword) {
    if (!blueBubblesWebhookSecret && isProductionEnvironment(process.env)) {
      throw new Error('BLUEBUBBLES_WEBHOOK_SECRET is required when iMessage is enabled');
    }
    if (blueBubblesWebhookSecret) {
      const imessage = new IMessageAdapter(
        { blueBubblesUrl, password: blueBubblesPassword },
        commandRouter,
      );
      registerRelayHandlers(imessage, 'imessage', commandRouter);
      relay.post('/webhooks/imessage', async (c) => {
        if (!matchesWebhookSecret(blueBubblesWebhookSecret, c.req.header('X-Axiom-Relay-Secret'))) {
          return c.json({ error: 'unauthorized' }, 401);
        }
        let payload: unknown;
        try {
          payload = await readBoundedJson(c.req.raw);
        } catch (error) {
          return c.json(
            {
              error:
                error instanceof RequestBodyTooLargeError
                  ? 'payload too large'
                  : 'invalid JSON payload',
            },
            error instanceof RequestBodyTooLargeError ? 413 : 400,
          );
        }
        try {
          const handled = await imessage.handleWebhook(payload);
          return c.json({ ok: true, handled });
        } catch (error) {
          console.error('iMessage relay webhook failed', error);
          return c.json({ error: 'relay command failed' }, 500);
        }
      });
      console.log('iMessage adapter initialized');
    } else {
      console.warn('iMessage adapter disabled: BLUEBUBBLES_WEBHOOK_SECRET is not configured');
    }
  }

  return relay;
}

// Route construction is deliberately synchronous and network-free so tests,
// OpenAPI generation, and production startup all see the same route table.
app.route('/', createRelayApp());

/** Start adapters that perform external I/O. Called only by the server entrypoint. */
export async function initializeRuntime(): Promise<void> {
  const commandRouter = getRelayCommandRouter();

  const discordToken = process.env.DISCORD_BOT_TOKEN;
  const discordClientId = process.env.DISCORD_APPLICATION_ID;
  if (discordToken && discordClientId) {
    const discord = new DiscordAdapter(
      { token: discordToken, clientId: discordClientId },
      commandRouter,
    );
    registerRelayHandlers(discord, 'discord', commandRouter);
    discord.registerInteractionHandler();
    await discord.login();
    console.log('Discord adapter initialized');
  }

  const telegramWebhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
  if (telegramRuntimeAdapter) {
    const telegram = telegramRuntimeAdapter;
    if (telegramWebhookUrl) {
      await telegram.setWebhook(telegramWebhookUrl);
    } else {
      await telegram.startPolling();
    }
    console.log('Telegram adapter initialized');
  }

  const signalCliPath = process.env.SIGNAL_CLI_PATH;
  const signalAccount = process.env.SIGNAL_ACCOUNT;
  if (signalCliPath && signalAccount) {
    const signal = new SignalAdapter(
      { cliPath: signalCliPath, account: signalAccount },
      commandRouter,
    );
    registerRelayHandlers(signal, 'signal', commandRouter);
    signal.startReceiving();
    console.log('Signal adapter initialized');
  }
}

export default app;

export type AppType = typeof app;
