// FanThynks platform referral program (F-90).
//
// This surface is for partners who refer creators to FanThynks itself. It is
// deliberately not a tenant affiliate builder, a creator referral feature, or
// a resale/white-label control plane. It records attribution and commission
// facts but never calls a billing, payout, social, or provider API.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, schema } from '@axiom/db';
import type { AppBindings } from '../index.js';
import { apiError, statusTitle } from './helpers.js';
import { rateLimit } from '../contract.js';
import { readBoundedJson, RequestBodyTooLargeError } from '../webhook-body.js';
import {
  buildPayoutExport,
  commissionCents,
  exportPartnerData,
  type CommissionRecord,
  type Campaign,
  type FraudHold,
  type Partner,
} from '../affiliate-contract.js';

const router = new Hono<AppBindings>();
const publicRouter = new Hono<AppBindings>();
const affiliateClaimRouter = new Hono<AppBindings>();

// Referral links are anonymous by design, but they are still an abuse surface.
// Rate-limit the redirect before it can write an attribution fact.
publicRouter.use('*', rateLimit({ capacity: 60, refillPerSec: 1, maxBuckets: 100_000 }));

const emailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const partnerCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  email: emailSchema,
  termsVersion: z.string().trim().min(1).max(64),
  disclosureAccepted: z.boolean().default(false),
  status: z.enum(['invited', 'active']).default('invited'),
}).strict();
const partnerPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(160).optional(),
  email: emailSchema.optional(),
  termsVersion: z.string().trim().min(1).max(64).optional(),
  disclosureAccepted: z.boolean().optional(),
  status: z.enum(['invited', 'active', 'suspended', 'revoked']).optional(),
}).strict();
const campaignCreateSchema = z.object({
  partnerId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
  commissionBps: z.number().int().min(0).max(10_000).optional(),
  status: z.enum(['draft', 'active']).default('draft'),
}).strict();
const attributionSchema = z.object({
  campaignId: z.string().uuid(),
  kind: z.enum(['click', 'visit', 'identity_stitch']),
  eventKey: z.string().trim().min(8).max(200),
  visitorHash: z.string().trim().min(16).max(256).optional(),
  creatorUserId: z.string().trim().min(1).max(255).optional(),
  metadata: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime().optional(),
}).strict();
const reconcileSchema = z.object({
  campaignId: z.string().uuid(),
  kind: z.enum(['subscription_started', 'subscription_renewed', 'subscription_refunded']),
  amountCents: z.number().int().min(0).max(2_000_000_000),
  billingEventKey: z.string().trim().min(8).max(200),
  creatorUserId: z.string().trim().min(1).max(255),
  sourceBillingEventKey: z.string().trim().min(8).max(200).optional(),
  occurredAt: z.string().datetime().optional(),
}).strict();
const holdResolveSchema = z.object({
  resolution: z.enum(['released', 'upheld']),
}).strict();
const referralTokenSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const affiliateClaimSchema = z.object({ referralToken: referralTokenSchema }).strict();

async function findActiveReferral(referralToken: string) {
  const [campaign] = await db.select().from(schema.affiliateCampaign).where(
    eq(schema.affiliateCampaign.referralToken, referralToken),
  ).limit(1);
  if (!campaign || campaign.status !== 'active') return null;

  const [program] = await db.select().from(schema.affiliateProgram).where(
    eq(schema.affiliateProgram.id, campaign.programId),
  ).limit(1);
  const [partner] = await db.select().from(schema.affiliatePartner).where(
    eq(schema.affiliatePartner.id, campaign.partnerId),
  ).limit(1);
  if (
    !program || program.status !== 'active' ||
    !partner || partner.programId !== campaign.programId ||
    partner.status !== 'active' || !partner.disclosureAcceptedAt
  ) return null;

  return { campaign, program, partner };
}

/**
 * Public partner link. It records only a bounded click fact, then sends the
 * visitor to the same-origin login flow with the opaque referral token. The
 * token is retained for the signup/onboarding boundary; this route never
 * accepts a destination URL and never exposes partner or campaign metadata.
 */
