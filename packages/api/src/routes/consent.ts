// ─── Consent & Records Vault (LBI-12) ─────────────────────────────────────
// Store only references and digests here. The document bytes remain in the
// encrypted object store; publication gates evaluate this metadata in-transaction.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { schema, getPublishingConsentStatus } from '@axiom/db';
import type { AppBindings } from '../index.js';
import {
  consentDocumentExtension,
  consentDocumentSha256,
  consentDocumentType,
  MAX_CONSENT_DOCUMENT_BYTES,
  matchesConsentDocumentType,
  openConsentDocument,
  sealConsentDocument,
} from '../consent-vault.js';
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
    grantedAt: instant.optional(),
    expiresAt: instant.nullable().optional(),
    validFrom: dateOnly,
    validTo: dateOnly.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.validTo === undefined || value.validTo === null || value.validTo >= value.validFrom,
    { message: 'validTo must not precede validFrom', path: ['validTo'] },
  );

const MAX_MULTIPART_BYTES = MAX_CONSENT_DOCUMENT_BYTES + 64 * 1024;

function canManageConsent(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager' || role === 'operator';
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('consent document request too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}

async function readConsentForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw new Error('multipart form required');
  const body = await readBoundedBody(request, MAX_MULTIPART_BYTES);
  const bounded = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  try { return await bounded.formData(); }
  finally { body.fill(0); }
}

function consentFormMetadata(form: FormData) {
  const entries: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') entries[key] = value;
  return createConsentSchema.safeParse(entries);
}

// GET /models/:modelId/consent-records — metadata only, never encrypted bytes
router.get('/models/:modelId/consent-records', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  const { modelId } = c.req.param();

  type ConsentListRow = Record<string, unknown> & {
    hasDocument: Uint8Array | null;
    sha256: Uint8Array | null;
  };
  const rows = await withOrgContext<ConsentListRow[] | null>(orgId, async (tx) => {
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
        documentMimeType: schema.consentRecord.documentMimeType,
        documentSize: schema.consentRecord.documentSize,
        hasDocument: schema.consentRecord.documentCiphertext,
        validFrom: schema.consentRecord.validFrom,
        validTo: schema.consentRecord.validTo,
      })
      .from(schema.consentRecord)
      .where(and(eq(schema.consentRecord.orgId, orgId), eq(schema.consentRecord.modelId, modelId)))
      .orderBy(desc(schema.consentRecord.validFrom), desc(schema.consentRecord.id));
  });
  if (!rows) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: rows.map(({ hasDocument, sha256, ...row }) => ({
    ...row,
    sha256: sha256 ? Buffer.from(sha256).toString('hex') : null,
    hasDocument: hasDocument !== null,
  })), meta: { total: rows.length } });
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

// POST /models/:modelId/consent-records — upload a bounded, encrypted document with its grant metadata.
router.post('/models/:modelId/consent-records', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!canManageConsent(c.get('role'))) return apiError(c, 403, statusTitle(403), 'consent vault management role required');
  let form: FormData;
  try { form = await readConsentForm(c.req.raw); }
  catch (error) {
    const tooLarge = error instanceof Error && error.message === 'consent document request too large';
    return apiError(c, tooLarge ? 413 : 400, statusTitle(tooLarge ? 413 : 400), tooLarge ? 'consent document request too large' : 'invalid consent document upload');
  }
  const parsed = consentFormMetadata(form);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid consent document metadata');
  const uploaded = form.get('document');
  if (!uploaded || typeof uploaded === 'string' || typeof uploaded.arrayBuffer !== 'function' || uploaded.size < 1 || uploaded.size > MAX_CONSENT_DOCUMENT_BYTES) {
    return apiError(c, 400, statusTitle(400), 'consent document must be between 1 byte and 10 MiB');
  }
  const mimeType = consentDocumentType(uploaded.type.toLowerCase());
  if (!mimeType) return apiError(c, 415, statusTitle(415), 'consent document must be a PDF, JPEG or PNG');
  const plaintext = Buffer.from(await uploaded.arrayBuffer());
  if (!matchesConsentDocumentType(plaintext, mimeType)) {
    plaintext.fill(0);
    return apiError(c, 415, statusTitle(415), 'consent document content does not match its file type');
  }

  const { modelId } = c.req.param();
  const recordId = randomUUID();
  const sha256 = consentDocumentSha256(plaintext);
  let ciphertext: Buffer;
  try { ciphertext = sealConsentDocument(plaintext, { orgId, modelId, recordId }); }
  catch {
    plaintext.fill(0);
    return apiError(c, 503, statusTitle(503), 'consent document encryption is unavailable');
  }
  plaintext.fill(0);
  const body = parsed.data;
  const userId = c.get('userId') ?? 'system';
  const saved = await withOrgContext(orgId, async (tx) => {
    if ((await modelOrgId(tx, modelId)) !== orgId) return null;
    const [row] = await tx.insert(schema.consentRecord).values({
      id: recordId,
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
      blobRef: `consent-record:${recordId}`,
      sha256: new Uint8Array(sha256),
      documentCiphertext: new Uint8Array(ciphertext),
      documentMimeType: mimeType,
      documentSize: uploaded.size,
      validFrom: body.validFrom,
      validTo: body.validTo ?? null,
    }).returning({
      id: schema.consentRecord.id,
      orgId: schema.consentRecord.orgId,
      modelId: schema.consentRecord.modelId,
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
      documentMimeType: schema.consentRecord.documentMimeType,
      documentSize: schema.consentRecord.documentSize,
      validFrom: schema.consentRecord.validFrom,
      validTo: schema.consentRecord.validTo,
    });
    if (!row) throw new Error('consent record insert returned no row');
    await writeAudit(tx, orgId, userId, 'consent_record.create', row.id, {
      modelId, platform: body.platform, docKind: body.docKind, sha256: sha256.toString('hex'), documentSize: uploaded.size,
    });
    return row;
  });
  if (!saved) return apiError(c, 404, statusTitle(404), 'model not found');
  return c.json({ data: { ...saved, hasDocument: true } }, 201);
});

