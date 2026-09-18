// ─── Actor-agnostic Chatter roleplay state ─────────────────────────────────
// This route persists bounded handoffs, memory turns and versioned soul.md
// content, and exposes an explicit, auditable provider-turn boundary for an
// assigned LLM actor. Provider dispatch never publishes externally; existing
// assignment, active-shift, agent-permission, consent, approval and
// publication gates remain authoritative.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { formatRoleplayPromptContext, LLMGateway, parseRoleplayHandoff, ROLEPLAY_LIMITS, type RoleplayHandoff, type RoleplayMemoryTurn, type RoleplayPersonaSnapshot } from '@axiom/llm-gateway';
import { schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { modelAccessCondition } from '../model-access.js';
import { apiError, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';

const router = new Hono<AppBindings>();
const uuid = z.string().uuid();
const actorSchema = z.object({ type: z.enum(['human', 'llm']), ref: z.string().trim().min(1).max(128) }).strict();
const conversationKeySchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
const memoryBodySchema = z.object({
  conversationKey: conversationKeySchema,
  sequence: z.number().int().min(1).max(2_147_483_647),
  role: z.enum(['user', 'assistant']),
  speaker: actorSchema,
  content: z.string().trim().min(1).max(4_000),
}).strict();
const handoffBodySchema = z.object({
  conversationKey: conversationKeySchema,
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
  handoff: z.unknown(),
}).strict();
const personaBodySchema = z.object({
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
  sourceRef: z.string().regex(/^soul\.md(?::[A-Za-z0-9._-]{1,128})?$/).default('soul.md'),
  content: z.string().trim().min(1).max(ROLEPLAY_LIMITS.personaCharacters),
}).strict();
const turnBodySchema = z.object({
  conversationKey: conversationKeySchema,
  intentKey: uuid,
  actor: actorSchema,
  content: z.string().trim().min(1).max(4_000),
  confirm: z.literal(true),
}).strict();

const managementRoles = new Set(['owner', 'manager', 'operator']);
const ROLEPLAY_PROVIDER_MODEL = 'grok-roleplayer';

/** The provider boundary is injectable in tests and never publishes anything. */
export const roleplayGateway = new LLMGateway();

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  try { return await readBoundedJson(c.req.raw, 64 * 1024); }
  catch (error) { if (error instanceof RequestBodyTooLargeError) throw error; return {}; }
}

function validActorRef(ref: string): boolean {
  return ref.length <= 128 && !/[\r\n\\/]/u.test(ref) && !ref.includes('..') && !ref.includes(String.fromCharCode(0));
}

/**
 * Require the same assignment boundary used by Chatter, plus the LLM
 * agent_permission boundary for an LLM actor. The row must be in an active
 * team_shift window; a label or a stale token alone is never sufficient.
 */
async function actorShift(
  tx: any,
  orgId: string,
  modelId: string,
  actor: { type: 'human' | 'llm'; ref: string },
  shiftId?: string,
): Promise<{ id: string; actorType: 'human' | 'llm'; actorRef: string; queue: string } | null> {
  if (!validActorRef(actor.ref)) return null;
  const actorCondition = actor.type === 'human'
    ? and(eq(schema.teamShift.assigneeType, 'human'), eq(schema.teamShift.assigneeUserId, actor.ref))
    : and(eq(schema.teamShift.assigneeType, 'llm'), eq(schema.teamShift.assigneeAgentRef, actor.ref));
  const [shift] = await tx.select({ id: schema.teamShift.id, queue: schema.teamShift.queue, actorType: schema.teamShift.assigneeType, actorRef: actor.type === 'human' ? schema.teamShift.assigneeUserId : schema.teamShift.assigneeAgentRef })
    .from(schema.teamShift)
    .where(and(
      eq(schema.teamShift.orgId, orgId),
      eq(schema.teamShift.modelId, modelId),
      actorCondition,
      shiftId ? eq(schema.teamShift.id, shiftId) : undefined,
      eq(schema.teamShift.status, 'active'),
      sql`${schema.teamShift.startsAt} <= statement_timestamp()`,
      sql`${schema.teamShift.endsAt} > statement_timestamp()`,
    )).limit(1);
  if (!shift) return null;
  if (actor.type === 'human') {
    const [assigned] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(
      eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId),
      modelAccessCondition('chatter', orgId, actor.ref, schema.modelProfile.id),
    )).limit(1);
    if (!assigned) return null;
  } else {
    const [permission] = await tx.select({ id: schema.agentPermission.id }).from(schema.agentPermission).where(and(
      eq(schema.agentPermission.orgId, orgId), eq(schema.agentPermission.modelId, modelId),
      eq(schema.agentPermission.agentRef, actor.ref), eq(schema.agentPermission.canEdit, true),
    )).limit(1);
    if (!permission) return null;
  }
  return { id: shift.id, actorType: actor.type, actorRef: actor.ref, queue: shift.queue };
}