publicRouter.get('/r/:referralToken', async (c) => {
  const parsedToken = referralTokenSchema.safeParse(c.req.param('referralToken'));
  if (!parsedToken.success) return apiError(c, 404, statusTitle(404), 'affiliate referral link not found');
  const referralToken = parsedToken.data;
  const referral = await findActiveReferral(referralToken);
  if (!referral) {
    return apiError(c, 404, statusTitle(404), 'affiliate referral link not found');
  }
  const { campaign } = referral;

  const now = new Date();
  await db.insert(schema.affiliateAttributionEvent).values({
    programId: campaign.programId,
    campaignId: campaign.id,
    partnerId: campaign.partnerId,
    kind: 'click',
    eventKey: `public-click:${campaign.id}:${randomUUID()}`,
    metadata: { source: 'public_referral_redirect' },
    occurredAt: now,
    createdAt: now,
  });

  const destination = new URL('/login', c.req.url);
  destination.searchParams.set('affiliate_ref', referralToken);
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Robots-Tag', 'noindex');
  return c.redirect(destination.toString(), 302);
});

/**
 * Complete the same-origin referral handoff after authentication. The public
 * redirect intentionally records only an anonymous click; this authenticated,
 * idempotent event is the first point at which a creator identity may be
 * attached. It never creates a billing conversion or payout side effect.
 */
affiliateClaimRouter.post('/claim', async (c) => {
  let payload: unknown;
  try { payload = await readBoundedJson(c.req.raw, 8 * 1024); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'affiliate claim body too large');
    return apiError(c, 400, statusTitle(400), 'invalid affiliate claim body');
  }
  const parsed = affiliateClaimSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid affiliate claim body');

  const referral = await findActiveReferral(parsed.data.referralToken);
  if (!referral) return apiError(c, 404, statusTitle(404), 'affiliate referral link not found');
  const creatorUserId = c.get('userId');
  if (!creatorUserId) return apiError(c, 401, statusTitle(401), 'authenticated creator required');

  const { campaign, program, partner } = referral;
  const eventKey = `identity-stitch:${campaign.id}:${creatorUserId}`;
  const now = new Date();
  const [event] = await db.insert(schema.affiliateAttributionEvent).values({
    programId: program.id,
    campaignId: campaign.id,
    partnerId: partner.id,
    kind: 'identity_stitch',
    eventKey,
    creatorUserId,
    metadata: { source: 'signup_referral_claim' },
    occurredAt: now,
    createdAt: now,
  }).onConflictDoNothing({ target: schema.affiliateAttributionEvent.eventKey }).returning();
  if (event) return c.json({ data: { claimed: true }, duplicate: false }, 201);

  const [existing] = await db.select().from(schema.affiliateAttributionEvent).where(
    eq(schema.affiliateAttributionEvent.eventKey, eventKey),
  ).limit(1);
  if (
    !existing || existing.campaignId !== campaign.id ||
    existing.creatorUserId !== creatorUserId || existing.kind !== 'identity_stitch'
  ) return apiError(c, 409, statusTitle(409), 'affiliate claim key is already bound to another attribution event');
  return c.json({ data: { claimed: true }, duplicate: true });
});

async function readBody(c: Context<AppBindings>): Promise<unknown> {
  return readBoundedJson(c.req.raw, 64 * 1024);
}

