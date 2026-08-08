import { Hono } from 'hono';
import { Logger } from './observability/logging.js';
import { metricsRegistry } from './observability/metrics.js';
import { IncidentManager } from './observability/incidents.js';
import { HealthCheckRegistry } from './observability/health.js';
import { CardRenderer, type BundleContent, type CardAction } from './card.js';
import { CommandRouter } from './commands.js';
import { ViralLoop, type PostMetrics } from './viral/loop.js';
import { Bandit } from './viral/bandit.js';
import type { ViralPersistence } from './viral/persistence.js';

export interface RelayDependencies {
  cardRenderer: CardRenderer;
  commandRouter: CommandRouter;
  viralLoop: ViralLoop;
  bandit: Bandit;
  incidentManager: IncidentManager;
  healthRegistry: HealthCheckRegistry;
  /**
   * Optional DB-backed viral persistence, injected by the API process
   * (M-7). When present, /viral/ingest and /viral/exemplars persist to
   * post_metric / viral_exemplar instead of the in-memory loop.
   */
  viralPersistence?: ViralPersistence;
}

export function createRelayRoutes(deps: RelayDependencies): Hono {
  // Variables typing is internal (orgId set by the API's requireAuth when
  // mounted); the public signature stays a plain Hono so any parent app can
  // mount it (the API's Hono<AppBindings> would reject a narrower type).
  const app = new Hono() as Hono<{ Variables: { orgId?: string } }>;
  const logger = new Logger('relay-routes');

  // POST /api/v1/relay/card - generate and send card
  app.post('/api/v1/relay/card', async (c) => {
    try {
      const body = await c.req.json<BundleContent>();
      const card = deps.cardRenderer.renderBundleCard(body);
      metricsRegistry.incrementCounter('relay_cards_sent', {
        platforms: body.targetPlatforms.join(','),
      });
      return c.json({ success: true, card });
    } catch (err) {
      logger.error('Failed to generate card', err as Error);
      return c.json({ success: false, error: 'Failed to generate card' }, 500);
    }
  });

  // POST /api/v1/relay/command - process relay command
  app.post('/api/v1/relay/command', async (c) => {
    try {
      const { signature, nonce, action, cardId, params } = await c.req.json<{
        signature: string;
        nonce: string;
        action: CardAction;
        cardId: string;
        params?: Record<string, unknown>;
      }>();

      const verified = deps.commandRouter.verifyCommand(signature, nonce, action, cardId);
      if (!verified) {
        return c.json({ success: false, error: 'Invalid or expired command signature' }, 403);
      }

      const result = await deps.commandRouter.processCommand(cardId, action, params);
      return c.json(result);
    } catch (err) {
      logger.error('Failed to process command', err as Error);
      return c.json({ success: false, error: 'Failed to process command' }, 500);
    }
  });

  // POST /api/v1/viral/ingest - ingest metrics
  app.post('/api/v1/viral/ingest', async (c) => {
    try {
      const { postId, metrics } = await c.req.json<{
        postId: string;
        metrics: PostMetrics;
      }>();
      // Authenticated org (set by the API's requireAuth middleware when the
      // relay app is mounted at '/' — Hono shares context variables across
      // the merged app). Fall back to the body only for standalone/tests.
      const orgId = (c.get('orgId') as string | undefined) ?? undefined;
      if (deps.viralPersistence) {
        // DB-backed path (M-7): persist to post_metric + enqueue viral.label.
        const result = await deps.viralPersistence.persist({ postId, metrics, orgId });
        metricsRegistry.incrementCounter('generation_count');
        return c.json({ success: true, label: result.label });
      }
      // In-memory fallback (tests / standalone relay).
      deps.viralLoop.ingestMetrics(postId, metrics);
      const label = deps.viralLoop.labelPost(postId);
      deps.viralLoop.storeExemplar(postId, label);
      metricsRegistry.incrementCounter('generation_count');
      return c.json({ success: true, label });
    } catch (err) {
      logger.error('Failed to ingest metrics', err as Error);
      return c.json({ success: false, error: 'Failed to ingest metrics' }, 500);
    }
  });

  // GET /api/v1/viral/exemplars - retrieve exemplars
  app.get('/api/v1/viral/exemplars', async (c) => {
    try {
      const platform = c.req.query('platform') ?? 'all';
      const limit = parseInt(c.req.query('limit') ?? '10', 10);
      if (deps.viralPersistence) {
        // DB-backed path (M-7): read from viral_exemplar.
        const orgId = (c.get('orgId') as string | undefined) ?? c.req.query('orgId') ?? undefined;
        const exemplars = await deps.viralPersistence.listExemplars({ platform, limit, orgId });
        return c.json({ success: true, exemplars });
      }
      const exemplars = deps.viralLoop.retrieveExemplars(platform, limit);
      return c.json({ success: true, exemplars });
    } catch (err) {
      logger.error('Failed to retrieve exemplars', err as Error);
      return c.json({ success: false, error: 'Failed to retrieve exemplars' }, 500);
    }
  });

  // POST /api/v1/incidents/report - report incident
  app.post('/api/v1/incidents/report', async (c) => {
    try {
      const { severity, message, source } = await c.req.json<{
        severity: 'sev-1' | 'sev-2' | 'sev-3' | 'sev-4';
        message: string;
        source: string;
      }>();
      const incident = deps.incidentManager.reportIncident(
        severity,
        message,
        source,
        // Thread the authenticated org into the page so the DB-backed sink
        // (F-78) can write an org-scoped relay card.
        (c.get('orgId') as string | undefined) ? { orgId: c.get('orgId') as string } : undefined,
      );
      return c.json({ success: true, incident });
    } catch (err) {
      logger.error('Failed to report incident', err as Error);
      return c.json({ success: false, error: 'Failed to report incident' }, 500);
    }
  });

  // POST /api/v1/incidents/:id/replay - replay DLQ
  app.post('/api/v1/incidents/:id/replay', async (c) => {
    try {
      const dlqId = c.req.param('id');
      const replayHandler = async (payload: unknown) => {
        logger.info('Replaying DLQ payload', { payload });
      };
      const success = await deps.incidentManager.replayDLQ(dlqId, replayHandler);
      return c.json({ success });
    } catch (err) {
      logger.error('Failed to replay DLQ', err as Error);
      return c.json({ success: false, error: 'Failed to replay incident' }, 500);
    }
  });

  // GET /api/v1/metrics - Prometheus format
  app.get('/api/v1/metrics', async (c) => {
    const metrics = metricsRegistry.getMetrics();
    return c.text(metrics, 200, {
      'Content-Type': 'text/plain; version=0.0.4',
    });
  });

  // GET /api/v1/health - health check
  app.get('/api/v1/health', async (c) => {
    const status = await deps.healthRegistry.runAll();
    const httpStatus = status.status === 'ok' ? 200 : 503;
    return c.json(status, httpStatus);
  });

  return app as unknown as Hono;
}
