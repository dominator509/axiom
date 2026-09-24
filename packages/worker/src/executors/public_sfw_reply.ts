import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { PUBLIC_SFW_PLATFORMS, validatePublicSfwReply } from '@axiom/fanvue-mcp';
import { asPlatform, connectorForConnection } from '../connection.js';
import { ParkJobError, EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX } from './context.js';
import type { Executor } from './context.js';

const KILL_SWITCH_PARK_MS = 60_000;

export const publicSfwReply: Executor = async (ctx) => {
  const { tx, job, killSwitchEnabled } = ctx;
  if (killSwitchEnabled) throw new ParkJobError('public.sfw.reply: kill switch enabled - parked', KILL_SWITCH_PARK_MS);
  const payload = job.payload as {
    modelId?: unknown;
    connectionId?: unknown;
    platform?: unknown;
    postId?: unknown;
    commentId?: unknown;
    text?: unknown;
  } | null;
  if (!payload || typeof payload.modelId !== 'string' || typeof payload.connectionId !== 'string'
    || typeof payload.platform !== 'string' || typeof payload.postId !== 'string'
    || typeof payload.commentId !== 'string' || typeof payload.text !== 'string') {
    throw new Error('public.sfw.reply: bounded dispatch payload required');
  }
  let platform;
  try { platform = asPlatform(payload.platform); }
  catch { throw new Error('public.sfw.reply: unsupported platform'); }
  if (!PUBLIC_SFW_PLATFORMS.includes(platform) || payload.text.length > 4_000
    || !validatePublicSfwReply(payload.text, platform)) {
    throw new Error('public.sfw.reply: outbound text failed the public SFW ToS gate');
  }

  const [connection] = await tx.select().from(schema.platformConnection).where(and(
    eq(schema.platformConnection.id, payload.connectionId),
    eq(schema.platformConnection.orgId, job.org_id),
    eq(schema.platformConnection.modelId, payload.modelId),
    eq(schema.platformConnection.platform, platform),
    inArray(schema.platformConnection.status, ['connected', 'active']),
  )).limit(1).for('update');
  if (!connection) throw new Error('public.sfw.reply: active model connection is unavailable');

  const { connector } = await connectorForConnection(connection);
  if (!connector.executeOperation || !connector.capability().operations?.includes('comments.reply'))
    throw new Error('public.sfw.reply: provider no longer grants comments.reply');
  if (!ctx.markExternalSideEffect || !ctx.persistSideEffectMarker)
    throw new Error('public.sfw.reply: durable dispatch marker is unavailable');

  const markerResult = await ctx.persistSideEffectMarker<{ rows: Array<{ id: string }> }>((markerTx) => markerTx.execute(sql`
    UPDATE job SET last_error = ${`${EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX} public reply dispatch started`}
    WHERE id = ${job.id}::uuid AND org_id = ${job.org_id}::uuid
      AND state = 'running' AND locked_by = ${ctx.workerId}
    RETURNING id
  `));
  if (!Array.isArray(markerResult?.rows) || markerResult.rows.length !== 1)
    throw new Error('public.sfw.reply: durable dispatch marker could not be committed');
  ctx.markExternalSideEffect();

  const result = await connector.executeOperation({ type: 'comments.reply', commentId: payload.commentId, text: payload.text });
  if (result.type !== 'mutation' || result.success !== true)
    throw new Error('public.sfw.reply: provider did not confirm the reply; outcome requires reconciliation');
};
