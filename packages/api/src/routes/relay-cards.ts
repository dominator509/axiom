// ─── Model Relay-card history (F-68/F-69/F-72, L2.7) ─────────────────────
// Read-only, model-scoped history for cards created by approval, digest and
// operator workflows. Provider references/configuration are deliberately not
// exposed here; this surface is discovery and audit context, not publishing.

import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { cursorLt, nextCursor, parseCursor } from '../contract.js';
import { modelAccessCondition } from '../model-access.js';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();

const reconciliationSchema = z.object({
  outcome: z.enum(['delivered', 'not_delivered']),
}).strict();

const reconciliationRoles = new Set(['owner', 'manager', 'operator']);

const publicCard = {
  id: schema.relayCard.id,
  bundleId: schema.relayCard.bundleId,
  modelId: schema.relayCard.modelId,
  channel: schema.relayCard.channel,
  state: schema.relayCard.state,
  title: schema.relayCard.title,
  description: schema.relayCard.description,
  icon: schema.relayCard.icon,
  enabled: schema.relayCard.enabled,
  priority: schema.relayCard.priority,
  createdAt: schema.relayCard.createdAt,
  // Kept out of the generic response; safeRelayCard extracts only the
  // non-secret Snapchat manual-assist fields for the human action UI.
  config: schema.relayCard.config,
};

function safeSnapchatHandoff(channel: string | null, config: unknown) {
  if (channel !== 'manual-assist' || !config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const candidate = (config as Record<string, unknown>).snapchatManualAssist;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const value = candidate as Record<string, unknown>;
  const instructions = typeof value.instructions === 'string' ? value.instructions.slice(0, 2000) : '';
  const caption = typeof value.caption === 'string' ? value.caption.slice(0, 1000) : '';
  const assets = Array.isArray(value.assets)
    ? value.assets.flatMap(asset => {
        if (typeof asset !== 'string' || asset.length > 2048) return [];
        try {
          const parsed = new URL(asset);
          return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? [parsed.toString()] : [];
        } catch { return []; }
      }).slice(0, 4)
    : [];
  let handoffUrl: string | undefined;
  if (typeof value.handoffUrl === 'string') {
    try {
      const parsed = new URL(value.handoffUrl);
      if (parsed.protocol === 'https:' && (parsed.hostname === 'snapchat.com' || parsed.hostname.endsWith('.snapchat.com')) && !parsed.username && !parsed.password) handoffUrl = parsed.toString();
    } catch { /* omit invalid external link */ }
  }
  return { instructions, caption, assets, ...(handoffUrl ? { handoffUrl } : {}) };
}

function safeRelayCard(row: {
  id: string;
  bundleId: string | null;
  modelId: string | null;
  channel: string | null;
  state: string;
  title: string;
  description: string | null;
  icon: string | null;
  enabled: boolean;
  priority: number;
  createdAt: Date;
  config?: unknown;
}) {
  return {
    id: row.id,
    bundleId: row.bundleId,
    modelId: row.modelId,
    channel: row.channel,
    state: row.state,
    title: row.title,
    description: row.description,
    icon: row.icon,
    enabled: row.enabled,
    priority: row.priority,
    createdAt: row.createdAt,
    snapchatHandoff: safeSnapchatHandoff(row.channel ?? null, row.config),
  };
}

// GET /api/v1/models/:modelId/relay-cards — cursor-paginated card history.
router.get('/models/:modelId/relay-cards', async c => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');

  const modelId = c.req.param('modelId');
  const modelOrg = await withOrgContext(orgId, tx => modelOrgId(tx, modelId));
  if (modelOrg !== orgId) return apiError(c, 404, statusTitle(404), 'model not found');

  const { limit, cursor } = parseCursor(c, 20, 100);
  const rows = await withOrgContext(orgId, tx => tx
    .select(publicCard)
    .from(schema.relayCard)
    .leftJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.relayCard.bundleId))
    .where(and(
      eq(schema.relayCard.orgId, orgId),
      or(eq(schema.relayCard.modelId, modelId), eq(schema.contentBundle.modelId, modelId)),
      or(
        modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.relayCard.modelId),
        modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.contentBundle.modelId),
      ),
      ...cursorLt(schema.relayCard.createdAt, schema.relayCard.id, cursor),
    ))
    .orderBy(desc(schema.relayCard.createdAt), desc(schema.relayCard.id))
    .limit(limit));

  const data = rows.map(safeRelayCard);
  const last = data[data.length - 1];
  return c.json({
    data,
    meta: {
      total: data.length,
      limit,
      next_cursor: nextCursor(last?.createdAt, last?.id, limit, data.length),
    },
  });
});