async function modelReadable(tx: any, orgId: string, modelId: string, role: unknown, userId?: string): Promise<boolean> {
  const rows = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(
    eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId),
    modelAccessCondition(role, orgId, userId, schema.modelProfile.id),
  )).limit(1);
  return rows.length > 0;
}

function actorFromQuery(c: any, userId: string): { type: 'human' | 'llm'; ref: string } | null {
  const type = c.req.query('actorType') ?? 'human';
  const ref = c.req.query('actorRef') ?? userId;
  const parsed = actorSchema.safeParse({ type, ref });
  return parsed.success ? parsed.data : null;
}

router.get('/models/:modelId/roleplay', async c => {
  const orgId = requireOrg(c), userId = c.get('userId'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!uuid.safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'valid model required');
  const actor = actorFromQuery(c, userId);
  const conversationKey = c.req.query('conversationKey') ?? 'default';
  if (!actor || !conversationKeySchema.safeParse(conversationKey).success) return apiError(c, 400, statusTitle(400), 'valid actor and conversation key required');
  if (actor.type === 'llm' && !managementRoles.has(c.get('role') ?? '')) return apiError(c, 403, statusTitle(403), 'LLM roleplay state is owner-managed');
  const result = await withOrgContext(orgId, async tx => {
    if (!await modelReadable(tx, orgId, modelId, c.get('role'), userId)) return null;
    const shift = await actorShift(tx, orgId, modelId, actor);
    if (!shift) return 'actor' as const;
    const [handoff] = await tx.select().from(schema.roleplayHandoff).where(and(
      eq(schema.roleplayHandoff.orgId, orgId), eq(schema.roleplayHandoff.modelId, modelId),
      eq(schema.roleplayHandoff.conversationKey, conversationKey),
    )).limit(1);
    const [persona] = await tx.select().from(schema.roleplayPersonaRevision).where(and(
      eq(schema.roleplayPersonaRevision.orgId, orgId), eq(schema.roleplayPersonaRevision.modelId, modelId),
      eq(schema.roleplayPersonaRevision.source, 'soul.md'),
    )).orderBy(desc(schema.roleplayPersonaRevision.revision)).limit(1);
    const memory = await tx.select().from(schema.roleplayMemoryTurn).where(and(
      eq(schema.roleplayMemoryTurn.orgId, orgId), eq(schema.roleplayMemoryTurn.modelId, modelId),
      eq(schema.roleplayMemoryTurn.conversationKey, conversationKey),
    )).orderBy(desc(schema.roleplayMemoryTurn.sequence)).limit(ROLEPLAY_LIMITS.memoryTurns);
    return {
      handoff: handoff?.payload ?? null,
      handoffRevision: handoff?.revision ?? 0,
      persona: persona ? { revision: persona.revision, source: persona.source, sourceRef: persona.sourceRef, content: persona.content } : null,
      memory: memory.reverse().map((row: any) => ({ sequence: row.sequence, role: row.role, speaker: { type: row.speakerType, ref: row.speakerRef }, content: row.content })),
      meta: { nextSequence: (memory[0]?.sequence ?? 0) + 1, activeShiftId: shift.id, queue: shift.queue, actor },
    };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'model unavailable');
  if (result === 'actor') return apiError(c, 404, statusTitle(404), 'actor assignment or active shift unavailable');
  return c.json({ data: result });
});

router.get('/models/:modelId/roleplay/persona', async c => {
  const orgId = requireOrg(c), userId = c.get('userId'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  const row = await withOrgContext(orgId, async tx => {
    if (!await modelReadable(tx, orgId, modelId, c.get('role'), userId)) return null;
    const revision = c.req.query('revision');
    const revisionNumber: number | undefined = revision === undefined ? undefined : Number(revision);
    if (revision !== undefined && (typeof revisionNumber !== 'number' || !Number.isSafeInteger(revisionNumber) || revisionNumber < 1)) return 'invalid' as const;
    const revisionFilter = typeof revisionNumber === 'number'
      ? eq(schema.roleplayPersonaRevision.revision, revisionNumber)
      : undefined;
    const [persona] = await tx.select().from(schema.roleplayPersonaRevision).where(and(
      eq(schema.roleplayPersonaRevision.orgId, orgId), eq(schema.roleplayPersonaRevision.modelId, modelId),
      eq(schema.roleplayPersonaRevision.source, 'soul.md'), revisionFilter,
    )).orderBy(desc(schema.roleplayPersonaRevision.revision)).limit(1);
    return persona ? { revision: persona.revision, source: persona.source, sourceRef: persona.sourceRef, content: persona.content } : null;
  });
  if (row === 'invalid') return apiError(c, 400, statusTitle(400), 'invalid persona revision');
  if (row === null) return apiError(c, 404, statusTitle(404), 'persona or model unavailable');
  return c.json({ data: row });
});

router.post('/models/:modelId/roleplay/memory', async c => {
  const orgId = requireOrg(c), userId = c.get('userId'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'memory body too large'); payload = {}; }
  const parsed = memoryBodySchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid bounded memory turn');
  if (parsed.data.speaker.type === 'llm' && !managementRoles.has(c.get('role') ?? '')) return apiError(c, 403, statusTitle(403), 'LLM memory is owner-managed');
  const result = await withOrgContext(orgId, async tx => {
    if (!await modelReadable(tx, orgId, modelId, c.get('role'), userId)) return null;
    const shift = await actorShift(tx, orgId, modelId, parsed.data.speaker);
    if (!shift) return 'actor' as const;
    const [row] = await tx.insert(schema.roleplayMemoryTurn).values({
      orgId, modelId, conversationKey: parsed.data.conversationKey, sequence: parsed.data.sequence,
      role: parsed.data.role, speakerType: parsed.data.speaker.type, speakerRef: parsed.data.speaker.ref,
      content: parsed.data.content,
    }).returning();
    // Keep the persisted tail bounded. Prompt assembly applies the stricter
    // character budget from the saved handoff policy.
    await tx.execute(sql`DELETE FROM roleplay_memory_turn
      WHERE org_id = ${orgId} AND model_id = ${modelId} AND conversation_key = ${parsed.data.conversationKey}
        AND id NOT IN (
          SELECT id FROM roleplay_memory_turn
          WHERE org_id = ${orgId} AND model_id = ${modelId} AND conversation_key = ${parsed.data.conversationKey}
          ORDER BY sequence DESC LIMIT ${ROLEPLAY_LIMITS.memoryTurns}
        )`);
    if (row) await writeAudit(tx, orgId, userId, 'roleplay.memory.append', row.id, { modelId, conversationKey: row.conversationKey, sequence: row.sequence, speakerType: row.speakerType });
    return row ?? null;
  }).catch(error => error instanceof Error && /duplicate|unique/i.test(error.message) ? 'conflict' as const : (() => { throw error; })());
  if (!result) return apiError(c, 404, statusTitle(404), 'model unavailable');
  if (result === 'actor') return apiError(c, 404, statusTitle(404), 'actor assignment or active shift unavailable');
  if (result === 'conflict') return apiError(c, 409, statusTitle(409), 'memory sequence already exists; reload the roleplay context');
  return c.json({ data: { sequence: result.sequence, role: result.role, speaker: { type: result.speakerType, ref: result.speakerRef }, content: result.content } }, 201);
});

router.put('/models/:modelId/roleplay/persona', async c => {
  const orgId = requireOrg(c), userId = c.get('userId'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!managementRoles.has(c.get('role') ?? '')) return apiError(c, 403, statusTitle(403), 'persona editing requires an owner, manager or operator role');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'persona body too large'); payload = {}; }
  const parsed = personaBodySchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid bounded soul.md content');
  const result = await withOrgContext(orgId, async tx => {
    const [model] = await tx.select({ id: schema.modelProfile.id }).from(schema.modelProfile).where(and(eq(schema.modelProfile.id, modelId), eq(schema.modelProfile.orgId, orgId))).limit(1).for('update');
    if (!model) return null;
    const [previous] = await tx.select().from(schema.roleplayPersonaRevision).where(and(
      eq(schema.roleplayPersonaRevision.orgId, orgId), eq(schema.roleplayPersonaRevision.modelId, modelId), eq(schema.roleplayPersonaRevision.source, 'soul.md'),
    )).orderBy(desc(schema.roleplayPersonaRevision.revision)).limit(1).for('update');
    if ((previous?.revision ?? 0) !== parsed.data.expectedRevision) return 'conflict' as const;
    const [row] = await tx.insert(schema.roleplayPersonaRevision).values({
      orgId, modelId, source: 'soul.md', revision: (previous?.revision ?? 0) + 1,
      sourceRef: parsed.data.sourceRef, content: parsed.data.content, createdByUserId: userId,
    }).returning();
    if (row) await writeAudit(tx, orgId, userId, 'roleplay.persona.save', row.id, { modelId, source: row.source, revision: row.revision, sourceRef: row.sourceRef });
    return row ?? null;
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'model not found');
  if (result === 'conflict') return apiError(c, 409, statusTitle(409), 'persona changed since you opened it; reload before saving');
  return c.json({ data: { revision: result.revision, source: result.source, sourceRef: result.sourceRef, content: result.content } }, 201);
});

