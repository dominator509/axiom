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
  source_repo: 'github.com/dominator509/axiom',
  source_branch: 'refs/heads/codex/telegram-webhook-hardening',
  source_ref: 'refs/heads/codex/telegram-webhook-hardening',
  source_commit: 'f'.repeat(40),
  remote_ref_head: 'e'.repeat(40),
  source_sync_command: 'git fetch --all --prune',
  source_mirror_root: '/srv/fanthynks-bridge/hermes/control-sync-r2/mirror',
  source_mirror_layout: 'bare-mirror',
  source_ref_verify_command: 'git rev-parse --verify refs/heads/codex/telegram-webhook-hardening',
  source_commit_verify_command: 'git cat-file -t ffffffffffffffffffffffffffffffffffffffff^{commit}',
  source_ancestry_verify_command: 'git merge-base --is-ancestor ffffffffffffffffffffffffffffffffffffffff refs/heads/codex/telegram-webhook-hardening',
  worktree_kind: 'source-copy',
  task_sha256: 'a'.repeat(64),
  copy_root: '/srv/fanthynks-bridge/hermes/control-sync-r2',
  delivery_root: '/srv/fanthynks-bridge/hermes/deliveries/control-sync-r2',
  state: 'OPEN',
  next_owner: 'HERMES',
  last_seq: 0,
  next_seq: 1,
  last_wire: 'NONE',
  supersedes: ['CODEX-F14-MODEL-WATERMARK-POLICY-SOURCE-R10-001'],
  superseded_task_msg_ids: ['codex-old-control-task'],
  stale_inbox_policy: 'CURRENT_TASK_ONLY; all superseded inbox identities are historical and inert',
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

test('rejects a sequence-one state that points at a superseded wire', () => {
  const state = base();
  state.last_seq = 1;
  state.next_seq = 2;
  state.last_wire = 'CODEX-F14-MODEL-WATERMARK-POLICY-SOURCE-R10-001';
  assert.throws(() => validateLoopState(state), /last_wire must equal task_wire/);
});

test('rejects a source binding whose ref differs from the declared branch', () => {
  const state = base();
  state.source_ref = 'refs/heads/main';
  assert.throws(() => validateLoopState(state), /source_ref must equal source_branch/);
});

test('rejects a stale policy that does not make the current task exclusive', () => {
  const state = base();
  state.stale_inbox_policy = 'PROCESS_WHATEVER_IS_NEWEST';
  assert.throws(() => validateLoopState(state), /CURRENT_TASK_ONLY/);
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