function auditKey(c: Context<AppBindings>, action: string, target: string): string {
  const supplied = c.req.header('Idempotency-Key') ?? randomUUID();
  return `affiliate:${c.req.path}:${action}:${target}:${supplied}`;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

function parseDate(value: string | undefined): Date {
  return value ? new Date(value) : new Date();
}

async function programBySlug(tx: any) {
  const [program] = await tx.select().from(schema.affiliateProgram)
    .where(eq(schema.affiliateProgram.slug, 'fanthynks')).limit(1);
  return program ?? null;
}

async function recordAudit(
  tx: any,
  programId: string,
  actorUserId: string,
  action: string,
  target: string,
  detail: Record<string, unknown>,
  idempotencyKey: string,
) {
  await tx.insert(schema.affiliateAuditEvent).values({
    programId,
    actorUserId,
    action,
    target,
    detail,
    idempotencyKey,
  }).onConflictDoNothing({ target: schema.affiliateAuditEvent.idempotencyKey });
}

function commissionState(kind: string): CommissionRecord['state'] {
  if (kind === 'approved') return 'approved';
  if (kind === 'reversed') return 'reversed';
  if (kind === 'held') return 'held';
  if (kind === 'exported' || kind === 'paid') return 'exported';
  return 'accrued';
}

function currentCommissionRows(rows: Array<typeof schema.affiliateCommissionEvent.$inferSelect>) {
  const current = new Map<string, typeof rows[number]>();
  for (const row of rows) current.set(row.conversionId, row);
  return [...current.values()];
}

router.get('/program', async (c) => {
  const [program] = await db.select().from(schema.affiliateProgram)
    .where(eq(schema.affiliateProgram.slug, 'fanthynks')).limit(1);
  if (!program) return apiError(c, 404, statusTitle(404), 'FanThynks affiliate program not configured');

  const [partners, campaigns, attribution, conversions, commissions, holds] = await Promise.all([
    db.select().from(schema.affiliatePartner).where(eq(schema.affiliatePartner.programId, program.id)).orderBy(desc(schema.affiliatePartner.createdAt)),
    db.select().from(schema.affiliateCampaign).where(eq(schema.affiliateCampaign.programId, program.id)).orderBy(desc(schema.affiliateCampaign.createdAt)),
    db.select().from(schema.affiliateAttributionEvent).where(eq(schema.affiliateAttributionEvent.programId, program.id)),
    db.select().from(schema.affiliateConversion).where(eq(schema.affiliateConversion.programId, program.id)),
    db.select().from(schema.affiliateCommissionEvent).where(eq(schema.affiliateCommissionEvent.programId, program.id)).orderBy(asc(schema.affiliateCommissionEvent.createdAt)),
    db.select().from(schema.affiliateHold).where(eq(schema.affiliateHold.programId, program.id)),
  ]);

  const latest = currentCommissionRows(commissions);
  const openHolds = holds.filter((hold) => hold.state === 'open');
  return c.json({
    data: {
      program,
      partners,
      campaigns,
      holds,
      summary: {
        partners: partners.length,
        campaigns: campaigns.length,
        attributionEvents: attribution.length,
        conversions: conversions.length,
        accruedCents: latest.filter((row) => row.kind === 'accrued' || row.kind === 'approved').reduce((sum, row) => sum + row.amountCents, 0),
        reversedCents: latest.filter((row) => row.kind === 'reversed').reduce((sum, row) => sum + row.amountCents, 0),
        openHolds: openHolds.length,
      },
    },
  });
});

router.post('/partners', async (c) => {
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'affiliate partner body too large');
    return apiError(c, 400, statusTitle(400), 'invalid affiliate partner body');
  }
  const parsed = partnerCreateSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid affiliate partner body');
  if (parsed.data.status === 'active' && !parsed.data.disclosureAccepted) {
    return apiError(c, 422, statusTitle(422), 'partner disclosure must be accepted before activation');
  }

  const actor = c.get('userId') ?? 'system';
  try {
    const result = await db.transaction(async (tx) => {
      const program = await programBySlug(tx);
      if (!program) return null;
      const [partner] = await tx.insert(schema.affiliatePartner).values({
        programId: program.id,
        displayName: parsed.data.displayName,
        email: parsed.data.email,
        status: parsed.data.status,
        termsVersion: parsed.data.termsVersion,
        disclosureAcceptedAt: parsed.data.disclosureAccepted ? new Date() : null,
      }).returning();
      if (partner) await recordAudit(tx, program.id, actor, 'affiliate.partner.create', partner.id, {
        status: partner.status,
        termsVersion: partner.termsVersion,
        disclosureAccepted: Boolean(partner.disclosureAcceptedAt),
      }, auditKey(c, 'partner.create', partner.id));
      return partner ?? null;
    });
    if (!result) return apiError(c, 404, statusTitle(404), 'FanThynks affiliate program not configured');
    return c.json({ data: result }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) return apiError(c, 409, statusTitle(409), 'a partner with this email already exists');
    throw error;
  }
});

