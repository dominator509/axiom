// ─── Chatter shift/assignment enforcement tests (F-24/F-25/F-26) ──────────
//
// Pure decision-helper tests: no database, no service, no runtime claim.

import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_SIZE,
  canAccessModelNotes,
  canTakeQueue,
  hasActiveShiftForModel,
  isShiftActive,
  noteAuthorIdentity,
  paginate,
  shiftDisplayState,
  type ActorContext,
  type ShiftRow,
} from './team-shift-access.js';

const NOW = new Date('2026-09-18T12:00:00Z');
const ORG = 'org-1';
const MODEL = 'model-1';
const OTHER_MODEL = 'model-2';
const USER = 'user-chatter';
const AGENT = 'agent-llm-1';

function shift(overrides: Partial<ShiftRow> = {}): ShiftRow {
  return {
    id: 'shift-1',
    orgId: ORG,
    modelId: MODEL,
    assigneeType: 'human',
    assigneeUserId: USER,
    queue: 'inbox',
    startsAt: new Date('2026-09-18T08:00:00Z'),
    endsAt: new Date('2026-09-18T16:00:00Z'),
    status: 'active',
    ...overrides,
  };
}

const chatter: ActorContext = { orgId: ORG, userId: USER, actorType: 'human', role: 'chatter' };
const llmActor: ActorContext = { orgId: ORG, userId: 'svc-llm', actorType: 'llm', agentRef: AGENT, role: 'operator' };

describe('F-24 shift activity window', () => {
  it('treats an active in-window shift as active', () => {
    expect(isShiftActive(shift(), NOW)).toBe(true);
  });

  it('treats a half-open window correctly at both boundaries', () => {
    expect(isShiftActive(shift({ startsAt: NOW, endsAt: new Date('2026-09-18T13:00:00Z') }), NOW)).toBe(true);
    expect(isShiftActive(shift({ endsAt: NOW }), NOW)).toBe(false);
  });

  it('never treats a non-active status as active', () => {
    for (const status of ['scheduled', 'completed', 'cancelled'] as const) {
      expect(isShiftActive(shift({ status }), NOW)).toBe(false);
    }
  });

  it('interprets an expired window as expired, not active', () => {
    expect(shiftDisplayState(shift({ endsAt: new Date('2026-09-18T11:00:00Z') }), NOW)).toBe('expired');
  });
});

describe('F-24 truthful shift display states', () => {
  it('reports each terminal and non-terminal state distinctly', () => {
    expect(shiftDisplayState(shift({ status: 'cancelled' }), NOW)).toBe('cancelled');
    expect(shiftDisplayState(shift({ status: 'completed' }), NOW)).toBe('completed');
    expect(shiftDisplayState(shift({ status: 'scheduled', endsAt: new Date('2026-09-19T11:00:00Z') }), NOW)).toBe('scheduled');
    expect(shiftDisplayState(shift({ status: 'scheduled', endsAt: new Date('2026-09-18T09:00:00Z') }), NOW)).toBe('expired');
    expect(shiftDisplayState(shift(), NOW)).toBe('active');
  });
});

describe('F-25 active shift and model assignment enforcement', () => {
  it('allows an assigned chatter with an active shift', () => {
    const decision = canAccessModelNotes({ actor: chatter, modelId: MODEL, assignedModelIds: [MODEL], shifts: [shift()], now: NOW });
    expect(decision).toEqual({ allowed: true });
  });

  it('denies an unassigned model even with an active shift elsewhere', () => {
    const decision = canAccessModelNotes({
      actor: chatter,
      modelId: OTHER_MODEL,
      assignedModelIds: [MODEL],
      shifts: [shift()],
      now: NOW,
    });
    expect(decision).toEqual({ allowed: false, reason: 'model_not_assigned' });
  });

  it('denies an assigned chatter with no active shift', () => {
    const decision = canAccessModelNotes({
      actor: chatter,
      modelId: MODEL,
      assignedModelIds: [MODEL],
      shifts: [shift({ status: 'scheduled' })],
      now: NOW,
    });
    expect(decision).toEqual({ allowed: false, reason: 'no_active_shift' });
  });

  it('denies an expired shift', () => {
    const decision = canAccessModelNotes({
      actor: chatter,
      modelId: MODEL,
      assignedModelIds: [MODEL],
      shifts: [shift({ endsAt: new Date('2026-09-18T11:00:00Z') })],
      now: NOW,
    });
    expect(decision).toEqual({ allowed: false, reason: 'no_active_shift' });
  });

  it('denies a terminal (cancelled) shift', () => {
    const decision = canAccessModelNotes({
      actor: chatter,
      modelId: MODEL,
      assignedModelIds: [MODEL],
      shifts: [shift({ status: 'cancelled' })],
      now: NOW,
    });
    expect(decision.reason).toBe('no_active_shift');
  });

  it('denies cross-tenant shift rows before any other check', () => {
    const decision = canAccessModelNotes({
      actor: chatter,
      modelId: MODEL,
      assignedModelIds: [MODEL],
      shifts: [shift({ orgId: 'org-other' })],
      now: NOW,
    });
    expect(decision).toEqual({ allowed: false, reason: 'tenant_mismatch' });
  });

  it('does not let a queue label alone grant access', () => {
    const noShift = canAccessModelNotes({ actor: chatter, modelId: MODEL, assignedModelIds: [MODEL], shifts: [], now: NOW });
    expect(noShift.reason).toBe('no_active_shift');
    expect(canTakeQueue([], chatter, MODEL, 'inbox', NOW)).toBe(false);
    expect(canTakeQueue([shift()], chatter, MODEL, 'inbox', NOW)).toBe(true);
    expect(canTakeQueue([shift()], chatter, MODEL, 'priority', NOW)).toBe(false);
  });
});

