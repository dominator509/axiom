import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/hermes-protocol-audit.mjs');
const sentinel = '1970-01-01T00:00:00Z';

function body({ type, task, wire, seq, inReplyTo, state, terminal, nextOwner, nextAction, reason = 'NONE', from, contract = null, payload = [] }) {
  const signature = from === 'codex' ? 'sincerely, Codex' : 'sincerely, Hermes';
  const headers = [
    'FT-HERMES/1',
    ...(contract ? [`CONTRACT: ${contract}`] : []),
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
    ...payload,
    'LIVE_ACTIONS: NONE',
    signature,
  ];
  return headers.join('\n');
}

function envelope(id, from, messageBody) {
  return { msg_id: id, from, sent_at: sentinel, subject: id, body: messageBody };
}

function deployedHermesReplyEnvelope(id, subject, messageBody) {
  return {
    msg_id: id,
    from: 'hermes',
    replied_at: 'transport-ignored',
    in_reply_to_subject: subject,
    body: messageBody,
  };
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

function deployedHermesClosedAckBody(task, wire, inReplyTo, seq) {
  return [
    'FT-HERMES/1',
    'TYPE: ACK',
    `TASK: ${task}`,
    `WIRE: ${wire}`,
    `SEQ: ${seq}`,
    `IN_REPLY_TO: ${inReplyTo}`,
    'STATE: CLOSED',
    'TERMINAL: YES',
    'NEXT_OWNER: NONE',
    'NEXT_ACTION: None; lane is closed',
    'REASON: SEQUENCE_REUSE',
    'PAYLOAD_SHA256: NONE',
    'PAYLOAD:',
    'RECEIPT_READ: YES. DELIVERY_ACCEPTED: NO, LIVE_ACTIONS: NONE.',
    'sincerely, Ip Man (role: bridge-responder)',
    '',
    'sincerely, hermes',
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

test('accepts the deployed Hermes reply envelope and payload-bearing legacy ACK', () => {
  const task = 'DEPLOYED-REPLY-ENVELOPE';
  const reply = [
    'FT-HERMES/1',
    'TYPE: ACK',
    `TASK: ${task}`,
    'WIRE: W2',
    'SEQ: 2',
    'IN_REPLY_TO: W1',
    'STATE: ACKNOWLEDGED',
    'TERMINAL: NO',
    'NEXT_OWNER: HERMES',
    'NEXT_ACTION: Publish progress',
    'REASON: NONE',
    'PAYLOAD_SHA256: NONE',
    'PAYLOAD:',
    'RECEIPT_READ: YES. DELIVERY_ACCEPTED: NO, LIVE_ACTIONS: NONE.',
    'SCOPE_ACK: bounded source-only responsibility',
    'sincerely, Ip Man (role: bridge-responder)',
    '',
    'sincerely, hermes',
  ].join('\n');
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', deployedHermesReplyEnvelope('m2', task, reply)],
  ], ['--allow-pending']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=ACCEPTED/);
});

test('normalizes a deployed terminal CLOSED ACK into a terminal NOT-ACK', () => {
  const task = 'DEPLOYED-CLOSED-REPLY';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'IN_PROGRESS', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish delivery', from: 'codex' }))],
    ['04.json', deployedHermesReplyEnvelope('m4', task, deployedHermesClosedAckBody(task, 'W4', 'W3', 4))],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=REJECTED/);
  assert.match(result.stdout, /next_owner=NONE/);
  assert.doesNotMatch(result.stderr, /ACK loop/);
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

test('fails closed when Hermes sends ACKNOWLEDGED without the required legacy ACK contract', () => {
  const task = 'INVALID-ACKNOWLEDGED-STATE';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACKNOWLEDGED', terminal: 'YES', nextOwner: 'CODEX', nextAction: 'None', from: 'hermes' }))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /legacy ACK missing header DELIVERY_ACCEPTED/);
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

test('rejects progress that hands Hermes-owned implementation back to Codex', () => {
  const task = 'OWNER-HANDOFF-CONTRADICTION';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish delivery', from: 'codex' }))],
    ['04.json', envelope('m4', 'hermes', body({ type: 'PROGRESS', task, wire: 'W4', seq: 4, inReplyTo: 'W3', state: 'IN_PROGRESS', terminal: 'NO', nextOwner: 'CODEX', nextAction: 'Await delivery', from: 'hermes' }).replace('sincerely, Hermes', 'PROGRESS_EVIDENCE: copied source paths audited; no artifact delivered\nsincerely, Hermes'))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PROGRESS\/IN_PROGRESS must set NEXT_OWNER: HERMES/);
});

test('rejects progress without a concrete evidence delta', () => {
  const task = 'NO-PROGRESS-EVIDENCE';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read task', from: 'codex' }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish progress', from: 'hermes' }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'IN_PROGRESS', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish delivery', from: 'codex' }))],
    ['04.json', envelope('m4', 'hermes', body({ type: 'PROGRESS', task, wire: 'W4', seq: 4, inReplyTo: 'W3', state: 'IN_PROGRESS', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Continue implementation', from: 'hermes' }))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PROGRESS requires a concrete PROGRESS_EVIDENCE delta/);
});

test('strict ACK-NACK contract makes read state, ownership, and signatures unambiguous', () => {
  const task = 'STRICT-CONTRACT-ACCEPT';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ'] }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'READ', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'codex', contract, payload: ['READ_STATUS: READ', 'RECEIPT_OF: W2'] }))],
  ], ['--allow-pending']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=READ/);
});

test('strict ACK-NACK contract represents a NOT-ACK as terminal NACK/BLOCKED', () => {
  const task = 'STRICT-CONTRACT-BLOCKED';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'NACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'BLOCKED', terminal: 'YES', nextOwner: 'CODEX', nextAction: 'Provide the named missing input or close the lane', reason: 'MISSING_WRITABLE_SOURCE', from: 'hermes', contract, payload: ['READ_STATUS: READ'] }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'READ', terminal: 'YES', nextOwner: 'NONE', nextAction: 'NONE', from: 'codex', contract, payload: ['READ_STATUS: READ', 'RECEIPT_OF: W2'] }))],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=READ/);
  assert.match(result.stdout, /next_owner=NONE/);
});

test('strict ACK-NACK contract rejects legacy ACKNOWLEDGED replies', () => {
  const task = 'STRICT-CONTRACT-LEGACY';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract: 'ACK-NACK-1', payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', legacyHermesAckBody(task, 'W2', 'W1', 2))],
  ], ['--allow-pending']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without CONTRACT: ACK-NACK-1|legacy bridge envelope/);
});

test('strict ACK-NACK contract rejects a Hermes reply signed as another identity', () => {
  const task = 'STRICT-CONTRACT-SIGNATURE';
  const reply = body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract: 'ACK-NACK-1', payload: ['READ_STATUS: READ'] }).replace('sincerely, Hermes', 'sincerely, Ip Man');
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract: 'ACK-NACK-1', payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', reply)],
  ], ['--allow-pending']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires the Hermes role signature/);
});