router.patch('/partners/:partnerId', async (c) => {
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'affiliate partner body too large');
    return apiError(c, 400, statusTitle(400), 'invalid affiliate partner body');
  }
  const parsed = partnerPatchSchema.safeParse(payload);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return apiError(c, 400, statusTitle(400), 'invalid affiliate partner update');
  const partnerId = c.req.param('partnerId');
  const actor = c.get('userId') ?? 'system';
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(schema.affiliatePartner).where(eq(schema.affiliatePartner.id, partnerId)).limit(1).for('update');
    if (!current) return null;
    const disclosureAcceptedAt = parsed.data.disclosureAccepted === true
      ? current.disclosureAcceptedAt ?? new Date()
      : parsed.data.disclosureAccepted === false ? null : current.disclosureAcceptedAt;
    const nextStatus = parsed.data.status ?? current.status;
    if (nextStatus === 'active' && !disclosureAcceptedAt) return { error: 'partner disclosure must be accepted before activation' as const };
    const [row] = await tx.update(schema.affiliatePartner).set({
      ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
      ...(parsed.data.email ? { email: parsed.data.email } : {}),
      ...(parsed.data.termsVersion ? { termsVersion: parsed.data.termsVersion } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      disclosureAcceptedAt,
      updatedAt: new Date(),
    }).where(eq(schema.affiliatePartner.id, partnerId)).returning();
    if (row) await recordAudit(tx, row.programId, actor, 'affiliate.partner.update', row.id, {
      changed: Object.keys(parsed.data),
      status: row.status,
    }, auditKey(c, 'partner.update', row.id));
    return row ?? null;
  });
  if (updated && 'error' in updated) return apiError(c, 422, statusTitle(422), updated.error);
  if (!updated) return apiError(c, 404, statusTitle(404), 'affiliate partner not found');
  return c.json({ data: updated });
});

/**
 * Export the platform-held partner record without exposing referred-creator,
 * customer, tenant or credential fields. This is a read-only owner endpoint;
 * revocation remains a separate audited status transition so attribution and
 * financial records are not erased.
 */
router.get('/partners/:partnerId/export', async (c) => {
  const partnerId = c.req.param('partnerId');
  const [partnerRow] = await db.select().from(schema.affiliatePartner)
    .where(eq(schema.affiliatePartner.id, partnerId)).limit(1);
  if (!partnerRow) return apiError(c, 404, statusTitle(404), 'affiliate partner not found');
  const [campaignRows, commissionRows] = await Promise.all([
    db.select().from(schema.affiliateCampaign).where(eq(schema.affiliateCampaign.partnerId, partnerId)).orderBy(asc(schema.affiliateCampaign.createdAt)),
    db.select().from(schema.affiliateCommissionEvent).where(eq(schema.affiliateCommissionEvent.partnerId, partnerId)).orderBy(asc(schema.affiliateCommissionEvent.createdAt)),
  ]);
  const partner: Partner = {
    partnerId: partnerRow.id,
    displayName: partnerRow.displayName,
    email: partnerRow.email,
    status: partnerRow.status,
    termsVersion: partnerRow.termsVersion ?? 'unknown',
    disclosureAcceptedAt: partnerRow.disclosureAcceptedAt?.toISOString(),
  };
  const campaigns: Campaign[] = campaignRows.map((row) => ({
    campaignId: row.id,
    partnerId: row.partnerId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    commissionBps: row.commissionBps,
    createdAt: row.createdAt.toISOString(),
  }));
  const commissions: CommissionRecord[] = commissionRows.map((row) => ({
    commissionId: row.id,
    conversionId: row.conversionId,
    partnerId: row.partnerId,
    campaignId: row.campaignId,
    amountCents: row.amountCents,
    state: commissionState(row.kind),
    accruedAt: row.createdAt.toISOString(),
    ...(row.kind === 'reversed' ? { reversedAt: row.createdAt.toISOString(), reversalReason: row.reason ?? 'refund' } : {}),
  }));
  return c.json({
    data: exportPartnerData(partner, campaigns, commissions),
    deletion: { mode: 'revoke', preservesAuditAttribution: true },
  });
});

