// F-21 keyword moderation on provider comments using only live connector capabilities.
import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@axiom/db';
import { asPlatform, connectorForConnection } from '@axiom/worker';
import type { AppBindings } from '../index.js';
import { boundedJsonValidator as zValidator } from '../bounded-json-validator.js';
import { matchingModerationKeywords } from '../comment-moderation-contract.js';
import { apiError, modelOrgId, requireOrg, statusTitle, withOrgContext, writeAudit } from './helpers.js';

const router = new Hono<AppBindings>();
const writeRoles = new Set(['owner', 'manager', 'operator']);
const ruleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(50),
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(24),
  action: z.enum(['hide', 'hide_and_block']),
  enabled: z.boolean().optional(),
}).strict().superRefine((rule, ctx) => {
  const normalized = rule.keywords.map(value => value.normalize('NFKC').toLocaleLowerCase('und'));
  if (new Set(normalized).size !== normalized.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywords'], message: 'keywords must be unique after normalization' });
  }
});
const keywordsSchema = z.array(z.string().trim().min(1).max(80)).min(1).max(24).superRefine((keywords, ctx) => {
  const normalized = keywords.map(value => value.normalize('NFKC').toLocaleLowerCase('und'));
  if (new Set(normalized).size !== normalized.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'keywords must be unique after normalization' });
  }
});
const updateRuleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  keywords: keywordsSchema.optional(),
  action: z.enum(['hide', 'hide_and_block']).optional(),
  enabled: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'at least one moderation rule field is required');
const scanSchema = z.object({
  connectionId: z.string().uuid(),
  postId: z.string().trim().min(1).max(256),
  cursor: z.string().max(512).optional(),
}).strict();

function parsePlatform(value: string): string | null {
  try { return asPlatform(value); } catch { return null; }
}

router.get('/models/:modelId/moderation/rules', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const modelId = c.req.param('modelId');
  const result = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const [rules, history] = await Promise.all([
      tx.select().from(schema.commentModerationRule).where(and(
        eq(schema.commentModerationRule.orgId, orgId), eq(schema.commentModerationRule.modelId, modelId),
      )).orderBy(desc(schema.commentModerationRule.createdAt)).limit(100),
      tx.select({ id: schema.commentModerationAction.id, connectionId: schema.commentModerationAction.connectionId,
        ruleId: schema.commentModerationAction.ruleId, postId: schema.commentModerationAction.postId,
        status: schema.commentModerationAction.status, matchedKeywordCount: schema.commentModerationAction.matchedKeywordCount,
        createdAt: schema.commentModerationAction.createdAt, resolvedAt: schema.commentModerationAction.resolvedAt,
      }).from(schema.commentModerationAction).where(and(
        eq(schema.commentModerationAction.orgId, orgId), eq(schema.commentModerationAction.modelId, modelId),
      )).orderBy(desc(schema.commentModerationAction.createdAt)).limit(100),
    ]);
    return { rules, history };
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: result.rules, history: result.history, meta: { total: result.rules.length } });
});

router.post('/models/:modelId/moderation/rules', zValidator('json', ruleSchema), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!writeRoles.has(c.get('role') ?? '')) return apiError(c, 403, statusTitle(403), 'only an owner, manager or operator can manage moderation rules');
  const modelId = c.req.param('modelId');
  const body = c.req.valid('json');
  const platform = parsePlatform(body.platform);
  if (!platform) return apiError(c, 400, statusTitle(400), 'unsupported moderation platform');
  const result = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const [row] = await tx.insert(schema.commentModerationRule).values({
      orgId, modelId, name: body.name, platform, keywords: body.keywords,
      action: body.action, enabled: body.enabled ?? true, createdByUserId: userId,
    }).onConflictDoNothing().returning();
    if (row) await writeAudit(tx, orgId, userId, 'comment_moderation.rule.create', row.id, {
      platform, action: row.action, keywordCount: body.keywords.length,
    });
    return row ?? null;
  });
  if (!result) return apiError(c, 409, statusTitle(409), 'rule name already exists or model is unavailable');
  return c.json({ data: result }, 201);
});

