// ─── Model Relay-card history (F-68/F-69/F-72, L2.7) ─────────────────────
// Read-only, model-scoped history for cards created by approval, digest and
// operator workflows. Provider references/configuration are deliberately not
// exposed here; this surface is discovery and audit context, not publishing.

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { cursorLt, nextCursor, parseCursor } from '../contract.js';
import { modelAccessCondition } from '../model-access.js';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext } from './helpers.js';

const router = new Hono<AppBindings>();

const publicCard = {
  id: schema.relayCard.id,
  bundleId: schema.relayCard.bundleId,
  channel: schema.relayCard.channel,
  state: schema.relayCard.state,
  title: schema.relayCard.title,
  description: schema.relayCard.description,
  icon: schema.relayCard.icon,
  enabled: schema.relayCard.enabled,
  priority: schema.relayCard.priority,
  createdAt: schema.relayCard.createdAt,
};

function safeRelayCard(row: {
  id: string;
  bundleId: string | null;
  channel: string | null;
  state: string;
  title: string;
  description: string | null;
  icon: string | null;
  enabled: boolean;
  priority: number;
  createdAt: Date;
}) {
  return {
    id: row.id,
    bundleId: row.bundleId,
    channel: row.channel,
    state: row.state,
    title: row.title,
    description: row.description,
    icon: row.icon,
    enabled: row.enabled,
    priority: row.priority,
    createdAt: row.createdAt,
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
    .innerJoin(schema.contentBundle, eq(schema.contentBundle.id, schema.relayCard.bundleId))
    .where(and(
      eq(schema.relayCard.orgId, orgId),
      eq(schema.contentBundle.orgId, orgId),
      eq(schema.contentBundle.modelId, modelId),
      modelAccessCondition(c.get('role'), orgId, c.get('userId'), schema.contentBundle.modelId),
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

export { router as relayCardsRouter };
