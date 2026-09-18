import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/hermes-protocol-audit.mjs');
const sentinel = '1970-01-01T00:00:00Z';

function body({ type, task, wire, seq, inReplyTo, state, terminal, nextOwner, nextAction, reason = 'NONE', from }) {
  const signature = from === 'codex' ? 'sincerely, Codex' : 'sincerely, Hermes';
  return [
    'FT-HERMES/1',
    `TYPE: ${type}`,
    `TASK: ${task}`,
    `WIRE: ${wire}`,
    `SEQ: ${seq}`,
    `IN_REPLY_TO: ${inReplyTo}`,
    `STATE: ${state}`,
    `TERMINAL: ${terminal}`,
    `NEXT_OWNER: ${nextOwner}`,
    `NEXT_ACTION: ${nextAction}`,
    `REASON: ${reason}`,
    'PAYLOAD_SHA256: NONE',
    'PAYLOAD:',
    'LIVE_ACTIONS: NONE',
    signature,
  ].join('\n');
}

function envelope(id, from, messageBody) {
  return { msg_id: id, from, sent_at: sentinel, subject: id, body: messageBody };
}

function legacyHermesAckBody(task, wire, inReplyTo, seq) {
  return [
    'FT-HERMES/1',
    'TYPE: ACK',
    `TASK: ${task}`,
    `WIRE: ${wire}`,
    `SEQ: ${seq}`,
    `IN_REPLY_TO: ${inReplyTo}`,
    'STATE: ACKNOWLEDGED',
    'TERMINAL: NO',
    'NEXT_OWNER: HERMES',
    'DELIVERY_ACCEPTED: NO',
    'SCOPE_ACCEPTED: YES - bounded source node only',
    'LIVE_ACTIONS: NONE',
    'sincerely, Ip Man',
    '',
    'sincerely, hermes',
  ].join('\n');
}

function legacyHermesBlockedAckBody(task, wire, inReplyTo, seq) {
  return [
    'FT-HERMES/1',
    'TYPE: ACK',
    `TASK: ${task}`,
    `WIRE: ${wire}`,
    `SEQ: ${seq}`,
    `IN_REPLY_TO: ${inReplyTo}`,
    'STATE: ACKNOWLEDGED',
    'TERMINAL: NO',
    'NEXT_OWNER: CODEX',
    'DELIVERY_ACCEPTED: NO',
    'STATUS: BLOCKED - source tree is not writable by the Hermes account',
    'LIVE_ACTIONS: NONE',
    'sincerely, Ip Man',
    '',
    'sincerely, hermes',
  ].join('\n');
}

function annotatedHermesAckBody(task, wire, inReplyTo, seq) {
  return [
    'FT-HERMES/1',
    'TYPE: ACK',
    `TASK: ${task}`,
    `WIRE: ${wire}`,
    `SEQ: ${seq}`,
    `IN_REPLY_TO: ${inReplyTo}`,
    'STATE: ACCEPTED',
    'TERMINAL: NO',
    'NEXT_OWNER: HERMES',
    'NEXT_ACTION: Publish progress',
    'REASON: NONE',
    'PAYLOAD_SHA256: NONE',
    'PAYLOAD:',
    'LIVE_ACTIONS: NONE',
    'sincerely, Ip Man (role: bridge-responder)',
  ].join('\n');
}

function run(messages, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-hermes-protocol-'));
  for (const [name, message] of messages) fs.writeFileSync(path.join(dir, name), JSON.stringify(message));
  return spawnSync(process.execPath, [script, dir, ...extra], { encoding: 'utf8' });
}

test('accepts a correlated ACK and explicit nonterminal handoff', () => {
  const task = 'AUDIT-ONE';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'IN_PROGRESS', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'codex' }))],
  ], ['--allow-pending']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=IN_PROGRESS/);
});

test('normalizes the deployed bridge ACKNOWLEDGED envelope without accepting delivery', () => {
  const task = 'LEGACY-BRIDGE-ACK';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', legacyHermesAckBody(task, 'W2', 'W1', 2))],
  ], ['--allow-pending']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=ACCEPTED/);
  assert.doesNotMatch(result.stdout, /DELIVERED/);
});

test('normalizes a legacy ACK with explicit STATUS BLOCKED into a terminal NOT-ACK', () => {
  const task = 'LEGACY-BRIDGE-BLOCKED';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish source delivery', from: 'codex' }))],
    ['04.json', envelope('m4', 'hermes', legacyHermesBlockedAckBody(task, 'W4', 'W3', 4))],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=BLOCKED/);
  assert.match(result.stdout, /next_owner=CODEX/);
  assert.match(result.stdout, /Resolve the named blocker or close the task/);
  assert.doesNotMatch(result.stderr, /ACK loop/);
});

test('accepts the annotated Ip Man Hermes signature', () => {
  const task = 'ANNOTATED-HERMES-SIGNATURE';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', annotatedHermesAckBody(task, 'W2', 'W1', 2))],
  ], ['--allow-pending']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=ACCEPTED/);
});

test('fails closed when Hermes ACKs a receipt instead of progressing', () => {
  const task = 'ACK-LOOP';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish delivery', from: 'codex' }))],
    ['04.json', envelope('m4', 'hermes', body({ type: 'ACK', task, wire: 'W4', seq: 4, inReplyTo: 'W3', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ACK loop/);
});

test('fails closed when Hermes labels progress as ACK/IN_PROGRESS', () => {
  const task = 'INVALID-ACK-STATE';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'IN_PROGRESS', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Implement', from: 'hermes' }))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ACK state invalid/);
});

test('fails closed when Hermes reuses the task WIRE', () => {
  const task = 'WIRE-COLLISION';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'SAME', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'SAME', seq: 2, inReplyTo: 'SAME', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WIRE collision/);
});

test('fails closed when a reply points to an unreadable WIRE', () => {
  const task = 'BAD-CORRELATION';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'MISSING', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unreadable/);
});

test('reports an accepted task as pending instead of silently complete', () => {
  const task = 'PENDING-OWNER';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
  ]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /PENDING/);
});

test('reports a task with no logical Hermes reply as unconfirmed even with allow-pending', () => {
  const task = 'UNCONFIRMED-TASK';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Return ACK or NACK', from: 'codex' }))],
  ], ['--allow-pending']);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /UNCONFIRMED/);
  assert.doesNotMatch(result.stdout, /OK/);
});
