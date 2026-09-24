// ─── Typed BFF endpoints (/api/v1/*) ───────────────────────────────────────
// Local interfaces mirror the real API responses (see packages/api routes).
// CursorPage mirrors packages/api/src/contract.ts. @axiom/api is imported
// TYPE-ONLY so Metro never tries to bundle the Hono server at runtime.

import type { AppType } from '@axiom/api';
import { normalizeLocale, SUPPORTED_LOCALES, type SupportedLocale } from '@axiom/core';
import { apiFetch, createIdempotencyKey, resolveBaseUrl } from './client';

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
  externalDelivery: 'not-attempted' | 'attempted' | 'unknown';
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

export interface UiLocaleSnapshot {
  locale: SupportedLocale;
  source: 'user' | 'org' | 'accept-language' | 'default';
  userLocale: SupportedLocale | null;
  orgLocale: SupportedLocale | null;
  supportedLocales: SupportedLocale[];
  canSetOrg: boolean;
}

export interface MobileModelProfile {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  isActive: boolean;
}

export interface MobileConsentRecord {
  id: string;
  platform: string;
  docKind: string;
  granted: boolean;
  grantedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  validFrom: string;
  validTo: string | null;
  hasDocument: boolean;
}

export interface MobileConsentStatus {
  platform: string;
  ok: boolean;
  missing: string[];
}

export interface MobileSocialConnection {
  id: string;
  modelId: string;
  platform: string;
  displayName: string;
  capabilities: string[];
  status: string;
  connectedAt: string;
}

export type PatreonResource = 'campaign' | 'members' | 'posts';

export interface MobilePatreonSyncState {
  resource: PatreonResource;
  nextCursor: string | null;
  lastSyncedAt: string | null;
  hasError: boolean;
}

export interface MobilePatreonStatus {
  connection: MobileSocialConnection;
  counts: { campaigns: number; members: number; posts: number };
  sync: MobilePatreonSyncState[];
  hasWebhook: boolean;
  deniedActions: string[];
}

export interface MobilePatreonRecord {
  id: string;
  providerRef: string;
  title: string;
  detail: string;
  updatedAt: string | null;
  isPublic: boolean | null;
}

