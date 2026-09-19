// ─── Chatter LLM/human assignment & persona-path tests ────────────────────
//
// Pure contract tests: no provider contact, no file system read, no database,
// no deployment. Provider/browser/runtime behaviour remains unclaimed.

import { describe, expect, it } from 'vitest';
import {
  ACTOR_REF_MAX,
  FUTURE_PROVIDERS,
  MEMORY_CONTENT_MAX,
  PERSONA_CONTENT_MAX,
  ROLEPLAY_PROVIDERS,
  SOURCE_REF_PATTERN,
  actorIdentity,
  boundMemoryTurns,
  claimIntent,
  handoffRevisionAccepted,
  isActiveRoleplayProvider,
  isFilesystemPath,
  isMutuallyExclusiveActor,
  isValidActorRef,
  makeReplyIntent,
  nextHandoffRevision,
  selectRoleplayProvider,
  validateMemoryContent,
  validatePersonaInput,
} from './roleplay-contract.js';

describe('Chatter persona accepts bounded logical revisions', () => {
  it('accepts canonical soul.md source refs', () => {
    expect(SOURCE_REF_PATTERN.test('soul.md')).toBe(true);
    expect(validatePersonaInput({ expectedRevision: 0, sourceRef: 'soul.md', content: 'Speaks plainly.' })).toEqual({ ok: true });
    expect(validatePersonaInput({ expectedRevision: 3, sourceRef: 'soul.md:variant-a', content: 'Warm.' })).toEqual({ ok: true });
  });

  it('binds content length to the persona budget', () => {
    const long = 'x'.repeat(PERSONA_CONTENT_MAX + 1);
    expect(validatePersonaInput({ expectedRevision: 1, sourceRef: 'soul.md', content: long })).toEqual({
      ok: false,
      error: 'content_too_long',
    });
    expect(validatePersonaInput({ expectedRevision: 1, sourceRef: 'soul.md', content: 'ok' })).toEqual({ ok: true });
  });

  it('rejects empty and whitespace-only persona content', () => {
    expect(validatePersonaInput({ expectedRevision: 0, sourceRef: 'soul.md', content: '   ' }).error).toBe('content_empty');
    expect(validatePersonaInput({ expectedRevision: 0, sourceRef: 'soul.md', content: '' }).error).toBe('content_empty');
  });

  it('rejects an invalid revision', () => {
    expect(validatePersonaInput({ expectedRevision: -1, sourceRef: 'soul.md', content: 'x' }).error).toBe('invalid_revision');
    expect(validatePersonaInput({ expectedRevision: 1.5, sourceRef: 'soul.md', content: 'x' }).error).toBe('invalid_revision');
  });
});

describe('Chatter persona rejects filesystem paths', () => {
  it.each([
    '/etc/passwd',
    './soul.md',
    '../soul.md',
    '..\\soul.md',
    '~/soul.md',
    'C:\\soul.md',
    'soul.md/../../etc/passwd',
    'soul\0.md',
    'soul.md\n',
    'persona.txt',
  ])('rejects %s', (value) => {
    expect(isFilesystemPath(value)).toBe(true);
    expect(validatePersonaInput({ expectedRevision: 0, sourceRef: value, content: 'x' }).ok).toBe(false);
  });

  it('does not flag the logical soul.md reference as a path', () => {
    expect(isFilesystemPath('soul.md')).toBe(false);
    expect(isFilesystemPath('soul.md:variant-a')).toBe(false);
  });

  it('reports the path-specific error for a traversal attempt', () => {
    expect(validatePersonaInput({ expectedRevision: 0, sourceRef: '../soul.md', content: 'x' })).toEqual({
      ok: false,
      error: 'filesystem_path_rejected',
    });
  });
});

describe('Chatter actor refs are bounded and path-free', () => {
  it('accepts plain bounded refs', () => {
    expect(isValidActorRef('user-1')).toBe(true);
    expect(isValidActorRef('agent_llm.1')).toBe(true);
  });

  it('rejects over-long, empty, absolute and slash-bearing refs', () => {
    expect(isValidActorRef('x'.repeat(ACTOR_REF_MAX + 1))).toBe(false);
    expect(isValidActorRef('')).toBe(false);
    expect(isValidActorRef('/abs')).toBe(false);
    expect(isValidActorRef('a/b')).toBe(false);
    expect(isValidActorRef('a\\b')).toBe(false);
    expect(isValidActorRef('a\nb')).toBe(false);
    expect(isValidActorRef(42)).toBe(false);
  });
});