test('strict ACK-NACK contract rejects duplicate payload fields', () => {
  const task = 'STRICT-CONTRACT-DUPLICATE-PAYLOAD';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ', 'READ_STATUS: READ'] }))],
  ], ['--allow-pending']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate payload field READ_STATUS/);
});

test('strict ACK-NACK contract rejects a receipt that does not name what was read', () => {
  const task = 'STRICT-CONTRACT-RECEIPT';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ'] }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'READ', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'codex', contract, payload: ['READ_STATUS: READ', 'RECEIPT_OF: W1'] }))],
  ], ['--allow-pending']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RECEIPT must name the exact WIRE/);
});

test('strict ACK-NACK contract lets Codex reject a reply and return ownership for correction', () => {
  const task = 'STRICT-CONTRACT-RECEIPT-REJECTED';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ'] }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'REJECTED', terminal: 'YES', nextOwner: 'HERMES', nextAction: 'Correct the reply with TYPE: PROGRESS and a new WIRE', reason: 'INVALID_TYPE', from: 'codex', contract, payload: ['READ_STATUS: READ', 'RECEIPT_OF: W2'] }))],
  ], ['--allow-pending']);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /PENDING/);
  assert.match(result.stdout, /next_owner=HERMES/);
  assert.match(result.stdout, /Correct the reply/);
});

test('strict ACK-NACK contract rejects contradictory terminal state', () => {
  const task = 'STRICT-CONTRACT-TERMINAL';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'YES', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ'] }))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TERMINAL does not match STATE/);
});

