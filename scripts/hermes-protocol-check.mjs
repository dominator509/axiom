#!/usr/bin/env node

import fs from 'node:fs';

const args = process.argv.slice(2);
const readFromStdin = args[0] === '--stdin';
const file = readFromStdin ? null : args[0];
const expectedRole = readFromStdin ? args[1] : args[1];

function fail(message) {
  console.error(`hermes-protocol: FAIL: ${message}`);
  process.exitCode = 1;
}

if (!readFromStdin && !file) {
  fail('usage: hermes-protocol-check.mjs [--stdin | <message.json-or-body>] [Codex|Hermes]');
} else {
  let raw;
  try {
    raw = readFromStdin ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(`cannot read input: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (raw !== undefined) {
    let body = raw;
    try {
      const envelope = JSON.parse(raw);
      if (typeof envelope.body === 'string') body = envelope.body;
    } catch {
      // A plain protocol body is also accepted.
    }

    const lines = body.replaceAll('\r\n', '\n').split('\n');
    while (lines.at(-1) === '') lines.pop();
    const validRoles = new Set(['Codex', 'Hermes']);
    if (!validRoles.has(expectedRole ?? '')) fail('expected signer must be Codex or Hermes');
    let signatureIndex = lines.length - 1;
    const legacyHermesSuffix = expectedRole === 'Hermes' && lines.at(-1) === 'sincerely, hermes';
    if (legacyHermesSuffix) {
      signatureIndex -= 1;
      while (signatureIndex >= 0 && lines[signatureIndex] === '') signatureIndex -= 1;
    }
    const canonicalSignature = expectedRole === 'Hermes'
      ? /^(?:sincerely, Hermes(?: \(role: bridge-responder\))?|sincerely, Ip Man(?: \(role: bridge-responder\))?)$/
      : /^sincerely, Codex$/;
    if (!canonicalSignature.test(lines[signatureIndex] ?? '')) fail('signature is missing, not final, or signed by the wrong role');
    const trailing = lines.slice(signatureIndex + 1);
    if (expectedRole === 'Hermes') {
      const nonBlankTrailing = trailing.filter((line) => line !== '');
      if (nonBlankTrailing.length !== 1 || nonBlankTrailing[0] !== 'sincerely, hermes') {
        fail('unexpected content follows the Hermes role signature');
      }
    } else if (trailing.length !== 0) {
      fail('unexpected content follows the role signature');
    }
    if (lines[0] !== 'FT-HERMES/1') fail('missing FT-HERMES/1 header');
    if (lines.length < 14) fail('message block is incomplete');

    const payloadIndex = lines.indexOf('PAYLOAD:');
    const typeLine = lines.find((line) => line.startsWith('TYPE: '));
    const legacyAck = expectedRole === 'Hermes' && typeLine === 'TYPE: ACK' && payloadIndex < 0;
    if (!legacyAck && (payloadIndex < 0 || payloadIndex === signatureIndex - 1)) fail('missing payload delimiter or signature');
    if (!legacyAck && payloadIndex >= signatureIndex - 1) fail('payload must precede the role signature');

    const headers = new Map();
    const headerEnd = legacyAck ? signatureIndex : payloadIndex;
    for (const line of lines.slice(1, headerEnd)) {
      const match = /^(?<key>[A-Z0-9_]+): (?<value>.*)$/.exec(line);
      if (!match) {
        if (legacyAck) continue;
        fail(`invalid header line: ${line}`);
        continue;
      }
      if (headers.has(match.groups.key)) fail(`duplicate header: ${match.groups.key}`);
      headers.set(match.groups.key, match.groups.value);
    }

    const required = [
      'TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL',
      'NEXT_OWNER', 'NEXT_ACTION', 'REASON', 'PAYLOAD_SHA256',
    ];
    if (legacyAck) {
      for (const key of ['TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL', 'NEXT_OWNER', 'DELIVERY_ACCEPTED', 'LIVE_ACTIONS']) {
        if (!headers.has(key)) fail(`legacy ACK missing header: ${key}`);
      }
      if (headers.get('DELIVERY_ACCEPTED') !== 'NO') fail('legacy ACK cannot claim delivery');
      if (headers.get('LIVE_ACTIONS') !== 'NONE') fail('legacy ACK must declare LIVE_ACTIONS: NONE');
    } else {
      for (const key of required) if (!headers.has(key)) fail(`missing header: ${key}`);
    }

    const taskPattern = /^[A-Za-z0-9._-]+$/;
    for (const key of ['TASK', 'WIRE']) {
      const value = headers.get(key);
      if (value && !taskPattern.test(value)) fail(`${key} is not a stable logical identifier`);
    }

    const seq = Number(headers.get('SEQ'));
    if (!Number.isSafeInteger(seq) || seq < 1) fail('SEQ must be a positive integer');
    const types = new Set(['TASK', 'ACK', 'NACK', 'RECEIPT', 'PROGRESS', 'DELIVERY']);
    const states = new Set(['OPEN', 'READ', 'ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'REJECTED', 'BLOCKED']);
    const owners = new Set(['CODEX', 'HERMES', 'NONE']);
    const rawState = headers.get('STATE');
    const legacyBlocked = legacyAck && headers.get('STATUS')?.startsWith('BLOCKED');
    const normalizedType = legacyBlocked ? 'NACK' : headers.get('TYPE');
    const normalizedState = legacyBlocked
      ? 'BLOCKED'
      : legacyAck && rawState === 'ACKNOWLEDGED'
        ? (headers.get('SCOPE_ACCEPTED')?.startsWith('YES') ? 'ACCEPTED' : 'READ')
        : rawState;
    if (!types.has(normalizedType)) fail(`invalid TYPE: ${headers.get('TYPE')}`);
    if (!states.has(normalizedState)) fail(`invalid STATE: ${rawState}`);
    if (!owners.has(headers.get('NEXT_OWNER'))) fail(`invalid NEXT_OWNER: ${headers.get('NEXT_OWNER')}`);
    if (!['YES', 'NO'].includes(headers.get('TERMINAL'))) fail('TERMINAL must be YES or NO');

    const terminal = new Set(['DELIVERED', 'REJECTED', 'BLOCKED']).has(normalizedState);
    if (!legacyBlocked && (headers.get('TERMINAL') === 'YES') !== terminal) fail('TERMINAL does not match STATE');
    if (legacyBlocked && headers.get('NEXT_OWNER') !== 'CODEX') fail('legacy blocked ACK must return ownership to CODEX');
    if (normalizedType === 'TASK' && normalizedState !== 'OPEN') fail('TASK must begin in OPEN state');
    if (normalizedType === 'ACK' && !['READ', 'ACCEPTED'].includes(normalizedState)) fail('ACK must be READ or ACCEPTED');
    if (normalizedType === 'NACK' && !['REJECTED', 'BLOCKED'].includes(normalizedState)) fail('NACK must be REJECTED or BLOCKED');
    if (normalizedType === 'PROGRESS' && normalizedState !== 'IN_PROGRESS') fail('PROGRESS must be IN_PROGRESS');
    if (normalizedType === 'DELIVERY' && normalizedState !== 'DELIVERED') fail('DELIVERY must be DELIVERED');

    const digest = legacyAck ? 'NONE' : headers.get('PAYLOAD_SHA256');
    if (digest !== 'NONE' && !/^[a-f0-9]{64}$/.test(digest ?? '')) fail('PAYLOAD_SHA256 must be NONE or lowercase SHA-256');
    for (const line of lines.slice(1, headerEnd)) {
      if (/^(DATE|TIME|TIMESTAMP|SENT_AT|CREATED_AT|UPDATED_AT|DEADLINE|TTL):/.test(line)) {
        fail('wall-clock or deadline header is forbidden');
      }
    }

    if (headers.get('TYPE') === 'DELIVERY') {
      const payload = lines.slice(payloadIndex + 1, signatureIndex);
      const payloadKeys = new Map();
      for (const line of payload) {
        const match = /^(?<key>[A-Z0-9_]+): (?<value>.*)$/.exec(line);
        if (match) payloadKeys.set(match.groups.key, match.groups.value);
      }
      for (const key of ['ARTIFACT', 'SHA256', 'COMMAND', 'EXIT_CODE', 'TEST_RESULT', 'LIVE_ACTIONS']) {
        if (!payloadKeys.has(key)) fail(`DELIVERY payload missing ${key}`);
      }
      if (payloadKeys.get('SHA256') && !/^[a-f0-9]{64}$/.test(payloadKeys.get('SHA256'))) fail('DELIVERY SHA256 is invalid');
      if (payloadKeys.get('EXIT_CODE') && !/^-?\d+$/.test(payloadKeys.get('EXIT_CODE'))) fail('DELIVERY EXIT_CODE is not an integer');
      if (payloadKeys.get('TEST_RESULT') && !['PASS', 'FAIL'].includes(payloadKeys.get('TEST_RESULT'))) fail('DELIVERY TEST_RESULT is invalid');
      if (payloadKeys.get('LIVE_ACTIONS') !== 'NONE') fail('source delivery must declare LIVE_ACTIONS: NONE');
    }

    if ((process.exitCode ?? 0) === 0) {
      const compatibility = legacyBlocked
        ? ' (legacy STATUS: BLOCKED normalized to NACK)'
        : legacyAck
          ? ' (legacy ACKNOWLEDGED normalized)'
          : '';
      console.log(`hermes-protocol: OK: ${normalizedType}/${normalizedState}${compatibility} task=${headers.get('TASK')} seq=${seq}`);
    }
  }
}
