// ─── Consent & Records Vault (LBI-12) ─────────────────────────────────────
// Store only references and digests here. The document bytes remain in the
// encrypted object store; publication gates evaluate this metadata in-transaction.

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { schema, getPublishingConsentStatus } from '@axiom/db';
import type { AppBindings } from '../index.js';
import {
  withOrgContext,
  modelOrgId,
  requireOrg,
  writeAudit,
  apiError,
  statusTitle,
} from './helpers.js';

const router = new Hono<AppBindings>();

const DOC_KINDS = ['2257', 'model_release', 'id_verify', 'platform_consent'] as const;
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const instant = z.string().datetime({ offset: true });

const createConsentSchema = z
  .object({
    platform: z.string().min(1).max(50),
    consentType: z.string().min(1).max(100).optional(),
    docKind: z.enum(DOC_KINDS),
    subjectRef: z.string().min(1).max(200),
    blobRef: z.string().min(1).max(1000),
    sha256: z.string().regex(/^[0-9a-f]{64}$/i, 'must be a 32-byte SHA-256 hex digest'),
    grantedAt: instant.optional(),
    expiresAt: instant.nullable().optional(),
    validFrom: dateOnly,
    validTo: dateOnly.nullable().optional(),
  })
  .refine(
    (value) =>
      value.validTo === undefined || value.validTo === null || value.validTo >= value.validFrom,
    { message: 'validTo must not precede validFrom', path: ['validTo'] },
  );

// GET /models/:modelId/consent-records — metadata only, never document bytes
router.get('/models/:modelId/consent-records', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  const rows = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    return tx
      .select({
        id: schema.consentRecord.id,
        platform: schema.consentRecord.platform,
        consentType: schema.consentRecord.consentType,
        granted: schema.consentRecord.granted,
        grantedAt: schema.consentRecord.grantedAt,
        expiresAt: schema.consentRecord.expiresAt,
        revokedAt: schema.consentRecord.revokedAt,
        subjectRef: schema.consentRecord.subjectRef,
        docKind: schema.consentRecord.docKind,
        blobRef: schema.consentRecord.blobRef,
        sha256: schema.consentRecord.sha256,
        validFrom: schema.consentRecord.validFrom,
        validTo: schema.consentRecord.validTo,
      })
      .from(schema.consentRecord)
      .where(and(eq(schema.consentRecord.orgId, orgId), eq(schema.consentRecord.modelId, modelId)))
      .orderBy(desc(schema.consentRecord.validFrom), desc(schema.consentRecord.id));
  });
  if (!rows) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: rows, meta: { total: rows.length } });
});

// GET /models/:modelId/consent-status?platform=instagram — publish preflight
router.get('/models/:modelId/consent-status', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();
  const platform = c.req.query('platform');
  if (!platform) return apiError(c, 400, statusTitle(400), 'platform query required');

  const status = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    return getPublishingConsentStatus(tx, orgId, modelId, platform);
  });
  if (!status) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: { platform, ...status } });
});

// POST /models/:modelId/consent-records — add a vault metadata record
router.post(
  '/models/:modelId/consent-records',
  zValidator('json', createConsentSchema),
  async (c) => {
    const orgId = requireOrg(c);
    if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
    const { modelId } = c.req.param();
    const body = c.req.valid('json');
    const userId = c.get('userId') ?? 'system';

    const saved = await withOrgContext(orgId, async (tx) => {
      if ((await modelOrgId(tx, modelId)) !== orgId) return null;
      const [row] = await tx
        .insert(schema.consentRecord)
        .values({
          orgId,
          modelId,
          platform: body.platform,
          consentType: body.consentType ?? body.docKind,
          granted: true,
          grantedAt: body.grantedAt ? new Date(body.grantedAt) : new Date(),
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          revokedAt: null,
          subjectRef: body.subjectRef,
          docKind: body.docKind,
          blobRef: body.blobRef,
          sha256: new Uint8Array(Buffer.from(body.sha256, 'hex')),
          validFrom: body.validFrom,
          validTo: body.validTo ?? null,
        })
        .returning();
      if (!row) throw new Error('consent record insert returned no row');
      await writeAudit(tx, orgId, userId, 'consent_record.create', row.id, {
        modelId,
        platform: body.platform,
        docKind: body.docKind,
      });
      return row;
    });
    if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
    return c.json({ data: saved }, 201);
  },
);

// POST /models/:modelId/consent-records/:id/revoke — immutable revocation event
router.post('/models/:modelId/consent-records/:id/revoke', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId, id } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const revoked = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.consentRecord)
      .set({ granted: false, revokedAt: new Date() })
      .where(
        and(
          eq(schema.consentRecord.id, id),
          eq(schema.consentRecord.orgId, orgId),
          eq(schema.consentRecord.modelId, modelId),
        ),
      )
      .returning();
    if (rows.length === 0) return null;
    await writeAudit(tx, orgId, userId, 'consent_record.revoke', id, { modelId });
    return rows[0];
  });
  if (!revoked) return apiError(c, 404, statusTitle(404), 'consent record not found');
  return c.json({ data: revoked });
});

export { router as consentRouter };