router.post('/campaigns', async (c) => {
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'affiliate campaign body too large');
    return apiError(c, 400, statusTitle(400), 'invalid affiliate campaign body');
  }
  const parsed = campaignCreateSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid affiliate campaign body');
  const actor = c.get('userId') ?? 'system';
  try {
    const result = await db.transaction(async (tx) => {
      const program = await programBySlug(tx);
      if (!program) return { status: 404 as const, error: 'FanThynks affiliate program not configured' };
      const [partner] = await tx.select().from(schema.affiliatePartner).where(and(
        eq(schema.affiliatePartner.id, parsed.data.partnerId),
        eq(schema.affiliatePartner.programId, program.id),
      )).limit(1);
      if (!partner) return { status: 404 as const, error: 'affiliate partner not found' };
      if (partner.status !== 'active' || !partner.disclosureAcceptedAt) {
        return { status: 422 as const, error: 'partner must be active and have accepted disclosure terms' };
      }
      const [campaign] = await tx.insert(schema.affiliateCampaign).values({
        programId: program.id,
        partnerId: partner.id,
        name: parsed.data.name,
        slug: parsed.data.slug,
        referralToken: randomBytes(24).toString('base64url'),
        status: parsed.data.status,
        commissionBps: parsed.data.commissionBps ?? program.defaultCommissionBps,
      }).returning();
      if (!campaign) return { status: 500 as const, error: 'affiliate campaign was not created' };
      await recordAudit(tx, program.id, actor, 'affiliate.campaign.create', campaign.id, {
        partnerId: partner.id,
        status: campaign.status,
        commissionBps: campaign.commissionBps,
      }, auditKey(c, 'campaign.create', campaign.id));
      return { status: 201 as const, data: campaign };
    });
    if (result.status !== 201) return apiError(c, result.status, statusTitle(result.status), result.error);
    return c.json({ data: result.data }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) return apiError(c, 409, statusTitle(409), 'campaign slug already exists for this program');
    throw error;
  }
});

router.post('/attribution', async (c) => {
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'affiliate attribution body too large');
    return apiError(c, 400, statusTitle(400), 'invalid affiliate attribution body');
  }
  const parsed = attributionSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid affiliate attribution body');
  const [campaign] = await db.select().from(schema.affiliateCampaign).where(eq(schema.affiliateCampaign.id, parsed.data.campaignId)).limit(1);
  if (!campaign) return apiError(c, 404, statusTitle(404), 'affiliate campaign not found');
  const [event] = await db.insert(schema.affiliateAttributionEvent).values({
    programId: campaign.programId,
    campaignId: campaign.id,
    partnerId: campaign.partnerId,
    kind: parsed.data.kind,
    eventKey: parsed.data.eventKey,
    visitorHash: parsed.data.visitorHash,
    creatorUserId: parsed.data.creatorUserId,
    metadata: parsed.data.metadata,
    occurredAt: parseDate(parsed.data.occurredAt),
  }).onConflictDoNothing({ target: schema.affiliateAttributionEvent.eventKey }).returning();
  if (event) return c.json({ data: event, duplicate: false }, 201);
  const [existing] = await db.select().from(schema.affiliateAttributionEvent)
    .where(eq(schema.affiliateAttributionEvent.eventKey, parsed.data.eventKey)).limit(1);
  if (!existing) return apiError(c, 409, statusTitle(409), 'attribution event could not be reconciled');
  if (existing.campaignId !== campaign.id || existing.kind !== parsed.data.kind) {
    return apiError(c, 409, statusTitle(409), 'event key is already bound to a different attribution event');
  }
  return c.json({ data: existing, duplicate: true });
});