describe('Chatter human/LLM mutual exclusivity', () => {
  it('accepts exactly one identity shape per actor type', () => {
    expect(isMutuallyExclusiveActor({ type: 'human', userId: 'u1', agentRef: null })).toBe(true);
    expect(isMutuallyExclusiveActor({ type: 'llm', userId: null, agentRef: 'agent-1' })).toBe(true);
  });

  it('rejects an actor carrying both identity fields', () => {
    expect(isMutuallyExclusiveActor({ type: 'human', userId: 'u1', agentRef: 'agent-1' })).toBe(false);
    expect(isMutuallyExclusiveActor({ type: 'llm', userId: 'u1', agentRef: 'agent-1' })).toBe(false);
  });

  it('rejects an actor carrying neither identity field', () => {
    expect(isMutuallyExclusiveActor({ type: 'human', userId: null, agentRef: null })).toBe(false);
    expect(isMutuallyExclusiveActor({ type: 'llm', userId: undefined, agentRef: undefined })).toBe(false);
  });

  it('derives distinct attribution for human and LLM actors', () => {
    expect(actorIdentity({ type: 'human', ref: 'u1' })).toBe('human:u1');
    expect(actorIdentity({ type: 'llm', ref: 'agent-1' })).toBe('llm:agent-1');
    expect(actorIdentity({ type: 'human', ref: 'u1' })).not.toBe(actorIdentity({ type: 'llm', ref: 'u1' }));
  });

  it('refuses to build an identity from an invalid ref', () => {
    expect(() => actorIdentity({ type: 'human', ref: '../x' })).toThrow(/invalid actor ref/);
  });
});

describe('Chatter memory bounds', () => {
  it('enforces the memory content budget', () => {
    expect(validateMemoryContent('hello')).toBe(true);
    expect(validateMemoryContent(' '.repeat(3))).toBe(false);
    expect(validateMemoryContent('x'.repeat(MEMORY_CONTENT_MAX + 1))).toBe(false);
    expect(validateMemoryContent(123)).toBe(false);
  });

  it('keeps only the most recent turns, oldest first', () => {
    const turns = Array.from({ length: 20 }, (_, i) => i);
    const bounded = boundMemoryTurns(turns, 5);
    expect(bounded).toEqual([15, 16, 17, 18, 19]);
  });

  it('rejects a non-positive window', () => {
    expect(() => boundMemoryTurns([1], 0)).toThrow(/positive integer/);
    expect(() => boundMemoryTurns([1], -3)).toThrow(/positive integer/);
  });
});

describe('Chatter stale handoff revisions', () => {
  it('accepts only a matching revision and computes the next one', () => {
    expect(handoffRevisionAccepted(4, 4)).toBe(true);
    expect(handoffRevisionAccepted(5, 4)).toBe(false);
    expect(nextHandoffRevision(4)).toBe(5);
  });

  it('rejects invalid revision numbers', () => {
    expect(handoffRevisionAccepted(-1, 0)).toBe(false);
    expect(handoffRevisionAccepted(1.5, 1.5)).toBe(false);
    expect(handoffRevisionAccepted(0, Number.NaN)).toBe(false);
  });

  it('models a concurrent handoff so the slow writer loses', () => {
    const current = 1;
    const fast = handoffRevisionAccepted(current, 1);
    expect(fast).toBe(true);
    const slow = handoffRevisionAccepted(nextHandoffRevision(current), 1);
    expect(slow).toBe(false);
  });
});

describe('Chatter duplicate reply intent', () => {
  it('admits the first intent and rejects a duplicate', () => {
    const seen = new Set<string>();
    expect(claimIntent(seen, 'intent-1')).toBe(true);
    expect(claimIntent(seen, 'intent-1')).toBe(false);
    expect(claimIntent(seen, 'intent-2')).toBe(true);
  });

  it('rejects an empty intent key', () => {
    const seen = new Set<string>();
    expect(claimIntent(seen, '')).toBe(false);
  });

  it('never auto-sends and always requires consent and approval', () => {
    const intent = makeReplyIntent('intent-1');
    expect(intent.autoSend).toBe(false);
    expect(intent.requiresConsent).toBe(true);
    expect(intent.requiresApproval).toBe(true);
  });
});

describe('Chatter provider boundary', () => {
  it('runs Grok first and keeps Venice as a reserved future provider', () => {
    expect(ROLEPLAY_PROVIDERS).toEqual(['grok']);
    expect(FUTURE_PROVIDERS).toEqual(['venice']);
    expect(isActiveRoleplayProvider('grok')).toBe(true);
    expect(isActiveRoleplayProvider('venice')).toBe(false);
    expect(selectRoleplayProvider('grok')).toBe('grok');
    expect(selectRoleplayProvider('venice')).toBeUndefined();
    expect(selectRoleplayProvider('unknown')).toBeUndefined();
  });
});