test('strict ACK-NACK contract keeps a terminal delivery pending until Codex reads it', () => {
  const task = 'STRICT-CONTRACT-TERMINAL-READ';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ'] }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'READ', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish delivery', from: 'codex', contract, payload: ['READ_STATUS: READ', 'RECEIPT_OF: W2'] }))],
    ['04.json', envelope('m4', 'hermes', body({ type: 'DELIVERY', task, wire: 'W4', seq: 4, inReplyTo: 'W3', state: 'DELIVERED', terminal: 'YES', nextOwner: 'CODEX', nextAction: 'Read delivery and send terminal receipt', from: 'hermes', contract, payload: ['READ_STATUS: READ', 'ARTIFACT: reply-tree/artifact.txt', 'SHA256: 0000000000000000000000000000000000000000000000000000000000000000', 'COMMAND: node --test focused.test.mjs', 'EXIT_CODE: 0', 'TEST_RESULT: PASS'] }))],
  ], ['--allow-pending']);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /PENDING/);
  assert.match(result.stdout, /Send terminal READ receipt for W4/);
});

test('strict ACK-NACK contract closes only after a terminal READ receipt', () => {
  const task = 'STRICT-CONTRACT-TERMINAL-CLOSE';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ'] }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'READ', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish delivery', from: 'codex', contract, payload: ['READ_STATUS: READ', 'RECEIPT_OF: W2'] }))],
    ['04.json', envelope('m4', 'hermes', body({ type: 'DELIVERY', task, wire: 'W4', seq: 4, inReplyTo: 'W3', state: 'DELIVERED', terminal: 'YES', nextOwner: 'CODEX', nextAction: 'Read delivery and send terminal receipt', from: 'hermes', contract, payload: ['READ_STATUS: READ', 'ARTIFACT: reply-tree/artifact.txt', 'SHA256: 0000000000000000000000000000000000000000000000000000000000000000', 'COMMAND: node --test focused.test.mjs', 'EXIT_CODE: 0', 'TEST_RESULT: PASS'] }))],
    ['05.json', envelope('m5', 'codex', body({ type: 'RECEIPT', task, wire: 'W5', seq: 5, inReplyTo: 'W4', state: 'READ', terminal: 'YES', nextOwner: 'NONE', nextAction: 'NONE', from: 'codex', contract, payload: ['READ_STATUS: READ', 'RECEIPT_OF: W4'] }))],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /state=READ/);
  assert.match(result.stdout, /next_owner=NONE/);
});

test('strict ACK-NACK rejects clock-like fields even when the field name is new', () => {
  const task = 'STRICT-CONTRACT-CLOCK-FIELD';
  const contract = 'ACK-NACK-1';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract, payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ'] }))],
    ['03.json', envelope('m3', 'codex', body({ type: 'RECEIPT', task, wire: 'W3', seq: 3, inReplyTo: 'W2', state: 'READ', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish delivery', from: 'codex', contract, payload: ['READ_STATUS: READ', 'RECEIPT_OF: W2'] }))],
    ['04.json', envelope('m4', 'hermes', body({ type: 'DELIVERY', task, wire: 'W4', seq: 4, inReplyTo: 'W3', state: 'DELIVERED', terminal: 'YES', nextOwner: 'CODEX', nextAction: 'Read delivery', from: 'hermes', contract, payload: ['READ_STATUS: READ', 'RECONCILED_AT: forbidden', 'ARTIFACT: reply-tree/artifact.txt', 'SHA256: 0000000000000000000000000000000000000000000000000000000000000000', 'COMMAND: node --test focused.test.mjs', 'EXIT_CODE: 0', 'TEST_RESULT: PASS'] }))],
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /clock\/date field is forbidden: RECONCILED_AT/);
});

test('JSON audit output exposes the next owner and action without a clock', () => {
  const task = 'STRICT-CONTRACT-JSON-NEXT';
  const result = run([
    ['01.json', envelope('m1', 'codex', body({ type: 'TASK', task, wire: 'W1', seq: 1, inReplyTo: 'NONE', state: 'OPEN', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Read and return ACK or NACK', from: 'codex', contract: 'ACK-NACK-1', payload: ['READ_STATUS: NOT_APPLICABLE'] }))],
    ['02.json', envelope('m2', 'hermes', body({ type: 'ACK', task, wire: 'W2', seq: 2, inReplyTo: 'W1', state: 'ACCEPTED', terminal: 'NO', nextOwner: 'HERMES', nextAction: 'Publish concrete progress or delivery', from: 'hermes', contract: 'ACK-NACK-1', payload: ['READ_STATUS: READ'] }))],
  ], ['--json']);
  assert.equal(result.status, 2, result.stderr);
  const summary = JSON.parse(result.stdout.trim());
  assert.deepEqual(summary, {
    status: 'PENDING',
    task,
    messages: 2,
    state: 'ACCEPTED',
    next_owner: 'HERMES',
    next_action: 'Publish concrete progress or delivery',
  });
});
