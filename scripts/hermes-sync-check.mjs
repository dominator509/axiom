#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateLoopState } from './hermes-loop-state.mjs';

const sentinel = '1970-01-01T00:00:00Z';
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const forbiddenClockField = /(?:DATE|TIME|TIMESTAMP|DEADLINE|TTL|EPOCH|CLOCK|EXPIRE|(?:_AT)$)/i;

function fail(message) {
  throw new Error(message);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseFields(body) {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  if (lines.at(-1) !== 'sincerely, Codex') fail('task body must end with exactly sincerely, Codex');
  if (lines[0] !== 'FT-HERMES/1') fail('task body is missing FT-HERMES/1');
  const payloadIndex = lines.indexOf('PAYLOAD:');
  if (payloadIndex < 0) fail('task body is missing PAYLOAD:');
  const headers = new Map();
  const payload = new Map();
  const read = (line, target, location) => {
    const match = /^(?<key>[A-Z0-9_]+): (?<value>.*)$/.exec(line);
    if (!match) return;
    if (forbiddenClockField.test(match.groups.key)) fail(`${location} contains a clock/date field`);
    if (target.has(match.groups.key)) fail(`${location} contains duplicate ${match.groups.key}`);
    target.set(match.groups.key, match.groups.value);
  };
  for (const line of lines.slice(1, payloadIndex)) read(line, headers, 'task headers');
  for (const line of lines.slice(payloadIndex + 1, -1)) read(line, payload, 'task payload');
  return { headers, payload };
}

function field(fields, key) {
  return fields.headers.get(key) ?? fields.payload.get(key);
}

function canonicalBindingValue(value) {
  return value.split(' — ', 1)[0].trim();
}

function runGit(args, repoDir) {
  const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function validateSyncBinding({ state, task, taskBytes, repoDir = process.cwd(), gitRunner = runGit }) {
  validateLoopState(state);
  if (!task || typeof task !== 'object' || Array.isArray(task)) fail('task envelope must be an object');
  if (task.msg_id !== state.task_msg_id) fail('task msg_id does not match the current manifest');
  if (task.from !== 'codex') fail('task envelope must be from codex');
  if (task.sent_at !== sentinel) fail('task envelope must use the fixed transport sentinel');
  if (typeof task.body !== 'string') fail('task envelope body must be a string');
  if (!Buffer.isBuffer(taskBytes) && typeof taskBytes !== 'string') fail('taskBytes must be raw file bytes or a string');
  if (digest(taskBytes) !== state.task_sha256) fail('task file SHA-256 does not match the current manifest');

  const fields = parseFields(task.body);
  const expectedHeaders = new Map([
    ['CONTRACT', 'ACK-NACK-1'],
    ['TYPE', 'TASK'],
    ['TASK', state.task],
    ['WIRE', state.task_wire],
    ['SEQ', '1'],
    ['IN_REPLY_TO', 'NONE'],
    ['STATE', 'OPEN'],
    ['TERMINAL', 'NO'],
    ['NEXT_OWNER', 'HERMES'],
  ]);
  for (const [key, expected] of expectedHeaders) {
    if (fields.headers.get(key) !== expected) fail(`task header ${key} does not match the current manifest`);
  }
  for (const key of ['SOURCE_REPO', 'SOURCE_REF', 'SOURCE_COMMIT', 'SOURCE_SYNC_COMMAND',
    'SOURCE_MIRROR_ROOT', 'SOURCE_MIRROR_LAYOUT', 'SOURCE_REF_VERIFY_COMMAND',
    'SOURCE_COMMIT_VERIFY_COMMAND', 'SOURCE_ANCESTRY_VERIFY_COMMAND', 'COPY_ROOT',
    'DELIVERY_ROOT', 'WORKTREE_KIND']) {
    if (field(fields, key) === undefined) fail(`task is missing ${key}`);
  }
  const expectedPayload = new Map([
    ['SOURCE_REPO', state.source_repo],
    ['SOURCE_REF', state.source_ref],
    ['SOURCE_COMMIT', state.source_commit],
    ['SOURCE_SYNC_COMMAND', state.source_sync_command],
    ['SOURCE_MIRROR_ROOT', state.source_mirror_root],
    ['SOURCE_MIRROR_LAYOUT', state.source_mirror_layout],
    ['SOURCE_REF_VERIFY_COMMAND', state.source_ref_verify_command],
    ['SOURCE_COMMIT_VERIFY_COMMAND', state.source_commit_verify_command],
    ['SOURCE_ANCESTRY_VERIFY_COMMAND', state.source_ancestry_verify_command],
    ['COPY_ROOT', state.copy_root],
    ['DELIVERY_ROOT', state.delivery_root],
    ['WORKTREE_KIND', state.worktree_kind],
  ]);
  for (const [key, expected] of expectedPayload) {
    const actual = ['SOURCE_MIRROR_LAYOUT', 'WORKTREE_KIND'].includes(key)
      ? canonicalBindingValue(field(fields, key))
      : field(fields, key);
    if (actual !== expected) fail(`task payload ${key} does not match the current manifest`);
  }
  if (!field(fields, 'SOURCE_SYNC_COMMAND').includes('fetch --all --prune')) {
    fail('source sync command must refresh all remote refs with prune');
  }
  if (field(fields, 'WORKTREE_KIND').includes('build') || field(fields, 'WORKTREE_KIND').includes('release')) {
    fail('deployment/build worktrees cannot be coding sources');
  }

  const cat = gitRunner(['cat-file', '-t', `${state.source_commit}^{commit}`], repoDir);
  if (cat.exitCode !== 0 || cat.stdout.trim() !== 'commit') fail('exact source commit is not a local commit object');
  const ref = gitRunner(['rev-parse', '--verify', state.source_ref], repoDir);
  if (ref.exitCode !== 0 || !shaPattern.test(ref.stdout.trim())) fail('declared source ref cannot be resolved');
  const remoteHead = gitRunner(['cat-file', '-t', `${state.remote_ref_head}^{commit}`], repoDir);
  if (remoteHead.exitCode !== 0 || remoteHead.stdout.trim() !== 'commit') {
    fail('last remote readback head is not a local commit object');
  }
  const remoteAncestry = gitRunner(['merge-base', '--is-ancestor', state.remote_ref_head, state.source_ref], repoDir);
  if (remoteAncestry.exitCode !== 0) fail('last remote readback is not in the current source-ref history');
  const ancestry = gitRunner(['merge-base', '--is-ancestor', state.source_commit, state.source_ref], repoDir);
  if (ancestry.exitCode !== 0) fail('exact source commit is not an ancestor of the declared source ref');

  return {
    task: state.task,
    taskMsgId: state.task_msg_id,
    taskWire: state.task_wire,
    taskSha256: state.task_sha256,
    sourceCommit: state.source_commit,
    sourceRefHead: state.remote_ref_head,
    sourceMirrorLayout: state.source_mirror_layout,
    copyRoot: state.copy_root,
    deliveryRoot: state.delivery_root,
  };
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const stateFile = process.argv[2];
  const taskFile = process.argv[3];
  const repoDir = process.argv[4] ? path.resolve(process.argv[4]) : process.cwd();
  if (!stateFile || !taskFile) {
    console.error('usage: hermes-sync-check.mjs <manifest.json> <task-envelope.json> [repo-root]');
    process.exitCode = 2;
  } else {
    try {
      const state = loadJson(stateFile);
      const taskBytes = fs.readFileSync(taskFile);
      const task = JSON.parse(taskBytes.toString('utf8'));
      const summary = validateSyncBinding({ state, task, taskBytes, repoDir });
      console.log(`hermes-sync-check: PASS task=${summary.task} task_sha256=${summary.taskSha256} source_commit=${summary.sourceCommit} source_ref_head=${summary.sourceRefHead} mirror=${summary.sourceMirrorLayout} copy_root=${summary.copyRoot} delivery_root=${summary.deliveryRoot}`);
    } catch (error) {
      console.error(`hermes-sync-check: FAIL ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