export interface MobilePatreonSyncResult {
  resource: PatreonResource;
  count: number;
  nextCursor: string | null;
  replay: boolean;
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

function boundedText(value: unknown, fallback: string, max = 160): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function optionalDate(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? Math.min(value, 10_000_000)
    : 0;
}

function parsePatreonResource(value: unknown): PatreonResource {
  if (value === 'campaign' || value === 'members' || value === 'posts') return value;
  throw new Error('response shape: unsupported Patreon resource');
}

export function parseMobileModel(value: unknown): MobileModelProfile {
  if (!isRecord(value)) throw new Error('response shape: model must be an object');
  return {
    id: requireString(value, 'id'),
    displayName: boundedText(value['displayName'], 'Unnamed model', 100),
    handle: boundedText(value['handle'], '', 80),
    avatarUrl: typeof value['avatarUrl'] === 'string' ? value['avatarUrl'] : null,
    isActive: value['isActive'] !== false,
  };
}

export function parseMobileSocialConnection(value: unknown): MobileSocialConnection {
  if (!isRecord(value)) throw new Error('response shape: social connection must be an object');
  const capabilities = Array.isArray(value['capabilities'])
    ? value['capabilities'].filter((item): item is string => typeof item === 'string').slice(0, 32)
    : [];
  return {
    id: requireString(value, 'id'),
    modelId: requireString(value, 'modelId'),
    platform: requireString(value, 'platform'),
    displayName: boundedText(value['displayName'], 'Connected account', 100),
    capabilities,
    status: boundedText(value['status'], 'unknown', 40),
    connectedAt: boundedText(value['connectedAt'], '', 80),
  };
}

export function parseMobilePatreonStatus(value: unknown): MobilePatreonStatus {
  if (!isRecord(value)) throw new Error('response shape: Patreon status must be an object');
  const connection = parseMobileSocialConnection(value['connection']);
  if (connection.platform !== 'patreon') throw new Error('response shape: expected Patreon connection');
  const counts = isRecord(value['counts']) ? value['counts'] : {};
  const sync = Array.isArray(value['sync'])
    ? value['sync'].slice(0, 32).map((item): MobilePatreonSyncState => {
      if (!isRecord(item)) throw new Error('response shape: Patreon sync state must be an object');
      const resource = parsePatreonResource(item['resource']);
      return {
        resource,
        nextCursor: typeof item['nextCursor'] === 'string' ? item['nextCursor'].slice(0, 512) : null,
        lastSyncedAt: optionalDate(item, 'lastSyncedAt'),
        hasError: typeof item['lastError'] === 'string' && item['lastError'].length > 0,
      };
    })
    : [];
  const deniedActions = Array.isArray(value['deniedActions'])
    ? value['deniedActions'].filter((item): item is string => typeof item === 'string').slice(0, 16)
    : [];
  return {
    connection,
    counts: {
      campaigns: boundedCount(counts['campaigns']),
      members: boundedCount(counts['members']),
      posts: boundedCount(counts['posts']),
    },
    sync,
    hasWebhook: isRecord(value['lastWebhook']),
    deniedActions,
  };
}

export function redactProviderRef(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function parseMobilePatreonRecord(value: unknown, resource: PatreonResource): MobilePatreonRecord {
  if (!isRecord(value)) throw new Error('response shape: Patreon record must be an object');
  const id = requireString(value, 'id');
  const providerValue = resource === 'campaign'
    ? value['providerCampaignId']
    : resource === 'members' ? value['providerMemberId'] : value['providerPostId'];
  const providerRef = typeof providerValue === 'string' ? providerValue : id;
  const title = resource === 'campaign'
    ? boundedText(value['name'], 'Campaign', 120)
    : resource === 'members'
      ? boundedText(value['tierTitle'] ?? value['status'], 'Member', 120)
      : boundedText(value['title'], 'Patreon post', 120);
  const detail = resource === 'members'
    ? boundedText(value['status'], 'Membership status unavailable', 120)
    : resource === 'campaign'
      ? `${boundedCount(value['patronCount'])} patrons reported`
      : value['isPublic'] === true ? 'Public post' : value['isPublic'] === false ? 'Members-only post' : 'Post visibility unavailable';
  return {
    id,
    providerRef: redactProviderRef(providerRef),
    title,
    detail,
    updatedAt: optionalDate(value, 'syncedAt'),
    isPublic: typeof value['isPublic'] === 'boolean' ? value['isPublic'] : null,
  };
}

/** Project only consent metadata safe for the mobile display; identifiers and encrypted bytes are discarded. */
export function parseMobileConsentRecord(value: unknown): MobileConsentRecord {
  if (!isRecord(value)) throw new Error('response shape: consent record must be an object');
  const validFrom = requireString(value, 'validFrom');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) throw new Error('response shape: consent validFrom must be a date');
  const grantedAt = value['grantedAt'];
  const expiresAt = value['expiresAt'];
  const revokedAt = value['revokedAt'];
  const validTo = value['validTo'];
  const optionalTimestamp = (key: string, current: unknown): string | null => {
    if (current === null || current === undefined) return null;
    if (typeof current !== 'string' || current.length > 80) throw new Error(`response shape: consent ${key} must be a timestamp or null`);
    return current;
  };
  if (typeof value['granted'] !== 'boolean' || typeof value['hasDocument'] !== 'boolean') {
    throw new Error('response shape: consent grant/document state must be boolean');
  }
  if (validTo !== null && validTo !== undefined && (typeof validTo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(validTo))) {
    throw new Error('response shape: consent validTo must be a date or null');
  }
  return {
    id: requireString(value, 'id'),
    platform: boundedText(value['platform'], 'unknown', 50),
    docKind: boundedText(value['docKind'], 'unknown', 100),
    granted: value['granted'],
    grantedAt: optionalTimestamp('grantedAt', grantedAt),
    expiresAt: optionalTimestamp('expiresAt', expiresAt),
    revokedAt: optionalTimestamp('revokedAt', revokedAt),
    validFrom,
    validTo: typeof validTo === 'string' ? validTo : null,
    hasDocument: value['hasDocument'],
  };
}

export function parseMobileConsentStatus(value: unknown): MobileConsentStatus {
  if (!isRecord(value)) throw new Error('response shape: consent status must be an object');
  if (typeof value['ok'] !== 'boolean' || !Array.isArray(value['missing']) || value['missing'].some(item => typeof item !== 'string')) {
    throw new Error('response shape: consent status fields are invalid');
  }
  return {
    platform: boundedText(value['platform'], 'unknown', 50),
    ok: value['ok'],
    missing: value['missing'].slice(0, 16).map(item => boundedText(item, 'unknown', 120)),
  };
}

export function parseMobilePatreonSyncResult(value: unknown): MobilePatreonSyncResult {
  if (!isRecord(value)) throw new Error('response shape: Patreon sync result must be an object');
  return {
    resource: parsePatreonResource(value['resource']),
    count: boundedCount(value['count']),
    nextCursor: typeof value['nextCursor'] === 'string' ? value['nextCursor'].slice(0, 512) : null,
    replay: value['replay'] === true,
  };
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
    externalDelivery: value['externalDelivery'] === 'not-attempted'
      ? 'not-attempted'
      : value['externalDelivery'] === 'attempted' ? 'attempted' : 'unknown',
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

export function parseUiLocaleSnapshot(value: unknown): UiLocaleSnapshot {
  if (!isRecord(value)) throw new Error('response shape: ui locale must be an object');
  const locale = normalizeLocale(typeof value['locale'] === 'string' ? value['locale'] : undefined);
  if (!locale) throw new Error('response shape: unsupported ui locale');
  const source = value['source'];
  if (source !== 'user' && source !== 'org' && source !== 'accept-language' && source !== 'default') {
    throw new Error('response shape: invalid ui locale source');
  }
  const parseOptional = (key: string): SupportedLocale | null => {
    const raw = value[key];
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') throw new Error(`response shape: ${key} must be a locale or null`);
    const parsed = normalizeLocale(raw);
    if (!parsed) throw new Error(`response shape: unsupported ${key}`);
    return parsed;
  };
  const supportedRaw = value['supportedLocales'];
  if (!Array.isArray(supportedRaw) || supportedRaw.length !== SUPPORTED_LOCALES.length || supportedRaw.some(item => typeof item !== 'string' || !SUPPORTED_LOCALES.includes(item as SupportedLocale))) {
    throw new Error('response shape: invalid supported ui locales');
  }
  return {
    locale,
    source,
    userLocale: parseOptional('userLocale'),
    orgLocale: parseOptional('orgLocale'),
    supportedLocales: supportedRaw as SupportedLocale[],
    canSetOrg: value['canSetOrg'] === true,
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

/** GET /api/v1/ui-locale → the resolved locale and persistence metadata. */
export async function getUiLocale(): Promise<UiLocaleSnapshot> {
  const body = await apiFetch<unknown>('/api/v1/ui-locale');
  if (!isRecord(body)) throw new Error('response shape: ui locale envelope must be an object');
  return parseUiLocaleSnapshot(body['data']);
}

/** PATCH /api/v1/ui-locale with a stable retry key for one user intent. */
export async function patchUiLocale(locale: SupportedLocale, scope: 'user' | 'org' = 'user', idempotencyKey: string = createIdempotencyKey()): Promise<UiLocaleSnapshot> {
  const body = await apiFetch<unknown>('/api/v1/ui-locale', {
    method: 'PATCH',
    body: { scope, locale },
    idempotencyKey,
  });
  if (!isRecord(body)) throw new Error('response shape: ui locale envelope must be an object');
  return parseUiLocaleSnapshot(body['data']);
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

/** GET /api/v1/models — the BFF applies the signed-in user's model scope. */
export async function getModels(): Promise<CursorPage<MobileModelProfile>> {
  const body = await apiFetch<unknown>('/api/v1/models');
  return parseCursorPage(body, parseMobileModel);
}

/** GET consent metadata for one model. Personal subject references and document bytes are never projected. */
export async function getConsentRecords(modelId: string): Promise<MobileConsentRecord[]> {
  const body = await apiFetch<unknown>(`/api/v1/models/${encodeURIComponent(modelId)}/consent-records`);
  if (!isRecord(body) || !Array.isArray(body['data'])) throw new Error('response shape: consent records must be an array');
  return body['data'].slice(0, 100).map(parseMobileConsentRecord);
}

/** GET the server's authoritative publish preflight for one destination platform. */
export async function getConsentStatus(modelId: string, platform: string): Promise<MobileConsentStatus> {
  const query = new URLSearchParams({ platform });
  const body = await apiFetch<unknown>(`/api/v1/models/${encodeURIComponent(modelId)}/consent-status?${query}`);
  if (!isRecord(body)) throw new Error('response shape: consent status envelope must be an object');
  return parseMobileConsentStatus(body['data']);
}

/** GET /api/v1/social-accounts?modelId=... — metadata only, never credentials. */
export async function getSocialConnections(modelId: string): Promise<MobileSocialConnection[]> {
  const body = await apiFetch<unknown>(`/api/v1/social-accounts?modelId=${encodeURIComponent(modelId)}`);
  if (!isRecord(body) || !Array.isArray(body['data'])) {
    throw new Error('response shape: social connections envelope must be an object');
  }
  return body['data'].slice(0, 100).map(parseMobileSocialConnection);
}

/** GET /api/v1/connectors/patreon/status — redacted status/counts only. */
export async function getPatreonStatus(connectionId: string): Promise<MobilePatreonStatus> {
  const body = await apiFetch<unknown>(`/api/v1/connectors/patreon/status?connectionId=${encodeURIComponent(connectionId)}`);
  if (!isRecord(body)) throw new Error('response shape: Patreon status envelope must be an object');
  return parseMobilePatreonStatus(body['data']);
}

/** GET /api/v1/connectors/patreon/data — bounded normalized records. */
export async function getPatreonData(connectionId: string, resource: PatreonResource): Promise<MobilePatreonRecord[]> {
  const body = await apiFetch<unknown>(`/api/v1/connectors/patreon/data?${new URLSearchParams({ connectionId, resource })}`);
  if (!isRecord(body) || !Array.isArray(body['data'])) {
    throw new Error('response shape: Patreon data envelope must be an object');
  }
  return body['data'].slice(0, 100).map(item => parseMobilePatreonRecord(item, resource));
}

/** POST /api/v1/connectors/patreon/sync — retries use the same intent key. */
export async function syncPatreon(
  connectionId: string,
  resource: PatreonResource,
  cursor?: string | null,
  idempotencyKey?: string,
): Promise<MobilePatreonSyncResult> {
  const body = await apiFetch<unknown>(`/api/v1/connectors/patreon/sync?connectionId=${encodeURIComponent(connectionId)}`, {
    method: 'POST',
    body: { resource, ...(cursor ? { cursor } : {}) },
    idempotencyKey,
  });
  if (!isRecord(body)) throw new Error('response shape: Patreon sync envelope must be an object');
  return parseMobilePatreonSyncResult(body['data']);
}

/** Browser OAuth handoff; no Patreon secret or token enters the mobile app. */
export function patreonAuthorizeUrl(modelId: string): string {
  return `${resolveBaseUrl()}/api/v1/connectors/patreon/authorize?modelId=${encodeURIComponent(modelId)}`;
}