router.get('/campaigns/:campaignId/report', async (c) => {
  const campaignId = c.req.param('campaignId');
  const [campaign] = await db.select().from(schema.affiliateCampaign).where(eq(schema.affiliateCampaign.id, campaignId)).limit(1);
  if (!campaign) return apiError(c, 404, statusTitle(404), 'affiliate campaign not found');
  const [attribution, conversions, commissions, holds] = await Promise.all([
    db.select().from(schema.affiliateAttributionEvent).where(eq(schema.affiliateAttributionEvent.campaignId, campaignId)),
    db.select().from(schema.affiliateConversion).where(eq(schema.affiliateConversion.campaignId, campaignId)),
    db.select().from(schema.affiliateCommissionEvent).where(eq(schema.affiliateCommissionEvent.campaignId, campaignId)).orderBy(asc(schema.affiliateCommissionEvent.createdAt)),
    db.select().from(schema.affiliateHold).where(eq(schema.affiliateHold.partnerId, campaign.partnerId)),
  ]);
  const latest = currentCommissionRows(commissions);
  const openHold = holds.some((hold) => hold.state === 'open');
  return c.json({ data: {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      status: campaign.status,
      commissionBps: campaign.commissionBps,
      referralToken: campaign.referralToken,
    },
    attribution: {
      clicks: attribution.filter((event) => event.kind === 'click').length,
      visits: attribution.filter((event) => event.kind === 'visit').length,
      identityStitches: attribution.filter((event) => event.kind === 'identity_stitch').length,
    },
    conversions: conversions.length,
    commissions: {
      accruedCents: latest.filter((row) => row.kind === 'accrued' || row.kind === 'approved').reduce((sum, row) => sum + row.amountCents, 0),
      reversedCents: latest.filter((row) => row.kind === 'reversed').reduce((sum, row) => sum + row.amountCents, 0),
      exportableCents: !openHold ? latest.filter((row) => row.kind === 'approved').reduce((sum, row) => sum + row.amountCents, 0) : 0,
      openHold,
    },
  } });
});

