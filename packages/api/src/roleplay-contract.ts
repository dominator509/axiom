// ─── Chatter LLM/human assignment & persona-path contract ─────────────────
//
// Pure, dependency-free predicates closing the source gaps for the
// human-or-LLM Chatter lane. Nothing here touches a provider, file system or
// database: soul.md contents are accepted ONLY as bounded logical persona
// revisions, never as filesystem paths.

export type ActorType = 'human' | 'llm';

export interface ActorRef {
  type: ActorType;
  ref: string;
}

export const PERSONA_CONTENT_MAX = 8_000;
export const MEMORY_CONTENT_MAX = 4_000;
export const ACTOR_REF_MAX = 128;

/**
 * A logical persona source reference. It names a bounded revision of authored
 * persona text — it is NOT a path and must never be opened from disk.
 */
export const SOURCE_REF_PATTERN = /^soul\.md(?::[A-Za-z0-9._-]{1,128})?(?::r[1-9][0-9]*)?$/;

export interface PersonaInput {
  expectedRevision: number;
  sourceRef: string;
  content: string;
}

export interface PersonaValidation {
  ok: boolean;
  error?: 'invalid_source_ref' | 'filesystem_path_rejected' | 'content_empty' | 'content_too_long' | 'invalid_revision';
}

/**
 * Reject anything that looks like a filesystem path rather than a logical
 * source reference: absolute paths, traversal, backslashes, NUL bytes, drive
 * letters, home-relative and newline-bearing values.
 *
 * Note: a bare dotted identifier such as `agent_llm.1` is a valid actor ref and
 * is NOT a path; the extension heuristic below only fires when the value is
 * clearly a filename with a non-soul.md extension.
 */
export function isFilesystemPath(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) return true;
  if (value.includes('\\')) return true;
  if (value.startsWith('/') || value.startsWith('~')) return true;
  if (value.includes('..')) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  // A filename with a recognizable non-soul extension is a path, not a logical
  // persona reference. A purely alphanumeric identifier suffix is not.
  if (/\.(md|txt|json|ya?ml|ts|js|html?|pdf|png|jpe?g)$/i.test(value) && value !== 'soul.md' && !value.startsWith('soul.md:')) {
    return true;
  }
  return false;
}

/** Validate a persona revision accepted from the API. */
export function validatePersonaInput(input: PersonaInput): PersonaValidation {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return { ok: false, error: 'invalid_revision' };
  }
  if (typeof input.sourceRef !== 'string' || input.sourceRef.length === 0) {
    return { ok: false, error: 'invalid_source_ref' };
  }
  if (isFilesystemPath(input.sourceRef)) {
    return { ok: false, error: 'filesystem_path_rejected' };
  }
  if (!SOURCE_REF_PATTERN.test(input.sourceRef)) {
    return { ok: false, error: 'invalid_source_ref' };
  }
  if (typeof input.content !== 'string' || input.content.trim().length === 0) {
    return { ok: false, error: 'content_empty' };
  }
  if (input.content.length > PERSONA_CONTENT_MAX) {
    return { ok: false, error: 'content_too_long' };
  }
  return { ok: true };
}

/** Bound a memory turn's content before it reaches persistence. */
export function validateMemoryContent(content: unknown): boolean {
  return typeof content === 'string' && content.trim().length > 0 && content.length <= MEMORY_CONTENT_MAX;
}

/** Validate an actor ref: bounded, no path or newline characters. */
export function isValidActorRef(ref: unknown): ref is string {
  return typeof ref === 'string'
    && ref.length > 0
    && ref.length <= ACTOR_REF_MAX
    && !isFilesystemPath(ref)
    && !/[\\/\r\n]/.test(ref);
}

/**
 * Mutual exclusivity: an actor is exactly one of human or LLM. A value carrying
 * both identity fields (or neither) is rejected rather than guessed at.
 */
export interface ActorShape {
  type: ActorType;
  userId?: string | null;
  agentRef?: string | null;
}

export function isMutuallyExclusiveActor(actor: ActorShape): boolean {
  if (actor.type === 'human') {
    return !!actor.userId && !actor.agentRef;
  }
  return !!actor.agentRef && !actor.userId;
}

/** The canonical identity string used for attribution and shift matching. */
export function actorIdentity(actor: ActorRef): string {
  if (!isValidActorRef(actor.ref)) throw new Error('invalid actor ref');
  return actor.type === 'human' ? `human:${actor.ref}` : `llm:${actor.ref}`;
}

/**
 * Optimistic handoff revision check. A stale expected revision is rejected so a
 * slow actor can never overwrite a newer handoff.
 */
export function handoffRevisionAccepted(currentRevision: number, expectedRevision: number): boolean {
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) return false;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return false;
  return currentRevision === expectedRevision;
}

/** The next revision to persist after an accepted handoff write. */
export function nextHandoffRevision(expectedRevision: number): number {
  return expectedRevision + 1;
}

/**
 * Duplicate-intent protection: the same intent key is admitted at most once.
 * Returns true only for the first sighting of the key.
 */
export function claimIntent(seen: Set<string>, intentKey: string): boolean {
  if (typeof intentKey !== 'string' || intentKey.length === 0) return false;
  if (seen.has(intentKey)) return false;
  seen.add(intentKey);
  return true;
}

/** Reply-intent rules: a roleplay turn never auto-sends. */
export interface ReplyIntent {
  intentKey: string;
  autoSend: false;
  requiresConsent: true;
  requiresApproval: true;
}

export function makeReplyIntent(intentKey: string): ReplyIntent {
  return { intentKey, autoSend: false, requiresConsent: true, requiresApproval: true };
}

/** The bounded provider boundary: Grok first, Venice reserved as future. */
export const ROLEPLAY_PROVIDERS = ['grok'] as const;
export const FUTURE_PROVIDERS = ['venice'] as const;
export type RoleplayProvider = (typeof ROLEPLAY_PROVIDERS)[number];

export function isActiveRoleplayProvider(provider: string): boolean {
  return (ROLEPLAY_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Approved provider resolution: only an approved, active provider may run;
 * Grok is first through the existing subscription gateway.
 */
export function selectRoleplayProvider(provider: string): RoleplayProvider | undefined {
  return isActiveRoleplayProvider(provider) ? (provider as RoleplayProvider) : undefined;
}

/** Bounded memory window: keep the tail, oldest turns first. */
export function boundMemoryTurns<T>(turns: T[], max: number): T[] {
  if (!Number.isInteger(max) || max < 1) throw new Error('max must be a positive integer');
  return turns.slice(-max);
}