/**
 * POST /api/v1/models/:modelId/relay-cards/:cardId/reconcile
 *
 * An operator records an observed outcome for a card that is still pending or
 * uncertain. This is deliberately a local compare-and-set: it never contacts
 * a channel provider, retries a dispatch, or treats the operator's statement
 * as provider proof. Repeating the same terminal outcome is idempotent;
 * changing an already-terminal outcome is a conflict.
 */
router.post(
  '/models/:modelId/relay-cards/:cardId/reconcile',
  zValidator('json', reconciliationSchema),
  async c => {
    const orgId = requireOrg(c);
    if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
    const userId = c.get('userId');
    if (!userId) return apiError(c, 401, statusTitle(401), 'authentication required');
    const role = c.get('role');
    if (!reconciliationRoles.has(role ?? '')) {
      return apiError(c, 403, statusTitle(403), 'relay reconciliation requires an owner, manager or operator role');
    }

    const modelId = c.req.param('modelId');
    const cardId = c.req.param('cardId');
    const { outcome } = c.req.valid('json');
    const nextState = outcome === 'delivered' ? 'sent' : 'failed';

    const result = await withOrgContext(orgId, async tx => {
      const rows = await tx
        .select({ card: publicCard, modelId: schema.contentBundle.modelId })
        .from(schema.relayCard)
        .leftJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.relayCard.bundleId))
        .where(and(
          eq(schema.relayCard.id, cardId),
          eq(schema.relayCard.orgId, orgId),
          or(eq(schema.relayCard.modelId, modelId), eq(schema.contentBundle.modelId, modelId)),
          or(
            modelAccessCondition(role, orgId, userId, schema.relayCard.modelId),
            modelAccessCondition(role, orgId, userId, schema.contentBundle.modelId),
          ),
        ))
        .limit(1)
        .for('update');
      const current = rows[0];
      if (!current) return { status: 404 as const, error: 'relay card not found' };

      if (current.card.state === nextState) {
        return {
          status: 200 as const,
          data: safeRelayCard(current.card),
          idempotent: true,
        };
      }
      if (current.card.state !== 'pending' && current.card.state !== 'unknown') {
        return {
          status: 409 as const,
          error: 'only pending or uncertain relay cards can be reconciled',
        };
      }

      const updated = await tx
        .update(schema.relayCard)
        .set({ state: nextState })
        .where(and(
          eq(schema.relayCard.id, cardId),
          eq(schema.relayCard.orgId, orgId),
          inArray(schema.relayCard.state, ['pending', 'unknown']),
        ))
        .returning();
      if (!updated[0]) {
        return {
          status: 409 as const,
          error: 'relay card changed before reconciliation; refresh and review it again',
        };
      }

      await writeAudit(tx, orgId, userId, 'relay.card.reconcile', cardId, {
        modelId,
        priorState: current.card.state,
        outcome,
        nextState,
      });
      return {
        status: 200 as const,
        data: safeRelayCard(updated[0]),
        idempotent: false,
      };
    });

    if (result.status !== 200) return apiError(c, result.status, statusTitle(result.status), result.error);
    return c.json({ data: result.data, meta: { idempotent: result.idempotent, outcome } });
  },
);

export { router as relayCardsRouter };
