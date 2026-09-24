import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { validateSyncBinding } from './hermes-sync-check.mjs';

const state = () => ({
  protocol: 'FT-HERMES/1',
  contract: 'ACK-NACK-1',
  task: 'HERMES-SOURCE-SYNC-CHECK',
  task_msg_id: 'codex-hermes-source-sync-check',
  task_filename: 'codex-hermes-source-sync-check.json',
  task_wire: 'CODEX-HERMES-SOURCE-SYNC-CHECK-001',
  source_repo: 'github.com/dominator509/axiom',
  source_branch: 'refs/heads/codex/telegram-webhook-hardening',
  source_ref: 'refs/heads/codex/telegram-webhook-hardening',
  source_commit: 'f'.repeat(40),
  remote_ref_head: 'e'.repeat(40),
  source_sync_command: 'git fetch --all --prune',
  source_mirror_root: '/srv/hermes/mirror',
  source_mirror_layout: 'bare-mirror',
  source_ref_verify_command: 'git rev-parse --verify refs/heads/codex/telegram-webhook-hardening',
  source_commit_verify_command: 'git cat-file -t ffffffffffffffffffffffffffffffffffffffff^{commit}',
  source_ancestry_verify_command: 'git merge-base --is-ancestor ffffffffffffffffffffffffffffffffffffffff refs/heads/codex/telegram-webhook-hardening',
  worktree_kind: 'source-copy',
  task_sha256: '0'.repeat(64),
  copy_root: '/srv/hermes/copy',
  delivery_root: '/srv/hermes/delivery',
  state: 'OPEN',
  next_owner: 'HERMES',
  last_seq: 1,
  next_seq: 2,
  last_wire: 'CODEX-HERMES-SOURCE-SYNC-CHECK-001',
  supersedes: ['CODEX-OLD-TASK-001'],
  superseded_task_msg_ids: ['codex-old-task'],
  stale_inbox_policy: 'CURRENT_TASK_ONLY; all other identities are inert',
  next_action: 'Return one sync ACK.',
  live_actions: 'NONE',
  forbidden_actions: ['deployment', 'migration', 'database', 'provider', 'credentials', 'permissions', 'network', 'runtime'],
  signature: 'sincerely, Codex',
});

const taskBody = (overrides = {}) => {
  const fields = {
    CONTRACT: 'ACK-NACK-1',
    TYPE: 'TASK',
    TASK: 'HERMES-SOURCE-SYNC-CHECK',
    WIRE: 'CODEX-HERMES-SOURCE-SYNC-CHECK-001',
    SEQ: '1',
    IN_REPLY_TO: 'NONE',
    STATE: 'OPEN',
    TERMINAL: 'NO',
    NEXT_OWNER: 'HERMES',
    SOURCE_REPO: 'github.com/dominator509/axiom',
    SOURCE_REF: 'refs/heads/codex/telegram-webhook-hardening',
    SOURCE_COMMIT: 'f'.repeat(40),
    SOURCE_REF_HEAD: 'e'.repeat(40),
    SOURCE_SYNC_COMMAND: 'git fetch --all --prune',
    SOURCE_MIRROR_ROOT: '/srv/hermes/mirror',
    SOURCE_MIRROR_LAYOUT: 'bare-mirror — refs/heads/*',
    SOURCE_REF_VERIFY_COMMAND: 'git rev-parse --verify refs/heads/codex/telegram-webhook-hardening',
    SOURCE_COMMIT_VERIFY_COMMAND: 'git cat-file -t ffffffffffffffffffffffffffffffffffffffff^{commit}',
    SOURCE_ANCESTRY_VERIFY_COMMAND: 'git merge-base --is-ancestor ffffffffffffffffffffffffffffffffffffffff refs/heads/codex/telegram-webhook-hardening',
    COPY_ROOT: '/srv/hermes/copy',
    DELIVERY_ROOT: '/srv/hermes/delivery',
    WORKTREE_KIND: 'source-copy — exact commit',
    ...overrides,
  };
  const headerKeys = ['CONTRACT', 'TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL', 'NEXT_OWNER'];
  const payloadKeys = ['SOURCE_REPO', 'SOURCE_REF', 'SOURCE_COMMIT', 'SOURCE_REF_HEAD', 'SOURCE_SYNC_COMMAND', 'SOURCE_MIRROR_ROOT', 'SOURCE_MIRROR_LAYOUT', 'SOURCE_REF_VERIFY_COMMAND', 'SOURCE_COMMIT_VERIFY_COMMAND', 'SOURCE_ANCESTRY_VERIFY_COMMAND', 'COPY_ROOT', 'DELIVERY_ROOT', 'WORKTREE_KIND'];
  return [
    'FT-HERMES/1',
    ...headerKeys.map((key) => `${key}: ${fields[key]}`),
    'NEXT_ACTION: Return one sync ACK.',
    'REASON: NONE',
    'PAYLOAD_SHA256: NONE',
    'PAYLOAD:',
    'READ_STATUS: NOT_APPLICABLE',
    ...payloadKeys.map((key) => `${key}: ${fields[key]}`),
    'sincerely, Codex',
  ].join('\n');
};

