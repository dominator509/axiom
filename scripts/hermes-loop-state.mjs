#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const idPattern = /^[A-Za-z0-9._-]{1,128}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const clockKeyPattern = /(?:DATE|TIME|TIMESTAMP|DEADLINE|TTL|EPOCH|CLOCK|EXPIRE|(?:_AT)$)/i;
const allowedStates = new Set(['OPEN', 'READ', 'ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'REJECTED', 'BLOCKED', 'CLOSED']);
const allowedOwners = new Set(['CODEX', 'HERMES', 'NONE']);
const nextOwnerByState = new Map([
  ['OPEN', 'HERMES'],
  ['READ', 'CODEX'],
  ['ACCEPTED', 'HERMES'],
  ['IN_PROGRESS', 'HERMES'],
  ['DELIVERED', 'CODEX'],
  ['REJECTED', 'CODEX'],
  ['BLOCKED', 'CODEX'],
  ['CLOSED', 'NONE'],
]);
const requiredKeys = new Set([
  'protocol', 'contract', 'task', 'task_msg_id', 'task_filename', 'task_wire',
  'source_repo', 'source_branch', 'source_ref', 'source_commit', 'remote_ref_head',
  'source_sync_command', 'source_mirror_root', 'source_mirror_layout',
  'source_ref_verify_command', 'source_commit_verify_command',
  'source_ancestry_verify_command', 'worktree_kind', 'task_sha256',
  'copy_root', 'delivery_root',
  'state', 'next_owner', 'last_seq', 'next_seq', 'last_wire', 'supersedes',
  'superseded_task_msg_ids', 'stale_inbox_policy', 'next_action', 'live_actions',
  'forbidden_actions', 'signature',
]);

function fail(message) {
  throw new Error(message);
}

function walkNoClockFields(value, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkNoClockFields(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (clockKeyPattern.test(key)) fail(`${location}.${key}: clock/date fields are forbidden`);
    walkNoClockFields(entry, `${location}.${key}`);
  }
}

function stringField(value, key) {
  if (typeof value !== 'string' || value.length === 0) fail(`${key}: must be a non-empty string`);
  return value;
}

function identifier(value, key) {
  const result = stringField(value, key);
  if (!idPattern.test(result)) fail(`${key}: invalid logical identifier`);
  return result;
}

export function validateLoopState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('manifest must be an object');
  walkNoClockFields(state);
  const keys = Object.keys(state);
  for (const key of keys) if (!requiredKeys.has(key)) fail(`unexpected manifest field ${key}`);
  for (const key of requiredKeys) if (!(key in state)) fail(`missing manifest field ${key}`);

  if (state.protocol !== 'FT-HERMES/1') fail('protocol must be FT-HERMES/1');
  if (state.contract !== 'ACK-NACK-1') fail('contract must be ACK-NACK-1');
  identifier(state.task, 'task');
  const msgId = identifier(state.task_msg_id, 'task_msg_id');
  if (state.task_filename !== `${msgId}.json`) fail('task_filename must equal task_msg_id.json');
  identifier(state.task_filename.slice(0, -5), 'task_filename');
  identifier(state.task_wire, 'task_wire');
  stringField(state.source_repo, 'source_repo');
  stringField(state.source_branch, 'source_branch');
  stringField(state.source_ref, 'source_ref');
  if (state.source_ref !== state.source_branch) fail('source_ref must equal source_branch');
  if (!shaPattern.test(state.source_commit)) fail('source_commit must be a 40-character lowercase SHA-1');
  if (!shaPattern.test(state.remote_ref_head)) fail('remote_ref_head must be a 40-character lowercase SHA-1');
  for (const key of [
    'source_sync_command',
    'source_mirror_root',
    'source_ref_verify_command',
    'source_commit_verify_command',
    'source_ancestry_verify_command',
    'worktree_kind',
  ]) stringField(state[key], key);
  if (!['bare-mirror', 'standard-clone'].includes(state.source_mirror_layout)) {
    fail('source_mirror_layout must be bare-mirror or standard-clone');
  }
  if (!digestPattern.test(state.task_sha256)) fail('task_sha256 must be a 64-character lowercase SHA-256');
  for (const key of ['copy_root', 'delivery_root']) stringField(state[key], key);
  if (!allowedStates.has(state.state)) fail(`state: unsupported value ${state.state}`);
  if (!allowedOwners.has(state.next_owner)) fail(`next_owner: unsupported value ${state.next_owner}`);
  if (nextOwnerByState.get(state.state) !== state.next_owner) {
    fail(`next_owner must be ${nextOwnerByState.get(state.state)} for state ${state.state}`);
  }
  for (const key of ['last_seq', 'next_seq']) {
    if (!Number.isSafeInteger(state[key]) || state[key] < 0) fail(`${key}: must be a non-negative integer`);
  }
  if (state.next_seq !== state.last_seq + 1) fail('next_seq must equal last_seq + 1');
  if (state.last_seq === 0 && state.last_wire !== 'NONE') fail('last_wire must be NONE before the first reply');
  if (state.last_seq > 0) identifier(state.last_wire, 'last_wire');
  if (state.last_seq === 1 && state.last_wire !== state.task_wire) {
    fail('last_wire must equal task_wire at sequence 1');
  }
  if (!Array.isArray(state.supersedes) || state.supersedes.some(value => typeof value !== 'string' || !idPattern.test(value))) {
    fail('supersedes must be an array of logical WIRE identifiers');
  }
  if (new Set(state.supersedes).size !== state.supersedes.length) fail('supersedes must not contain duplicates');
  if (!Array.isArray(state.superseded_task_msg_ids)
    || state.superseded_task_msg_ids.some(value => typeof value !== 'string' || !idPattern.test(value))) {
    fail('superseded_task_msg_ids must be an array of logical message identifiers');
  }
  if (new Set(state.superseded_task_msg_ids).size !== state.superseded_task_msg_ids.length) {
    fail('superseded_task_msg_ids must not contain duplicates');
  }
  if (state.superseded_task_msg_ids.includes(state.task_msg_id)) {
    fail('current task_msg_id cannot be superseded');
  }
  stringField(state.stale_inbox_policy, 'stale_inbox_policy');
  if (!state.stale_inbox_policy.includes('CURRENT_TASK_ONLY')) {
    fail('stale_inbox_policy must require CURRENT_TASK_ONLY');
  }
  stringField(state.next_action, 'next_action');
  if (state.live_actions !== 'NONE') fail('live_actions must be NONE');
  if (!Array.isArray(state.forbidden_actions) || state.forbidden_actions.length === 0
    || state.forbidden_actions.some(value => typeof value !== 'string' || value.length === 0)) {
    fail('forbidden_actions must be a non-empty string array');
  }
  if (state.signature !== 'sincerely, Codex') fail('signature must be sincerely, Codex');

  return {
    task: state.task,
    taskMsgId: msgId,
    taskWire: state.task_wire,
    state: state.state,
    nextOwner: state.next_owner,
    lastSeq: state.last_seq,
    nextSeq: state.next_seq,
    nextAction: state.next_action,
  };
}

export function auditFile(file) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  return validateLoopState(state);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: hermes-loop-state.mjs <manifest.json>');
    process.exitCode = 2;
  } else {
    try {
      const summary = auditFile(file);
      console.log(`hermes-loop-state: PASS task=${summary.task} state=${summary.state} next_owner=${summary.nextOwner} next_seq=${summary.nextSeq} next_action=${summary.nextAction}`);
    } catch (error) {
      console.error(`hermes-loop-state: FAIL ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
