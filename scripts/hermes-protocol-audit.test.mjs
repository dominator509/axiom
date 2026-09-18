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