function buildTask(body) {
  return {
    msg_id: 'codex-hermes-source-sync-check',
    from: 'codex',
    sent_at: '1970-01-01T00:00:00Z',
    subject: 'source sync check',
    body,
  };
}

function runner(args) {
  const map = new Map([
    ['cat-file', { exitCode: 0, stdout: 'commit\n' }],
    ['rev-parse', { exitCode: 0, stdout: `${'e'.repeat(40)}\n` }],
    ['merge-base', { exitCode: 0, stdout: '' }],
  ]);
  return map.get(args[0]);
}

test('accepts matching task, exact source pin and remote ref readback', () => {
  const current = state();
  const body = taskBody();
  const task = buildTask(body);
  current.task_sha256 = crypto.createHash('sha256').update(JSON.stringify(task)).digest('hex');
  const result = validateSyncBinding({
    state: current,
    task,
    taskBytes: Buffer.from(JSON.stringify(task)),
    gitRunner: runner,
  });
  assert.equal(result.sourceCommit, 'f'.repeat(40));
});

test('rejects a task that drifts to a different source commit', () => {
  const current = state();
  const task = buildTask(taskBody({ SOURCE_COMMIT: 'a'.repeat(40) }));
  current.task_sha256 = crypto.createHash('sha256').update(JSON.stringify(task)).digest('hex');
  assert.throws(() => validateSyncBinding({
    state: current,
    task,
    taskBytes: Buffer.from(JSON.stringify(task)),
    gitRunner: runner,
  }), /SOURCE_COMMIT does not match/);
});

test('rejects a source task that does not refresh all refs', () => {
  const current = state();
  const task = buildTask(taskBody({ SOURCE_SYNC_COMMAND: 'git fetch origin main' }));
  current.task_sha256 = crypto.createHash('sha256').update(JSON.stringify(task)).digest('hex');
  assert.throws(() => validateSyncBinding({
    state: current,
    task,
    taskBytes: Buffer.from(JSON.stringify(task)),
    gitRunner: runner,
}), /SOURCE_SYNC_COMMAND does not match/);
});

test('rejects a task whose declared ref head is not the pinned remote readback', () => {
  const current = state();
  const task = buildTask(taskBody({ SOURCE_REF_HEAD: 'd'.repeat(40) }));
  current.task_sha256 = crypto.createHash('sha256').update(JSON.stringify(task)).digest('hex');
  assert.throws(() => validateSyncBinding({
    state: current,
    task,
    taskBytes: Buffer.from(JSON.stringify(task)),
    gitRunner: runner,
  }), /SOURCE_REF_HEAD does not match/);
});