router.patch('/models/:modelId/moderation/rules/:ruleId', zValidator('json', updateRuleSchema), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!writeRoles.has(c.get('role') ?? '')) return apiError(c, 403, statusTitle(403), 'only an owner, manager or operator can manage moderation rules');
  const modelId = c.req.param('modelId');
  const ruleId = c.req.param('ruleId');
  const body = c.req.valid('json');
  const result = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const updated = await tx.update(schema.commentModerationRule).set({ ...body, updatedAt: new Date() }).where(and(
      eq(schema.commentModerationRule.id, ruleId), eq(schema.commentModerationRule.orgId, orgId),
      eq(schema.commentModerationRule.modelId, modelId),
    )).returning();
    if (updated[0]) await writeAudit(tx, orgId, userId, 'comment_moderation.rule.update', ruleId, {
      enabled: updated[0].enabled, action: updated[0].action, keywordCount: updated[0].keywords.length,
    });
    return updated[0] ?? null;
  });
  if (!result) return apiError(c, 404, statusTitle(404), 'moderation rule not found');
  return c.json({ data: result });
});

router.delete('/models/:modelId/moderation/rules/:ruleId', async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!writeRoles.has(c.get('role') ?? '')) return apiError(c, 403, statusTitle(403), 'only an owner, manager or operator can manage moderation rules');
  const modelId = c.req.param('modelId');
  const ruleId = c.req.param('ruleId');
  const deleted = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return [];
    const rows = await tx.update(schema.commentModerationRule).set({ enabled: false, updatedAt: new Date() }).where(and(
      eq(schema.commentModerationRule.id, ruleId), eq(schema.commentModerationRule.orgId, orgId),
      eq(schema.commentModerationRule.modelId, modelId),
    )).returning({ id: schema.commentModerationRule.id });
    if (rows[0]) await writeAudit(tx, orgId, userId, 'comment_moderation.rule.disable', ruleId, {});
    return rows;
  });
  if (deleted.length === 0) return apiError(c, 404, statusTitle(404), 'moderation rule not found');
  return c.json({ data: { id: ruleId, disabled: true } });
});