router.put('/models/:modelId/roleplay/handoff', async c => {
  const orgId = requireOrg(c), userId = c.get('userId'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'handoff body too large'); payload = {}; }
  const parsed = handoffBodySchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid roleplay handoff envelope');
  let handoff: RoleplayHandoff;
  try {
    if (!parsed.data.handoff || typeof parsed.data.handoff !== 'object' || Array.isArray(parsed.data.handoff)) throw new Error('handoff must be an object');
    handoff = parseRoleplayHandoff(JSON.stringify({ ...(parsed.data.handoff as Record<string, unknown>), orgId, modelId }));
  }
  catch { return apiError(c, 400, statusTitle(400), 'handoff failed bounded schema validation'); }
  const actor = handoff.actor;
  if (actor.type === 'llm' && !managementRoles.has(c.get('role') ?? '')) return apiError(c, 403, statusTitle(403), 'LLM handoffs are owner-managed');
  const result = await withOrgContext(orgId, async tx => {
    if (!await modelReadable(tx, orgId, modelId, c.get('role'), userId)) return null;
    const shift = await actorShift(tx, orgId, modelId, actor, handoff.shiftId);
    if (!shift) return 'actor' as const;
    if (shift.actorType !== actor.type || shift.actorRef !== actor.ref) return 'shift' as const;
    const [current] = await tx.select().from(schema.roleplayHandoff).where(and(
      eq(schema.roleplayHandoff.orgId, orgId), eq(schema.roleplayHandoff.modelId, modelId), eq(schema.roleplayHandoff.conversationKey, parsed.data.conversationKey),
    )).limit(1).for('update');
    if ((current?.revision ?? 0) !== parsed.data.expectedRevision) return 'conflict' as const;
    const values = {
      actorType: actor.type, actorRef: actor.ref, shiftId: handoff.shiftId,
      revision: parsed.data.expectedRevision + 1, payload: handoff, updatedAt: new Date(),
    };
    const [row] = current
      ? await tx.update(schema.roleplayHandoff).set(values).where(eq(schema.roleplayHandoff.id, current.id)).returning()
      : await tx.insert(schema.roleplayHandoff).values({ orgId, modelId, conversationKey: parsed.data.conversationKey, ...values }).returning();
    if (row) await writeAudit(tx, orgId, userId, 'roleplay.handoff.save', row.id, { modelId, conversationKey: row.conversationKey, actorType: row.actorType, revision: row.revision });
    return row ?? null;
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'model unavailable');
  if (result === 'actor') return apiError(c, 404, statusTitle(404), 'actor assignment or active shift unavailable');
  if (result === 'shift') return apiError(c, 409, statusTitle(409), 'handoff actor does not match the active shift');
  if (result === 'conflict') return apiError(c, 409, statusTitle(409), 'handoff changed since you opened it; reload before saving');
  return c.json({ data: { revision: result.revision, handoff: result.payload } }, parsed.data.expectedRevision === 0 ? 201 : 200);
});