router.post('/conversions/reconcile', async (c) => {
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'affiliate conversion body too large');
    return apiError(c, 400, statusTitle(400), 'invalid affiliate conversion body');
  }
  const parsed = reconcileSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'invalid affiliate conversion body');
  const actor = c.get('userId') ?? 'system';
  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(schema.affiliateCampaign).where(eq(schema.affiliateCampaign.id, parsed.data.campaignId)).limit(1);
    if (!campaign) return { status: 404 as const, error: 'affiliate campaign not found' };
    if (campaign.status !== 'active') return { status: 422 as const, error: 'conversion requires an active campaign' };
    const [program] = await tx.select().from(schema.affiliateProgram).where(eq(schema.affiliateProgram.id, campaign.programId)).limit(1);
    const [partner] = await tx.select().from(schema.affiliatePartner).where(eq(schema.affiliatePartner.id, campaign.partnerId)).limit(1);
    if (
      !program || program.status !== 'active' ||
      !partner || partner.programId !== campaign.programId ||
      partner.status !== 'active' || !partner.disclosureAcceptedAt
    ) return { status: 422 as const, error: 'conversion requires an active disclosed affiliate partner' };
    const [identityStitch] = await tx.select({ id: schema.affiliateAttributionEvent.id })
      .from(schema.affiliateAttributionEvent)
      .where(and(
        eq(schema.affiliateAttributionEvent.campaignId, campaign.id),
        eq(schema.affiliateAttributionEvent.creatorUserId, parsed.data.creatorUserId),
        eq(schema.affiliateAttributionEvent.kind, 'identity_stitch'),
      )).limit(1);
    if (!identityStitch) return { status: 409 as const, error: 'conversion requires an earlier referral identity stitch' };
    const [existing] = await tx.select().from(schema.affiliateConversion)
      .where(eq(schema.affiliateConversion.billingEventKey, parsed.data.billingEventKey)).limit(1).for('update');
    if (existing) {
      if (existing.campaignId !== campaign.id || existing.kind !== parsed.data.kind || existing.amountCents !== parsed.data.amountCents) {
        return { status: 409 as const, error: 'billing event key is already bound to a different conversion' };
      }
      return { status: 200 as const, data: existing, duplicate: true };
    }
    if (parsed.data.kind === 'subscription_refunded' && parsed.data.sourceBillingEventKey) {
      const [source] = await tx.select({
        id: schema.affiliateConversion.id,
        campaignId: schema.affiliateConversion.campaignId,
        creatorUserId: schema.affiliateConversion.creatorUserId,
        kind: schema.affiliateConversion.kind,
      }).from(schema.affiliateConversion)
        .where(eq(schema.affiliateConversion.billingEventKey, parsed.data.sourceBillingEventKey)).limit(1);
      if (!source) return { status: 409 as const, error: 'refund source billing event was not found' };
      if (
        source.campaignId !== campaign.id || source.creatorUserId !== parsed.data.creatorUserId ||
        (source.kind !== 'subscription_started' && source.kind !== 'subscription_renewed')
      ) return { status: 409 as const, error: 'refund source does not match the referred creator conversion' };
    }
    const [conversion] = await tx.insert(schema.affiliateConversion).values({
      programId: campaign.programId,
      campaignId: campaign.id,
      partnerId: campaign.partnerId,
      creatorUserId: parsed.data.creatorUserId,
      kind: parsed.data.kind,
      amountCents: parsed.data.amountCents,
      billingEventKey: parsed.data.billingEventKey,
      occurredAt: parseDate(parsed.data.occurredAt),
    }).returning();
    if (!conversion) return { status: 500 as const, error: 'conversion was not created' };
    const amount = commissionCents(parsed.data.amountCents, campaign.commissionBps);
    const commissionKind = parsed.data.kind === 'subscription_refunded' ? 'reversed' as const : 'accrued' as const;
    const [commission] = await tx.insert(schema.affiliateCommissionEvent).values({
      programId: campaign.programId,
      campaignId: campaign.id,
      partnerId: campaign.partnerId,
      conversionId: conversion.id,
      kind: commissionKind,
      amountCents: amount,
      eventKey: `conversion:${conversion.id}:${commissionKind}`,
      reason: parsed.data.sourceBillingEventKey ? `refund-of:${parsed.data.sourceBillingEventKey}` : null,
    }).returning();
    if (!commission) return { status: 500 as const, error: 'commission event was not created' };
    await recordAudit(tx, campaign.programId, actor, 'affiliate.conversion.reconcile', conversion.id, {
      campaignId: campaign.id,
      kind: conversion.kind,
      amountCents: conversion.amountCents,
      commissionCents: amount,
      commissionKind,
    }, auditKey(c, 'conversion.reconcile', parsed.data.billingEventKey));
    return { status: 201 as const, data: conversion, commission, duplicate: false };
  });
  if (result.status !== 201 && result.status !== 200) return apiError(c, result.status, statusTitle(result.status), result.error);
  return c.json({ data: result.data, commission: 'commission' in result ? result.commission : undefined, duplicate: result.duplicate }, result.status);
});

