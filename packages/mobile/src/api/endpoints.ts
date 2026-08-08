// ─── Typed BFF endpoints (/api/v1/*) ───────────────────────────────────────
// Local interfaces mirror the real API responses (see packages/api routes).
// CursorPage mirrors packages/api/src/contract.ts. @axiom/api is imported
// TYPE-ONLY so Metro never tries to bundle the Hono server at runtime.

import type { AppType } from '@axiom/api';
import { apiFetch } from './client';

/** The BFF Hono app type — type-only documentation of the shared contract. */
export type BffApp = AppType;

// ─── Shared wire types ──────────────────────────────────────────────────────

/** Cursor page envelope — mirrors CursorPage<T> in @axiom/api contract.ts. */
export interface CursorPage<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    next_cursor: string | null;
  };
}

/** A relay digest card (relay_card row, channel='digest'). */
export interface DigestCard {
  id: string;
  title: string;
  description: string | null;
  channel: string | null;
  createdAt: string;
  config: Record<string, unknown>;
}

/** A grouped crash issue (crash_report row). */
export interface CrashReport {
  id: string;
  fingerprint: string;
  service: string;
  message: string;
  count: number;
  status: 'open' | 'resolved' | 'ignored';
  lastSeen: string;
  severity?: string;
}

/** Org settings (org_settings row). */
export interface OrgSettings {
  orgId: string;
  publishingEnabled: boolean;
  viralSharing: boolean;
}

// ─── Shape guards ───────────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`response shape: expected string field "${key}"`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`response shape: expected boolean field "${key}"`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') {
    throw new Error(`response shape: expected number field "${key}"`);
  }
  return value;
}

/** Parse + validate a single relay card into a DigestCard. */
export function parseDigestCard(value: unknown): DigestCard {
  if (!isRecord(value)) {
    throw new Error('response shape: digest card must be an object');
  }
  return {
    id: requireString(value, 'id'),
    title: requireString(value, 'title'),
    description: optionalString(value, 'description'),
    channel: optionalString(value, 'channel'),
    createdAt: requireString(value, 'createdAt'),
    config: isRecord(value['config']) ? value['config'] : {},
  };
}

/** Parse + validate a crash_report row into a CrashReport. */
export function parseCrashReport(value: unknown): CrashReport {
  if (!isRecord(value)) {
    throw new Error('response shape: crash report must be an object');
  }
  const status = requireString(value, 'status');
  if (status !== 'open' && status !== 'resolved' && status !== 'ignored') {
    throw new Error(`response shape: unexpected crash report status "${status}"`);
  }
  return {
    id: requireString(value, 'id'),
    fingerprint: requireString(value, 'fingerprint'),
    service: requireString(value, 'service'),
    message: requireString(value, 'message'),
    count: requireNumber(value, 'count'),
    status,
    lastSeen: requireString(value, 'lastSeen'),
    severity: optionalString(value, 'severity') ?? undefined,
  };
}

/** Parse + validate an org_settings row into OrgSettings. */
export function parseOrgSettings(value: unknown): OrgSettings {
  if (!isRecord(value)) {
    throw new Error('response shape: org settings must be an object');
  }
  return {
    orgId: requireString(value, 'orgId'),
    publishingEnabled: requireBoolean(value, 'publishingEnabled'),
    viralSharing: requireBoolean(value, 'viralSharing'),
  };
}

/** Parse + validate a cursor-paginated envelope into CursorPage<T>. */
export function parseCursorPage<T>(value: unknown, parseItem: (item: unknown) => T): CursorPage<T> {
  if (!isRecord(value)) {
    throw new Error('response shape: cursor page must be an object');
  }
  const data = value['data'];
  if (!Array.isArray(data)) {
    throw new Error('response shape: expected data array');
  }
  const meta = value['meta'];
  if (!isRecord(meta)) {
    throw new Error('response shape: expected meta object');
  }
  const nextCursor = meta['next_cursor'];
  if (nextCursor !== null && typeof nextCursor !== 'string') {
    throw new Error('response shape: next_cursor must be string or null');
  }
  return {
    data: data.map(parseItem),
    meta: {
      total: typeof meta['total'] === 'number' ? meta['total'] : data.length,
      limit: typeof meta['limit'] === 'number' ? meta['limit'] : data.length,
      next_cursor: nextCursor,
    },
  };
}

// ─── Endpoint functions ─────────────────────────────────────────────────────

export interface OrgSettingsEnvelope {
  success: boolean;
  data: OrgSettings;
}

export interface DigestGenerateResult {
  success: boolean;
  jobId: string;
}

export interface CrashReportEnvelope {
  success: boolean;
  isNew: boolean;
  data: CrashReport;
}

/** GET /api/v1/org-settings → {success, data}. */
export async function getOrgSettings(): Promise<OrgSettings> {
  const body = await apiFetch<unknown>('/api/v1/org-settings');
  if (!isRecord(body)) {
    throw new Error('response shape: org settings envelope must be an object');
  }
  return parseOrgSettings(body['data']);
}

/** PATCH /api/v1/org-settings {viralSharing} → {success, data}. */
export async function patchViralSharing(enabled: boolean): Promise<OrgSettings> {
  const body = await apiFetch<unknown>('/api/v1/org-settings', {
    method: 'PATCH',
    body: { viralSharing: enabled },
  });
  if (!isRecord(body)) {
    throw new Error('response shape: org settings envelope must be an object');
  }
  return parseOrgSettings(body['data']);
}

/** GET /api/v1/digests → CursorPage<DigestCard>. */
export async function getDigests(): Promise<CursorPage<DigestCard>> {
  const body = await apiFetch<unknown>('/api/v1/digests');
  return parseCursorPage(body, parseDigestCard);
}

/** POST /api/v1/digests/generate → {success, jobId}. */
export async function generateDigest(): Promise<DigestGenerateResult> {
  const body = await apiFetch<unknown>('/api/v1/digests/generate', {
    method: 'POST',
    body: {},
  });
  if (!isRecord(body)) {
    throw new Error('response shape: generate digest response must be an object');
  }
  if (typeof body['success'] !== 'boolean' || typeof body['jobId'] !== 'string') {
    throw new Error('response shape: generate digest response missing success/jobId');
  }
  return { success: body['success'], jobId: body['jobId'] };
}

/** GET /api/v1/crash-reports → CursorPage<CrashReport>. */
export async function getCrashReports(): Promise<CursorPage<CrashReport>> {
  const body = await apiFetch<unknown>('/api/v1/crash-reports');
  return parseCursorPage(body, parseCrashReport);
}

export interface ReportCrashInput {
  eventId: string;
  service: string;
  message: string;
  severity?: 'sev-1' | 'sev-2' | 'sev-3' | 'sev-4';
  fingerprint?: string;
  release?: string;
  environment?: string;
  stacktrace?: Array<Record<string, unknown>>;
  correlationId?: string;
}

/** POST /api/v1/crash-reports → {success, isNew, data}. */
export async function reportCrash(input: ReportCrashInput): Promise<CrashReportEnvelope> {
  const body = await apiFetch<unknown>('/api/v1/crash-reports', {
    method: 'POST',
    body: input,
  });
  if (!isRecord(body)) {
    throw new Error('response shape: crash report envelope must be an object');
  }
  return {
    success: body['success'] === true,
    isNew: body['isNew'] === true,
    data: parseCrashReport(body['data']),
  };
}