router.post('/models/:modelId/moderation/scan', zValidator('json', scanSchema), async (c) => {
  const orgId = requireOrg(c);
  const userId = c.get('userId');
  if (!orgId || !userId) return apiError(c, 401, statusTitle(401), 'authenticated workspace required');
  if (!writeRoles.has(c.get('role') ?? '')) return apiError(c, 403, statusTitle(403), 'only an owner, manager or operator can run moderation scans');
  const modelId = c.req.param('modelId');
  const body = c.req.valid('json');
  const loaded = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const connections = await tx.select().from(schema.platformConnection).where(and(
      eq(schema.platformConnection.id, body.connectionId), eq(schema.platformConnection.orgId, orgId),
      eq(schema.platformConnection.modelId, modelId), inArray(schema.platformConnection.status, ['connected', 'active']),
    )).limit(1);
    const connection = connections[0];
    if (!connection) return { error: 'connected account not found for this model' } as const;
    const rules = await tx.select().from(schema.commentModerationRule).where(and(
      eq(schema.commentModerationRule.orgId, orgId), eq(schema.commentModerationRule.modelId, modelId),
      eq(schema.commentModerationRule.platform, connection.platform), eq(schema.commentModerationRule.enabled, true),
    )).limit(100);
    return { connection, rules } as const;
  });
  if (!loaded) return apiError(c, 404, statusTitle(404), 'model not found');
  if ('error' in loaded) return apiError(c, 404, statusTitle(404), loaded.error ?? 'connected account could not be loaded');
  if (loaded.rules.length === 0) return apiError(c, 409, statusTitle(409), 'no enabled moderation rules match this provider');

  let connector;
  try { connector = (await connectorForConnection(loaded.connection)).connector; }
  catch { return apiError(c, 503, statusTitle(503), 'provider credentials or egress are unavailable'); }
  const capability = connector.capability();
  if (!connector.executeOperation || !capability.operations?.includes('comments.read') || !capability.operations?.includes('comments.moderate')) {
    return apiError(c, 403, statusTitle(403), 'provider does not grant comment reading and moderation');
  }
  const supportedRules = loaded.rules.filter((rule: { action: string }) => {
    if (!capability.moderationActions?.includes('hide')) return false;
    return rule.action === 'hide' || capability.moderationActions.includes('block');
  });
  const unsupportedRuleIds = loaded.rules.filter((rule: { id: string }) => !supportedRules.some((supported: { id: string }) => supported.id === rule.id)).map((rule: { id: string }) => rule.id);
  if (supportedRules.length === 0) return apiError(c, 422, statusTitle(422), 'provider cannot perform the hide/block actions configured by these rules');

  let commentsResult;
  try {
    commentsResult = await connector.executeOperation({ type: 'comments.read', postId: body.postId, cursor: body.cursor, limit: 100 });
  } catch {
    return apiError(c, 502, statusTitle(502), 'provider comment scan failed');
  }
  if (commentsResult.type !== 'comments' || !Array.isArray(commentsResult.items) || commentsResult.items.length > 100
    || (commentsResult.nextCursor !== undefined
      && (typeof commentsResult.nextCursor !== 'string' || commentsResult.nextCursor.length === 0 || commentsResult.nextCursor.length > 512))) {
    return apiError(c, 502, statusTitle(502), 'provider returned an invalid comment page');
  }

  const proposed = commentsResult.items.flatMap((comment) => supportedRules.flatMap((rule: { id: string; keywords: string[] }) => {
    if (!comment.id || comment.id.length > 256 || typeof comment.text !== 'string') return [];
    const matches = matchingModerationKeywords(comment.text, rule.keywords);
    return matches.length ? [{
      orgId, modelId, connectionId: loaded.connection.id, ruleId: rule.id,
      postId: body.postId, providerCommentId: comment.id, matchedKeywordCount: matches.length,
    }] : [];
  }));
  const pending = proposed.length === 0 ? [] : await withOrgContext(orgId, (tx) => tx.insert(schema.commentModerationAction)
    .values(proposed).onConflictDoNothing().returning({
      id: schema.commentModerationAction.id, ruleId: schema.commentModerationAction.ruleId,
      providerCommentId: schema.commentModerationAction.providerCommentId,
      matchedKeywordCount: schema.commentModerationAction.matchedKeywordCount,
    }));

  let applied = 0;
  let partial = 0;
  let unknown = 0;
  for (const action of pending) {
    const rule = supportedRules.find((entry: { id: string }) => entry.id === action.ruleId) as { id: string; action: string } | undefined;
    if (!rule) continue;
    let status: 'applied' | 'partial' | 'unknown' = 'applied';
    try {
      const hideResult = await connector.executeOperation({ type: 'comments.moderate', commentId: action.providerCommentId, action: 'hide' });
      if (hideResult.type !== 'mutation' || hideResult.success !== true) throw new Error('provider did not confirm hide');
      if (rule.action === 'hide_and_block') {
        try {
          const blockResult = await connector.executeOperation({ type: 'comments.moderate', commentId: action.providerCommentId, action: 'block' });
          if (blockResult.type !== 'mutation' || blockResult.success !== true) status = 'partial';
        } catch { status = 'partial'; }
      }
    } catch { status = 'unknown'; }
    await withOrgContext(orgId, async (tx) => {
      await tx.update(schema.commentModerationAction).set({ status, resolvedAt: new Date() }).where(and(
        eq(schema.commentModerationAction.id, action.id), eq(schema.commentModerationAction.orgId, orgId),
        eq(schema.commentModerationAction.modelId, modelId), eq(schema.commentModerationAction.status, 'pending'),
      ));
      await writeAudit(tx, orgId, userId, `comment_moderation.${status}`, action.id, {
        platform: loaded.connection.platform, postId: body.postId, matchedKeywordCount: action.matchedKeywordCount,
      });
    });
    if (status === 'applied') applied += 1;
    else if (status === 'partial') partial += 1;
    else unknown += 1;
  }

  return c.json({ data: {
    scanned: commentsResult.items.length,
    matched: proposed.length,
    moderated: applied,
    partial,
    unknown,
    alreadyRecorded: Math.max(0, proposed.length - pending.length),
    unsupportedRuleIds,
    nextCursor: commentsResult.nextCursor ?? null,
  } }, 200);
});

export { router as commentModerationRouter };
