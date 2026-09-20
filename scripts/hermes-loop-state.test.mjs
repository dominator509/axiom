import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLoopState } from './hermes-loop-state.mjs';

const base = () => ({
  protocol: 'FT-HERMES/1',
  contract: 'ACK-NACK-1',
  task: 'CODEX-HERMES-LOOP-SYNC-R2',
  task_msg_id: 'codex-hermes-loop-sync-r2',
  task_filename: 'codex-hermes-loop-sync-r2.json',
  task_wire: 'CODEX-HERMES-LOOP-SYNC-R2-001',
  source_branch: 'refs/heads/codex/telegram-webhook-hardening',
  source_commit: 'f'.repeat(40),
  task_sha256: 'a'.repeat(64),
  copy_root: '/srv/fanthynks-bridge/hermes/control-sync-r2',
  delivery_root: '/srv/fanthynks-bridge/hermes/deliveries/control-sync-r2',
  state: 'OPEN',
  next_owner: 'HERMES',
  last_seq: 0,
  next_seq: 1,
  last_wire: 'NONE',
  supersedes: ['CODEX-F14-MODEL-WATERMARK-POLICY-SOURCE-R10-001'],
  next_action: 'Read the exact pushed source and return one correlated ACK/READ.',
  live_actions: 'NONE',
  forbidden_actions: ['deployment', 'migration', 'database', 'provider', 'credentials', 'permissions', 'network', 'runtime'],
  signature: 'sincerely, Codex',
});

test('accepts a logical state without clock fields', () => {
  assert.deepEqual(validateLoopState(base()), {
    task: 'CODEX-HERMES-LOOP-SYNC-R2',
    taskMsgId: 'codex-hermes-loop-sync-r2',
    taskWire: 'CODEX-HERMES-LOOP-SYNC-R2-001',
    state: 'OPEN',
    nextOwner: 'HERMES',
    lastSeq: 0,
    nextSeq: 1,
    nextAction: 'Read the exact pushed source and return one correlated ACK/READ.',
  });
});

test('rejects a filename that is not the envelope identity', () => {
  const state = base();
  state.task_filename = 'stale-copy.json';
  assert.throws(() => validateLoopState(state), /task_filename must equal task_msg_id/);
});

test('rejects clock and date fields at any nesting level', () => {
  const state = base();
  state.transport = { replied_at: '1970-01-01T00:00:00Z' };
  assert.throws(() => validateLoopState(state), /clock\/date fields are forbidden/);
});

test('rejects a second sequence that does not advance the logical predecessor', () => {
  const state = base();
  state.state = 'IN_PROGRESS';
  state.next_owner = 'HERMES';
  state.last_seq = 2;
  state.next_seq = 4;
  state.last_wire = 'HERMES-HERMES-LOOP-SYNC-R2-ACK-002';
  assert.throws(() => validateLoopState(state), /next_seq must equal last_seq/);
});

test('requires the state owner to match the state machine', () => {
  const state = base();
  state.state = 'ACK_READ';
  assert.throws(() => validateLoopState(state), /unsupported value ACK_READ/);
  state.state = 'READ';
  state.next_owner = 'HERMES';
  assert.throws(() => validateLoopState(state), /next_owner must be CODEX/);
});

test('requires source-only lanes to declare no live actions', () => {
  const state = base();
  state.live_actions = 'DEPLOY';
  assert.throws(() => validateLoopState(state), /live_actions must be NONE/);
});