// GET /models/:modelId/consent-records/:id/document — authorized document retrieval.
router.get('/models/:modelId/consent-records/:id/document', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!canManageConsent(c.get('role'))) return apiError(c, 403, statusTitle(403), 'consent vault access role required');
  const { modelId, id } = c.req.param();
  const userId = c.get('userId') ?? 'system';
  const record = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx.select().from(schema.consentRecord).where(and(
      eq(schema.consentRecord.id, id), eq(schema.consentRecord.orgId, orgId), eq(schema.consentRecord.modelId, modelId),
    )).limit(1);
    if (!row || !row.documentCiphertext || !row.documentMimeType || !row.sha256) return row ?? null;
    await writeAudit(tx, orgId, userId, 'consent_record.document.read', id, { modelId, docKind: row.docKind });
    return row;
  });
  if (!record) return apiError(c, 404, statusTitle(404), 'consent record not found');
  if (!record.documentCiphertext || !record.documentMimeType || !record.sha256) return apiError(c, 410, statusTitle(410), 'consent document is unavailable');
  let plaintext: Buffer;
  try {
    plaintext = openConsentDocument(record.documentCiphertext, { orgId, modelId, recordId: id });
    if (!consentDocumentSha256(plaintext).equals(Buffer.from(record.sha256))) throw new Error('digest mismatch');
  } catch {
    return apiError(c, 500, statusTitle(500), 'consent document integrity check failed');
  }
  const mimeType = consentDocumentType(record.documentMimeType);
  if (!mimeType) return apiError(c, 500, statusTitle(500), 'consent document type is invalid');
  const extension = consentDocumentExtension(mimeType);
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Disposition', `attachment; filename="consent-${id}.${extension}"`);
  const responseBody = new Uint8Array(plaintext.byteLength);
  responseBody.set(plaintext);
  plaintext.fill(0);
  return c.body(responseBody, 200, { 'Content-Type': mimeType });
});

// POST /models/:modelId/consent-records/:id/revoke — immutable revocation event
router.post('/models/:modelId/consent-records/:id/revoke', async (c) => {
  const orgId = requireOrg(c);
  if (!orgId) return apiError(c, 401, statusTitle(401), 'orgId required');
  if (!canManageConsent(c.get('role'))) return apiError(c, 403, statusTitle(403), 'consent vault management role required');
  const { modelId, id } = c.req.param();
  const userId = c.get('userId') ?? 'system';

  const revoked = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .update(schema.consentRecord)
      .set({ granted: false, revokedAt: new Date(), blobRef: null, documentCiphertext: null, documentMimeType: null, documentSize: null })
      .where(
        and(
          eq(schema.consentRecord.id, id),
          eq(schema.consentRecord.orgId, orgId),
          eq(schema.consentRecord.modelId, modelId),
        ),
      )
      .returning();
    if (rows.length === 0) return null;
    await writeAudit(tx, orgId, userId, 'consent_record.revoke', id, { modelId, documentDestroyed: true });
    return rows[0];
  });
  if (!revoked) return apiError(c, 404, statusTitle(404), 'consent record not found');
  return c.json({ data: revoked });
});

export { router as consentRouter };