describe('F-25 LLM agent shift ownership', () => {
  it('binds an LLM actor to its own agent ref', () => {
    const own = shift({ assigneeType: 'llm', assigneeUserId: null, assigneeAgentRef: AGENT });
    expect(hasActiveShiftForModel([own], llmActor, MODEL, NOW)).toBe(true);
  });

  it('rejects an LLM actor acting under another agent ref', () => {
    const other = shift({ assigneeType: 'llm', assigneeUserId: null, assigneeAgentRef: 'agent-other' });
    expect(hasActiveShiftForModel([other], llmActor, MODEL, NOW)).toBe(false);
  });

  it('does not let an LLM actor inherit a human shift', () => {
    expect(hasActiveShiftForModel([shift()], llmActor, MODEL, NOW)).toBe(false);
  });

  it('does not let a human actor inherit an LLM shift', () => {
    const llmShift = shift({ assigneeType: 'llm', assigneeUserId: null, assigneeAgentRef: AGENT });
    expect(hasActiveShiftForModel([llmShift], chatter, MODEL, NOW)).toBe(false);
  });

  it('denies an LLM actor with no active shift even when assigned', () => {
    const decision = canAccessModelNotes({
      actor: llmActor,
      modelId: MODEL,
      assignedModelIds: [MODEL],
      shifts: [shift({ assigneeType: 'llm', assigneeUserId: null, assigneeAgentRef: AGENT, status: 'scheduled' })],
      now: NOW,
    });
    expect(decision.reason).toBe('no_active_shift');
  });

  it('allows a non-chatter role with assignment and no shift requirement', () => {
    const manager: ActorContext = { orgId: ORG, userId: 'user-mgr', actorType: 'human', role: 'manager' };
    const decision = canAccessModelNotes({
      actor: manager,
      modelId: MODEL,
      assignedModelIds: [MODEL],
      shifts: [],
      now: NOW,
    });
    expect(decision).toEqual({ allowed: true });
  });
});

describe('F-26 actor attribution and ownership', () => {
  it('records a human author as their own user id', () => {
    expect(noteAuthorIdentity(chatter)).toEqual({ userId: USER, actorType: 'human' });
  });

  it('records an LLM author with its agent ref and never a spoofed one', () => {
    expect(noteAuthorIdentity(llmActor)).toEqual({ userId: 'svc-llm', actorType: 'llm', agentRef: AGENT });
  });

  it('refuses an LLM author without an agent ref', () => {
    expect(() => noteAuthorIdentity({ ...llmActor, agentRef: undefined })).toThrow(/agent ref/);
  });

  it('derives identity from the actor context, ignoring any caller-supplied id', () => {
    const impostor = { ...chatter, userId: USER } as ActorContext & { requestedAuthor?: string };
    const identity = noteAuthorIdentity(impostor);
    expect(identity.userId).toBe(USER);
    expect(Object.keys(identity)).not.toContain('requestedAuthor');
  });
});

describe('F-26 bounded pagination', () => {
  it('returns a cursor when an extra row proves more results', () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `note-${i}` }));
    const page = paginate(rows);
    expect(page.data).toHaveLength(50);
    expect(page.meta.next_cursor).toBe('note-49');
  });

  it('returns a null cursor on the final page', () => {
    const page = paginate([{ id: 'a' }, { id: 'b' }]);
    expect(page.data).toHaveLength(2);
    expect(page.meta.next_cursor).toBeNull();
  });

  it('rejects an unbounded or invalid page size', () => {
    expect(() => paginate([], 0)).toThrow(/between 1 and/);
    expect(() => paginate([], MAX_PAGE_SIZE + 1)).toThrow(/between 1 and/);
    expect(() => paginate([], 1.5)).toThrow(/integer/);
  });

  it('never exceeds the maximum page size', () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: `x-${i}` }));
    expect(paginate(rows, MAX_PAGE_SIZE).data).toHaveLength(MAX_PAGE_SIZE);
  });
});