function providerFailure(error: unknown): { state: 'rejected' | 'uncertain'; status: number; errorCode: string; message: string } {
  const status = typeof error === 'object' && error !== null && 'status' in error && Number.isInteger(Number(error.status))
    ? Number(error.status) : 503;
  if (status >= 400 && status < 500) {
    return { state: 'rejected', status, errorCode: status === 401 ? 'provider-auth-required' : 'provider-rejected', message: 'roleplay provider rejected the turn; no reply was published' };
  }
  return { state: 'uncertain', status: 503, errorCode: 'provider-uncertain', message: 'roleplay provider outcome is uncertain; reconcile the turn before retrying' };
}

function roleplayTurnResponse(row: any) {
  return {
    data: {
      turnId: row.id,
      state: row.state,
      provider: row.provider,
      providerModel: row.providerModel,
      content: row.state === 'completed' ? row.output : null,
      providerRequestId: row.providerRequestId ?? null,
      errorCode: row.errorCode ?? null,
    },
  } as const;
}

router.post('/models/:modelId/roleplay/turn', async c => {
  const orgId = requireOrg(c), userId = c.get('userId'), role = c.get('role'), modelId = c.req.param('modelId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!managementRoles.has(role ?? '')) return apiError(c, 403, statusTitle(403), 'roleplay provider turns are owner-managed');
  if (!uuid.safeParse(modelId).success) return apiError(c, 400, statusTitle(400), 'valid model required');
  let payload: unknown;
  try { payload = await readBody(c); } catch (error) { if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'roleplay turn body too large'); payload = {}; }
  const parsed = turnBodySchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid confirmed roleplay turn');
  if (parsed.data.actor.type !== 'llm') return apiError(c, 409, statusTitle(409), 'provider turns require an assigned LLM actor');

  const prepared = await withOrgContext(orgId, async tx => {
    if (!await modelReadable(tx, orgId, modelId, role, userId)) return null;
    const shift = await actorShift(tx, orgId, modelId, parsed.data.actor);
    if (!shift) return 'actor' as const;
    const [existing] = await tx.select().from(schema.roleplayTurn).where(and(
      eq(schema.roleplayTurn.orgId, orgId), eq(schema.roleplayTurn.modelId, modelId), eq(schema.roleplayTurn.intentKey, parsed.data.intentKey),
    )).limit(1);
    if (existing) {
      if (existing.conversationKey !== parsed.data.conversationKey || existing.actorType !== parsed.data.actor.type || existing.actorRef !== parsed.data.actor.ref || existing.input !== parsed.data.content) return 'conflict' as const;
      return { kind: 'existing' as const, row: existing };
    }
    const [handoffRow] = await tx.select().from(schema.roleplayHandoff).where(and(
      eq(schema.roleplayHandoff.orgId, orgId), eq(schema.roleplayHandoff.modelId, modelId), eq(schema.roleplayHandoff.conversationKey, parsed.data.conversationKey),
    )).limit(1);
    if (!handoffRow) return 'handoff' as const;
    let handoff: RoleplayHandoff;
    try {
      handoff = parseRoleplayHandoff(JSON.stringify({
        schema: 'axiom.roleplay-handoff',
        version: 1,
        handoff: handoffRow.payload,
      }));
    } catch { return 'handoff' as const; }
    if (handoff.actor.type !== parsed.data.actor.type || handoff.actor.ref !== parsed.data.actor.ref) return 'handoff' as const;
    const [personaRow] = await tx.select().from(schema.roleplayPersonaRevision).where(and(
      eq(schema.roleplayPersonaRevision.orgId, orgId), eq(schema.roleplayPersonaRevision.modelId, modelId), eq(schema.roleplayPersonaRevision.source, 'soul.md'),
    )).orderBy(desc(schema.roleplayPersonaRevision.revision)).limit(1);
    const memoryRows = await tx.select().from(schema.roleplayMemoryTurn).where(and(
      eq(schema.roleplayMemoryTurn.orgId, orgId), eq(schema.roleplayMemoryTurn.modelId, modelId), eq(schema.roleplayMemoryTurn.conversationKey, parsed.data.conversationKey),
    )).orderBy(desc(schema.roleplayMemoryTurn.sequence)).limit(ROLEPLAY_LIMITS.memoryTurns);
    const persona: RoleplayPersonaSnapshot | null = personaRow ? {
      orgId, modelId, source: personaRow.source, revision: personaRow.revision, sourceRef: personaRow.sourceRef, content: personaRow.content,
    } : null;
    const memory: RoleplayMemoryTurn[] = memoryRows.reverse().map((row: any) => ({ sequence: row.sequence, role: row.role, content: row.content }));
    const [row] = await tx.insert(schema.roleplayTurn).values({
      orgId, modelId, conversationKey: parsed.data.conversationKey, intentKey: parsed.data.intentKey,
      actorType: parsed.data.actor.type, actorRef: parsed.data.actor.ref, shiftId: shift.id,
      provider: 'grok', providerModel: ROLEPLAY_PROVIDER_MODEL, personaRevision: persona?.revision ?? null,
      input: parsed.data.content, state: 'pending',
    }).returning();
    if (row) await writeAudit(tx, orgId, userId, 'roleplay.turn.prepare', row.id, { modelId, actorType: row.actorType, provider: row.provider });
    return row ? { kind: 'new' as const, row, handoff, persona, memory } : null;
  });
  if (!prepared) return apiError(c, 404, statusTitle(404), 'model unavailable');
  if (prepared === 'actor') return apiError(c, 404, statusTitle(404), 'LLM assignment or active shift unavailable');
  if (prepared === 'handoff') return apiError(c, 409, statusTitle(409), 'roleplay handoff is missing, stale or assigned to another actor');
  if (prepared === 'conflict') return apiError(c, 409, statusTitle(409), 'intent key already belongs to different roleplay content');
  if (prepared.kind === 'existing') {
    if (prepared.row.state === 'completed') return c.json(roleplayTurnResponse(prepared.row), 200);
    if (prepared.row.state === 'uncertain') return apiError(c, 503, statusTitle(503), 'roleplay provider outcome is uncertain; reconcile the turn before retrying');
    if (prepared.row.state === 'rejected') return apiError(c, 409, statusTitle(409), 'roleplay turn was rejected; create a new intent after correcting the issue');
    return apiError(c, 409, statusTitle(409), 'roleplay turn is pending; do not retry');
  }

  let result: Awaited<ReturnType<LLMGateway['chat']>>;
  try {
    const promptContext = formatRoleplayPromptContext({ handoff: prepared.handoff, persona: prepared.persona, memory: prepared.memory });
    result = await roleplayGateway.chat([
      { role: 'system', content: promptContext },
      { role: 'user', content: prepared.row.input },
    ], { provider: 'grok', model: ROLEPLAY_PROVIDER_MODEL, userId, maxTokens: 2_000, temperature: 0.8 });
    if (!result.content.trim() || result.content.length > 8_000) throw Object.assign(new Error('bounded provider response required'), { status: 502 });
  } catch (error) {
    const failure = providerFailure(error);
    await withOrgContext(orgId, async tx => {
      await tx.update(schema.roleplayTurn).set({ state: failure.state, providerStatus: failure.status, errorCode: failure.errorCode, finalizedAt: sql`clock_timestamp()` })
        .where(and(eq(schema.roleplayTurn.id, prepared.row.id), eq(schema.roleplayTurn.state, 'pending')));
      await writeAudit(tx, orgId, userId, `roleplay.turn.${failure.state}`, prepared.row.id, { modelId, provider: 'grok', providerStatus: failure.status, errorCode: failure.errorCode });
    });
    return apiError(c, failure.status, statusTitle(failure.status), failure.message);
  }

  try {
    const finalized = await withOrgContext(orgId, async tx => {
      const [current] = await tx.select().from(schema.roleplayTurn).where(and(eq(schema.roleplayTurn.id, prepared.row.id), eq(schema.roleplayTurn.state, 'pending'))).limit(1).for('update');
      if (!current) return null;
      const [tail] = await tx.select({ maxSequence: sql<number>`coalesce(max(${schema.roleplayMemoryTurn.sequence}), 0)` }).from(schema.roleplayMemoryTurn).where(and(
        eq(schema.roleplayMemoryTurn.orgId, orgId), eq(schema.roleplayMemoryTurn.modelId, modelId), eq(schema.roleplayMemoryTurn.conversationKey, prepared.row.conversationKey),
      ));
      const nextSequence = Number(tail?.maxSequence ?? 0) + 1;
      await tx.insert(schema.roleplayMemoryTurn).values([
        { orgId, modelId, conversationKey: prepared.row.conversationKey, sequence: nextSequence, role: 'user', speakerType: 'human', speakerRef: 'conversation', content: prepared.row.input },
        { orgId, modelId, conversationKey: prepared.row.conversationKey, sequence: nextSequence + 1, role: 'assistant', speakerType: 'llm', speakerRef: prepared.row.actorRef, content: result.content },
      ]);
      await tx.execute(sql`DELETE FROM roleplay_memory_turn WHERE org_id = ${orgId} AND model_id = ${modelId} AND conversation_key = ${prepared.row.conversationKey} AND id NOT IN (SELECT id FROM roleplay_memory_turn WHERE org_id = ${orgId} AND model_id = ${modelId} AND conversation_key = ${prepared.row.conversationKey} ORDER BY sequence DESC LIMIT ${ROLEPLAY_LIMITS.memoryTurns})`);
      const [row] = await tx.update(schema.roleplayTurn).set({ state: 'completed', output: result.content, providerRequestId: result.id, providerStatus: 200, finalizedAt: sql`clock_timestamp()` })
        .where(and(eq(schema.roleplayTurn.id, prepared.row.id), eq(schema.roleplayTurn.state, 'pending'))).returning();
      if (!row) return null;
      await writeAudit(tx, orgId, userId, 'roleplay.turn.completed', row.id, { modelId, provider: row.provider, providerRequestId: row.providerRequestId });
      return row;
    });
    if (!finalized) return apiError(c, 503, statusTitle(503), 'roleplay result could not be durably recorded; reconcile the turn before retrying');
    return c.json(roleplayTurnResponse(finalized), 201);
  } catch {
    await withOrgContext(orgId, async tx => {
      await tx.update(schema.roleplayTurn).set({ state: 'uncertain', providerStatus: 503, errorCode: 'persistence-uncertain', finalizedAt: sql`clock_timestamp()` })
        .where(and(eq(schema.roleplayTurn.id, prepared.row.id), eq(schema.roleplayTurn.state, 'pending')));
    });
    return apiError(c, 503, statusTitle(503), 'roleplay result persistence is uncertain; reconcile the turn before retrying');
  }
});

export { router as roleplayRouter };
