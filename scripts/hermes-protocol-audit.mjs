#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const allowPending = args.includes('--allow-pending');
const positional = args.filter((arg) => arg !== '--allow-pending');
const input = positional[0];
const taskFilter = positional[1] ?? null;

function fail(message) {
  throw new Error(message);
}

function usage() {
  console.error('usage: hermes-protocol-audit.mjs <message.json|directory> [TASK] [--allow-pending]');
  process.exitCode = 2;
}

function readPaths(target) {
  if (!target) {
    usage();
    return [];
  }
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return fs.readdirSync(target)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(target, name));
  }
  return [target];
}

function parseEnvelope(file) {
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail(`${file}: envelope must be an object`);
  }
  const required = new Set(['msg_id', 'from', 'sent_at', 'subject', 'body']);
  const keys = Object.keys(envelope);
  const isHermes = envelope.from === 'hermes';
  const allowedLegacyHermes = new Set(['replied_at', 'in_reply_to_subject']);
  for (const key of keys) {
    if (!required.has(key) && !(isHermes && allowedLegacyHermes.has(key))) {
      fail(`${file}: unexpected envelope field ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in envelope)) fail(`${file}: missing envelope field ${key}`);
    if (typeof envelope[key] !== 'string') fail(`${file}: envelope field ${key} must be a string`);
  }
  if (!['codex', 'hermes'].includes(envelope.from)) fail(`${file}: envelope from must be codex or hermes`);
  if (envelope.from === 'codex' && keys.length !== required.size) {
    fail(`${file}: Codex envelope must contain exactly five fields`);
  }
  // sent_at is a legacy transport field. It is deliberately not parsed or compared.
  return { ...envelope, file };
}

function parseBody(envelope) {
  const lines = envelope.body.replaceAll('\r\n', '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  if (lines[0] !== 'FT-HERMES/1') fail(`${envelope.file}: missing FT-HERMES/1 header`);

  let signatureIndex = lines.length - 1;
  const legacyHermesSuffix = envelope.from === 'hermes' && lines.at(-1) === 'sincerely, hermes';
  if (legacyHermesSuffix) {
    signatureIndex -= 1;
    while (signatureIndex >= 0 && lines[signatureIndex] === '') signatureIndex -= 1;
  }
  const signature = lines[signatureIndex];
  const expected = envelope.from === 'codex'
    ? 'sincerely, Codex'
    : /^(?:sincerely, Hermes(?: \(role: bridge-responder\))?|sincerely, Ip Man)$/;
  if (envelope.from === 'codex' ? signature !== expected : !expected.test(signature ?? '')) {
    fail(`${envelope.file}: canonical signature missing or wrong`);
  }
  if (envelope.from === 'codex' && signatureIndex !== lines.length - 1) {
    fail(`${envelope.file}: content follows the Codex signature`);
  }
  if (envelope.from === 'hermes' && legacyHermesSuffix) {
    const nonBlankTrailing = lines.slice(signatureIndex + 1).filter((line) => line !== '');
    if (nonBlankTrailing.length !== 1 || nonBlankTrailing[0] !== 'sincerely, hermes') {
      fail(`${envelope.file}: unexpected content follows the Hermes signature`);
    }
  }

  const payloadIndex = lines.indexOf('PAYLOAD:');
  const typeLine = lines.find((line) => line.startsWith('TYPE: '));
  const legacyAck = envelope.from === 'hermes' && typeLine === 'TYPE: ACK' && payloadIndex < 0;
  if (!legacyAck && (payloadIndex < 0 || payloadIndex >= signatureIndex)) fail(`${envelope.file}: missing payload delimiter`);
  const headers = new Map();
  const headerEnd = legacyAck ? signatureIndex : payloadIndex;
  for (const line of lines.slice(1, headerEnd)) {
    const match = /^(?<key>[A-Z0-9_]+): (?<value>.*)$/.exec(line);
    if (!match) {
      if (legacyAck) continue;
      fail(`${envelope.file}: invalid header ${line}`);
    }
    if (headers.has(match.groups.key)) fail(`${envelope.file}: duplicate header ${match.groups.key}`);
    headers.set(match.groups.key, match.groups.value);
  }
  const requiredHeaders = [
    'TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL',
    'NEXT_OWNER', 'NEXT_ACTION', 'REASON', 'PAYLOAD_SHA256',
  ];
  if (legacyAck) {
    for (const key of ['TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL', 'NEXT_OWNER', 'DELIVERY_ACCEPTED', 'LIVE_ACTIONS']) {
      if (!headers.has(key)) fail(`${envelope.file}: legacy ACK missing header ${key}`);
    }
    if (headers.get('DELIVERY_ACCEPTED') !== 'NO') fail(`${envelope.file}: legacy ACK cannot claim delivery`);
    if (headers.get('LIVE_ACTIONS') !== 'NONE') fail(`${envelope.file}: legacy ACK must declare LIVE_ACTIONS NONE`);
  } else {
    for (const key of requiredHeaders) if (!headers.has(key)) fail(`${envelope.file}: missing header ${key}`);
  }

  const identifier = /^[A-Za-z0-9._-]+$/;
  for (const key of ['TASK', 'WIRE']) {
    if (!identifier.test(headers.get(key))) fail(`${envelope.file}: invalid ${key}`);
  }
  const seq = Number(headers.get('SEQ'));
  if (!Number.isSafeInteger(seq) || seq < 1) fail(`${envelope.file}: SEQ must be a positive integer`);
  const types = new Set(['TASK', 'ACK', 'NACK', 'RECEIPT', 'PROGRESS', 'DELIVERY']);
  const states = new Set(['OPEN', 'READ', 'ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'REJECTED', 'BLOCKED']);
  const owners = new Set(['CODEX', 'HERMES', 'NONE']);
  const rawState = headers.get('STATE');
  const normalizedState = legacyAck && rawState === 'ACKNOWLEDGED'
    ? (headers.get('SCOPE_ACCEPTED')?.startsWith('YES') ? 'ACCEPTED' : 'READ')
    : rawState;
  if (!types.has(headers.get('TYPE'))) fail(`${envelope.file}: invalid TYPE`);
  if (!states.has(normalizedState)) fail(`${envelope.file}: invalid STATE`);
  if (!owners.has(headers.get('NEXT_OWNER'))) fail(`${envelope.file}: invalid NEXT_OWNER`);
  if (!['YES', 'NO'].includes(headers.get('TERMINAL'))) fail(`${envelope.file}: invalid TERMINAL`);
  const terminal = new Set(['DELIVERED', 'REJECTED', 'BLOCKED']).has(normalizedState);
  if ((headers.get('TERMINAL') === 'YES') !== terminal) fail(`${envelope.file}: TERMINAL does not match STATE`);
  if (headers.get('TYPE') === 'TASK' && (normalizedState !== 'OPEN' || seq !== 1 || headers.get('IN_REPLY_TO') !== 'NONE')) {
    fail(`${envelope.file}: TASK must be SEQ 1 / OPEN / IN_REPLY_TO NONE`);
  }
  if (headers.get('TYPE') === 'ACK' && !['READ', 'ACCEPTED'].includes(normalizedState)) fail(`${envelope.file}: ACK state invalid`);
  if (headers.get('TYPE') === 'NACK' && !['REJECTED', 'BLOCKED'].includes(normalizedState)) fail(`${envelope.file}: NACK state invalid`);
  if (headers.get('TYPE') === 'PROGRESS' && normalizedState !== 'IN_PROGRESS') fail(`${envelope.file}: PROGRESS must be IN_PROGRESS`);
  if (headers.get('TYPE') === 'DELIVERY' && normalizedState !== 'DELIVERED') fail(`${envelope.file}: DELIVERY must be DELIVERED`);
  if (!legacyAck && !terminal && headers.get('NEXT_ACTION') === 'NONE') fail(`${envelope.file}: nonterminal message must name NEXT_ACTION`);
  if (!legacyAck && headers.get('TYPE') === 'NACK' && headers.get('REASON') === 'NONE') fail(`${envelope.file}: NACK must name REASON`);
  if (!legacyAck && !/^(NONE|[a-f0-9]{64})$/.test(headers.get('PAYLOAD_SHA256'))) fail(`${envelope.file}: invalid PAYLOAD_SHA256`);
  for (const line of lines.slice(1, headerEnd)) {
    if (/^(DATE|TIME|TIMESTAMP|SENT_AT|CREATED_AT|UPDATED_AT|DEADLINE|TTL):/.test(line)) {
      fail(`${envelope.file}: wall-clock/deadline header is forbidden`);
    }
  }

  const roleByType = {
    TASK: 'codex',
    RECEIPT: 'codex',
    ACK: 'hermes',
    NACK: 'hermes',
    PROGRESS: 'hermes',
    DELIVERY: 'hermes',
  };
  if (roleByType[headers.get('TYPE')] !== envelope.from) {
    fail(`${envelope.file}: ${headers.get('TYPE')} cannot be sent by ${envelope.from}`);
  }
  if (headers.get('TYPE') === 'DELIVERY') {
    const payloadKeys = new Map();
    for (const line of lines.slice(payloadIndex + 1, signatureIndex)) {
      const match = /^(?<key>[A-Z0-9_]+): (?<value>.*)$/.exec(line);
      if (match) payloadKeys.set(match.groups.key, match.groups.value);
    }
    for (const key of ['ARTIFACT', 'SHA256', 'COMMAND', 'EXIT_CODE', 'TEST_RESULT', 'LIVE_ACTIONS']) {
      if (!payloadKeys.has(key)) fail(`${envelope.file}: DELIVERY missing ${key}`);
    }
    if (!/^[a-f0-9]{64}$/.test(payloadKeys.get('SHA256'))) fail(`${envelope.file}: DELIVERY SHA256 invalid`);
    if (!/^-?\d+$/.test(payloadKeys.get('EXIT_CODE'))) fail(`${envelope.file}: DELIVERY EXIT_CODE invalid`);
    if (!['PASS', 'FAIL'].includes(payloadKeys.get('TEST_RESULT'))) fail(`${envelope.file}: DELIVERY TEST_RESULT invalid`);
    if (payloadKeys.get('LIVE_ACTIONS') !== 'NONE') fail(`${envelope.file}: source DELIVERY must declare LIVE_ACTIONS NONE`);
  }
  return {
    ...envelope,
    type: headers.get('TYPE'),
    task: headers.get('TASK'),
    wire: headers.get('WIRE'),
    seq,
    inReplyTo: headers.get('IN_REPLY_TO'),
    state: normalizedState,
    terminal,
    nextOwner: headers.get('NEXT_OWNER'),
    nextAction: headers.get('NEXT_ACTION') ?? (legacyAck ? 'Publish PROGRESS or DELIVERY' : undefined),
    reason: headers.get('REASON') ?? (legacyAck ? 'LEGACY_BRIDGE_ACK' : undefined),
  };
}

function auditTask(records) {
  const sorted = [...records].sort((a, b) => a.seq - b.seq || a.file.localeCompare(b.file));
  const seenWires = new Map();
  const seenSeq = new Map();
  for (const record of sorted) {
    if (seenWires.has(record.wire)) fail(`${record.file}: WIRE collision with ${seenWires.get(record.wire)}`);
    seenWires.set(record.wire, record.file);
    if (seenSeq.has(record.seq)) fail(`${record.file}: duplicate SEQ ${record.seq} with ${seenSeq.get(record.seq)}`);
    seenSeq.set(record.seq, record.file);
  }
  if (sorted[0]?.seq !== 1 || sorted[0]?.type !== 'TASK') fail(`${records[0]?.task}: journal must begin with Codex TASK SEQ 1`);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (current.seq !== index + 1) fail(`${current.file}: sequence gap before SEQ ${current.seq}`);
    if (current.inReplyTo !== 'NONE') {
      const referenced = sorted.find((candidate) => candidate.wire === current.inReplyTo);
      if (!referenced) fail(`${current.file}: IN_REPLY_TO ${current.inReplyTo} is unreadable in this journal`);
      if (referenced.seq >= current.seq) fail(`${current.file}: IN_REPLY_TO must reference an earlier sequence`);
    } else if (current.seq !== 1) {
      fail(`${current.file}: only SEQ 1 may use IN_REPLY_TO NONE`);
    }
    if (index > 0 && current.from === sorted[index - 1].from) {
      fail(`${current.file}: sender repeated without a receipt/reply turn`);
    }
    if (index > 0 && current.from === 'hermes' && current.type === 'ACK' && sorted[index - 1].type === 'RECEIPT' && sorted[index - 1].from === 'codex') {
      fail(`${current.file}: Hermes ACK after Codex RECEIPT is an ACK loop; require PROGRESS, DELIVERY, or BLOCKED`);
    }
    if (current.seq === 2) {
      if (!['ACK', 'NACK'].includes(current.type) || current.inReplyTo !== sorted[0].wire) {
        fail(`${current.file}: SEQ 2 must be a correlated ACK or NACK for the TASK`);
      }
    }
  }
  const last = sorted.at(-1);
  const pending = !last.terminal && last.nextOwner !== 'NONE';
  const line = `hermes-protocol-audit: ${pending && !allowPending ? 'PENDING' : 'OK'} task=${last.task} messages=${sorted.length} state=${last.state} next_owner=${last.nextOwner} next_action=${last.nextAction}`;
  console.log(line);
  if (pending && !allowPending) process.exitCode = 2;
}

try {
  const files = readPaths(input);
  if (files.length === 0) fail('no JSON messages found');
  const records = files.map((file) => parseBody(parseEnvelope(file)));
  const byTask = new Map();
  for (const record of records) {
    if (taskFilter && record.task !== taskFilter) continue;
    if (!byTask.has(record.task)) byTask.set(record.task, []);
    byTask.get(record.task).push(record);
  }
  if (byTask.size === 0) fail(`task not found: ${taskFilter}`);
  for (const taskRecords of byTask.values()) auditTask(taskRecords);
} catch (error) {
  console.error(`hermes-protocol-audit: FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