router.get('/payouts/export', async (c) => {
  const partnerId = c.req.query('partnerId');
  if (!partnerId) return apiError(c, 400, statusTitle(400), 'partnerId is required');
  const [partnerRow] = await db.select().from(schema.affiliatePartner).where(eq(schema.affiliatePartner.id, partnerId)).limit(1);
  if (!partnerRow) return apiError(c, 404, statusTitle(404), 'affiliate partner not found');
  const [commissionRows, holdRows] = await Promise.all([
    db.select().from(schema.affiliateCommissionEvent).where(eq(schema.affiliateCommissionEvent.partnerId, partnerId)).orderBy(asc(schema.affiliateCommissionEvent.createdAt)),
    db.select().from(schema.affiliateHold).where(eq(schema.affiliateHold.partnerId, partnerId)),
  ]);
  const current = currentCommissionRows(commissionRows);
  const commissions: CommissionRecord[] = current.map((row) => ({
    commissionId: row.id,
    conversionId: row.conversionId,
    partnerId: row.partnerId,
    campaignId: row.campaignId,
    amountCents: row.amountCents,
    state: commissionState(row.kind),
    accruedAt: row.createdAt.toISOString(),
  }));
  const holds: FraudHold[] = holdRows.map((row) => ({
    holdId: row.id,
    partnerId: row.partnerId,
    reason: row.reason,
    openedAt: row.createdAt.toISOString(),
    resolvedAt: row.state === 'resolved' ? (row.resolvedAt?.toISOString() ?? row.createdAt.toISOString()) : undefined,
  }));
  const partner: Partner = {
    partnerId: partnerRow.id,
    displayName: partnerRow.displayName,
    email: partnerRow.email,
    status: partnerRow.status,
    termsVersion: partnerRow.termsVersion ?? 'unknown',
    disclosureAcceptedAt: partnerRow.disclosureAcceptedAt?.toISOString(),
  };
  const { batch, csv } = buildPayoutExport(partner, commissions, holds);
  const actor = c.get('userId') ?? 'system';
  const exportRecord = await db.transaction(async (tx) => {
    const [record] = await tx.insert(schema.affiliatePayoutExport).values({
      programId: partnerRow.programId,
      partnerId: partnerRow.id,
      commissionIds: batch.commissionIds,
      totalCents: batch.totalCents,
      exportFormat: 'csv',
      createdByUserId: actor,
    }).returning();
    if (!record) throw new Error('affiliate payout export could not be recorded');
    await recordAudit(tx, partnerRow.programId, actor, 'affiliate.payout.export', record.id, {
      commissionCount: batch.commissionIds.length,
      totalCents: batch.totalCents,
      transfer: 'none',
    }, auditKey(c, 'payout.export', record.id));
    return record;
  });
  if (c.req.query('format') === 'json') {
    return c.json({ data: { batch, csv, transfer: 'none', exportId: exportRecord.id } });
  }
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fanthynks-affiliate-${partnerId}.csv"`,
      'X-Fanthynks-Payout-Transfer': 'none',
      'X-Fanthynks-Payout-Export-Id': exportRecord.id,
    },
  });
});

router.post('/holds/:holdId/resolve', async (c) => {
  let payload: unknown;
  try { payload = await readBody(c); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError(c, 413, statusTitle(413), 'affiliate hold body too large');
    return apiError(c, 400, statusTitle(400), 'invalid affiliate hold body');
  }
  const parsed = holdResolveSchema.safeParse(payload);
  if (!parsed.success) return apiError(c, 400, statusTitle(400), 'resolution must be released or upheld');
  const actor = c.get('userId') ?? 'system';
  const resolved = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(schema.affiliateHold).where(eq(schema.affiliateHold.id, c.req.param('holdId'))).limit(1).for('update');
    if (!current) return null;
    if (current.state === 'resolved') return current;
    const [row] = await tx.update(schema.affiliateHold).set({
      state: 'resolved',
      resolvedByUserId: actor,
      resolvedAt: new Date(),
    }).where(eq(schema.affiliateHold.id, current.id)).returning();
    if (row) await recordAudit(tx, row.programId, actor, 'affiliate.hold.resolve', row.id, {
      resolution: parsed.data.resolution,
      reason: row.reason,
    }, auditKey(c, 'hold.resolve', row.id));
    return row ?? null;
  });
  if (!resolved) return apiError(c, 404, statusTitle(404), 'affiliate hold not found');
  return c.json({ data: resolved, resolution: parsed.data.resolution });
});

export { router as platformAffiliateRouter };
export { publicRouter as publicPlatformAffiliateRouter };
export { affiliateClaimRouter };
