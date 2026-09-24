// ─── Chatter shift/assignment enforcement (F-24/F-25/F-26) ────────────────
//
// Shared, pure predicates for the surfaces the reconciliation found missing:
//   * assigned-shift + assigned-model enforcement on team-note reads AND writes
//   * LLM-agent shift ownership (an LLM actor is bound to its own agent ref)
//   * bounded note history paging
//
// These are decision helpers only. They touch no database and start no service;
// the route layer supplies rows it already read inside its tenant transaction.

export type ShiftStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';
export type AssigneeType = 'human' | 'llm';

export interface ShiftRow {
  id: string;
  orgId: string;
  modelId: string;
  assigneeType: AssigneeType;
  /** Present for human shifts. */
  assigneeUserId?: string | null;
  /** Present for LLM shifts. */
  assigneeAgentRef?: string | null;
  queue: string;
  startsAt: Date;
  endsAt: Date;
  status: ShiftStatus;
}

export interface ActorContext {
  orgId: string;
  userId: string;
  /** 'human' for a signed-in person; 'llm' for an agent acting for a model. */
  actorType: AssigneeType;
  /** Required when actorType is 'llm'. */
  agentRef?: string;
  role?: string;
}

/** A shift is currently active on the DB clock: active status and half-open window. */
export function isShiftActive(shift: ShiftRow, now: Date): boolean {
  return shift.status === 'active'
    && shift.startsAt.getTime() <= now.getTime()
    && shift.endsAt.getTime() > now.getTime();
}

/**
 * Does this actor hold a currently active shift for this model?
 * Human actors match by user id; LLM actors match by agent ref. A queue label
 * is never permission on its own.
 */
export function hasActiveShiftForModel(
  shifts: ShiftRow[],
  actor: ActorContext,
  modelId: string,
  now: Date,
): boolean {
  return shifts.some((shift) => {
    if (shift.orgId !== actor.orgId || shift.modelId !== modelId) return false;
    if (!isShiftActive(shift, now)) return false;
    if (actor.actorType === 'llm') {
      return shift.assigneeType === 'llm' && !!actor.agentRef && shift.assigneeAgentRef === actor.agentRef;
    }
    return shift.assigneeType === 'human' && shift.assigneeUserId === actor.userId;
  });
}

export interface NoteAccessInput {
  actor: ActorContext;
  modelId: string;
  /** The actor's existing model assignment rows (model ids). */
  assignedModelIds: string[];
  /** The actor's shifts, already scoped to the tenant. */
  shifts: ShiftRow[];
  now: Date;
}

export interface NoteAccessDecision {
  allowed: boolean;
  reason?: 'model_not_assigned' | 'no_active_shift' | 'tenant_mismatch';
}

/**
 * Decide whether an actor may READ or WRITE team notes for a model.
 *
 * A Chatter must both be assigned to the model AND hold a currently active
 * shift. Other scoped roles require the assignment only. Cross-tenant input is
 * rejected before any other check.
 */
export function canAccessModelNotes(input: NoteAccessInput): NoteAccessDecision {
  const { actor, modelId } = input;
  if (!actor.orgId || input.shifts.some((s) => s.orgId !== actor.orgId)) {
    return { allowed: false, reason: 'tenant_mismatch' };
  }
  // Assignment is authoritative for every scoped role, including Chatter: an
  // active shift for a model the actor is not assigned to grants nothing.
  if (!input.assignedModelIds.includes(modelId)) {
    return { allowed: false, reason: 'model_not_assigned' };
  }

  if (actor.role === 'chatter' || actor.actorType === 'llm') {
    if (!hasActiveShiftForModel(input.shifts, actor, modelId, input.now)) {
      return { allowed: false, reason: 'no_active_shift' };
    }
  }
  return { allowed: true };
}

/**
 * The actor identity to record as a note author. Never trusts a caller-supplied
 * identity: the LLM actor records its declared agent ref, a human records only
 * its own user id.
 */
export function noteAuthorIdentity(actor: ActorContext): { userId: string; actorType: AssigneeType; agentRef?: string } {
  if (actor.actorType === 'llm') {
    if (!actor.agentRef) throw new Error('llm note author requires an agent ref');
    return { userId: actor.userId, actorType: 'llm', agentRef: actor.agentRef };
  }
  return { userId: actor.userId, actorType: 'human' };
}

/** Bounded page size for note/shift history surfaces. */
export const MAX_PAGE_SIZE = 50;

export interface Page<T> {
  data: T[];
  meta: { next_cursor: string | null };
}

/**
 * Slice an over-fetched page (limit + 1) into a bounded page with an opaque
 * cursor. The extra row proves there is more without a second query.
 */
export function paginate<T extends { id: string }>(rows: T[], pageSize = MAX_PAGE_SIZE): Page<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`page size must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  const hasMore = rows.length > pageSize;
  const data = rows.slice(0, pageSize);
  return { data, meta: { next_cursor: hasMore ? data[data.length - 1].id : null } };
}

/** Truthful, non-conflated shift state for the UI. */
export type ShiftDisplayState = 'draft' | 'scheduled' | 'active' | 'expired' | 'completed' | 'cancelled';

/**
 * Derive the display state. A scheduled shift whose window has fully passed is
 * 'expired' — it is never shown as active, and it is never silently rewritten.
 */
export function shiftDisplayState(shift: ShiftRow, now: Date): ShiftDisplayState {
  if (shift.status === 'cancelled') return 'cancelled';
  if (shift.status === 'completed') return 'completed';
  if (shift.status === 'scheduled') {
    return shift.endsAt.getTime() <= now.getTime() ? 'expired' : 'scheduled';
  }
  return isShiftActive(shift, now) ? 'active' : 'expired';
}

/** Queue assignment: only an assignee on an active shift for the model may take a queue. */
export function canTakeQueue(
  shifts: ShiftRow[],
  actor: ActorContext,
  modelId: string,
  queue: string,
  now: Date,
): boolean {
  return shifts.some((shift) => shift.queue === queue
    && shift.modelId === modelId
    && shift.orgId === actor.orgId
    && isShiftActive(shift, now)
    && (actor.actorType === 'llm'
      ? shift.assigneeType === 'llm' && shift.assigneeAgentRef === actor.agentRef
      : shift.assigneeType === 'human' && shift.assigneeUserId === actor.userId));
}
