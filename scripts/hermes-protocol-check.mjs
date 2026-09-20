#!/usr/bin/env node

import fs from 'node:fs';

const args = process.argv.slice(2);
const readFromStdin = args[0] === '--stdin';
const file = readFromStdin ? null : args[0];
const expectedRole = readFromStdin ? args[1] : args[1];
const messageIdPattern = /^[A-Za-z0-9._-]{1,128}$/;
const forbiddenClockField = (key) => /(?:DATE|TIME|TIMESTAMP|DEADLINE|TTL|EPOCH|CLOCK|EXPIRES?|_AT$)/i.test(key);

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
      if (typeof envelope.msg_id === 'string' && !messageIdPattern.test(envelope.msg_id)) {
        fail('envelope msg_id must contain 1-128 ASCII identifier characters');
      }
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
    const rawStateLine = lines.find((line) => line.startsWith('STATE: '));
    const rawStateLineValue = rawStateLine?.slice('STATE: '.length);
    // The deployed bridge's legacy ACK format may contain a human-readable
    // PAYLOAD section. Its state is the discriminator; modern ACKs use only
    // READ/ACCEPTED and never ACKNOWLEDGED/CLOSED.
    const legacyAck = expectedRole === 'Hermes'
      && typeLine === 'TYPE: ACK'
      && (payloadIndex < 0 || ['ACKNOWLEDGED', 'CLOSED'].includes(rawStateLineValue));
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
      if (forbiddenClockField(match.groups.key)) fail(`clock/date field is forbidden: ${match.groups.key}`);
      if (headers.has(match.groups.key)) fail(`duplicate header: ${match.groups.key}`);
      headers.set(match.groups.key, match.groups.value);
    }

    const legacyPayloadText = legacyAck && payloadIndex >= 0
      ? lines.slice(payloadIndex + 1, signatureIndex).join('\n')
      : '';
    const legacyField = (key) => {
      const headerValue = headers.get(key);
      if (headerValue !== undefined) return headerValue;
      const match = new RegExp(`${key}:\\s*([^\\n]*)`).exec(legacyPayloadText);
      return match?.[1]?.trim();
    };

    const required = [
      'TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL',
      'NEXT_OWNER', 'NEXT_ACTION', 'REASON', 'PAYLOAD_SHA256',
    ];
    if (legacyAck) {
      for (const key of ['TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL', 'NEXT_OWNER', 'DELIVERY_ACCEPTED', 'LIVE_ACTIONS']) {
        const value = ['DELIVERY_ACCEPTED', 'LIVE_ACTIONS'].includes(key) ? legacyField(key) : headers.get(key);
        if (value === undefined) fail(`legacy ACK missing header: ${key}`);
      }
      if (!legacyField('DELIVERY_ACCEPTED')?.startsWith('NO')) fail('legacy ACK cannot claim delivery');
      if (!legacyField('LIVE_ACTIONS')?.startsWith('NONE')) fail('legacy ACK must declare LIVE_ACTIONS: NONE');
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
    const legacyBlocked = legacyAck && legacyField('STATUS')?.startsWith('BLOCKED');
    const legacyClosed = legacyAck && rawState === 'CLOSED';
    const normalizedType = legacyBlocked || legacyClosed ? 'NACK' : headers.get('TYPE');
    const normalizedState = legacyBlocked
      ? 'BLOCKED'
      : legacyClosed
        ? 'REJECTED'
      : legacyAck && rawState === 'ACKNOWLEDGED'
        ? (legacyField('SCOPE_ACCEPTED')?.startsWith('YES') || legacyField('SCOPE_ACK') ? 'ACCEPTED' : 'READ')
        : rawState;
    if (!types.has(normalizedType)) fail(`invalid TYPE: ${headers.get('TYPE')}`);
    if (!states.has(normalizedState)) fail(`invalid STATE: ${rawState}`);
    if (!owners.has(headers.get('NEXT_OWNER'))) fail(`invalid NEXT_OWNER: ${headers.get('NEXT_OWNER')}`);
    if (!['YES', 'NO'].includes(headers.get('TERMINAL'))) fail('TERMINAL must be YES or NO');

    const terminalState = new Set(['DELIVERED', 'REJECTED', 'BLOCKED']).has(normalizedState);
    const terminalReceipt = normalizedType === 'RECEIPT'
      && normalizedState === 'READ'
      && headers.get('TERMINAL') === 'YES'
      && headers.get('NEXT_OWNER') === 'NONE';
    const terminal = terminalState || terminalReceipt;
    if (!legacyBlocked && (headers.get('TERMINAL') === 'YES') !== terminal) fail('TERMINAL does not match STATE');
    if (legacyBlocked && headers.get('NEXT_OWNER') !== 'CODEX') fail('legacy blocked ACK must return ownership to CODEX');
    if (legacyClosed) {
      if (headers.get('TERMINAL') !== 'YES') fail('legacy CLOSED ACK must be terminal');
      if (!['CODEX', 'NONE'].includes(headers.get('NEXT_OWNER'))) fail('legacy CLOSED ACK has invalid NEXT_OWNER');
      if (!headers.get('REASON') || headers.get('REASON') === 'NONE') fail('legacy CLOSED ACK must name REASON');
    }
    if (normalizedType === 'TASK' && (normalizedState !== 'OPEN' || seq !== 1 || headers.get('IN_REPLY_TO') !== 'NONE')) {
      fail('TASK must be SEQ 1 / OPEN / IN_REPLY_TO NONE');
    }
    if (normalizedType === 'ACK' && !['READ', 'ACCEPTED'].includes(normalizedState)) fail('ACK must be READ or ACCEPTED');
    if (normalizedType === 'NACK' && !['REJECTED', 'BLOCKED'].includes(normalizedState)) fail('NACK must be REJECTED or BLOCKED');
    if (normalizedType === 'PROGRESS' && normalizedState !== 'IN_PROGRESS') fail('PROGRESS must be IN_PROGRESS');
    if (normalizedType === 'DELIVERY' && normalizedState !== 'DELIVERED') fail('DELIVERY must be DELIVERED');

    const contract = headers.get('CONTRACT');
    const payloadFields = new Map();
    if (!legacyAck) {
      for (const line of lines.slice(payloadIndex + 1, signatureIndex)) {
        const match = /^(?<key>[A-Z0-9_]+): (?<value>.*)$/.exec(line);
        if (match) {
          if (forbiddenClockField(match.groups.key)) fail(`clock/date field is forbidden: ${match.groups.key}`);
          if (payloadFields.has(match.groups.key)) fail(`duplicate payload field: ${match.groups.key}`);
          payloadFields.set(match.groups.key, match.groups.value);
        }
      }
    }
    if (contract === 'ACK-NACK-1') {
      if (legacyAck) fail('ACK-NACK-1 rejects legacy ACK envelopes');
      if (normalizedType !== 'TASK' && headers.get('WIRE') === headers.get('IN_REPLY_TO')) {
        fail('ACK-NACK-1 reply WIRE must be new and distinct from IN_REPLY_TO');
      }
      const canonicalHermesSignatures = lines.filter((line) => line === 'sincerely, Hermes' || line === 'sincerely, Hermes (role: bridge-responder)');
      const canonicalCodexSignatures = lines.filter((line) => line === 'sincerely, Codex');
      if (expectedRole === 'Hermes' && (legacyHermesSuffix || canonicalHermesSignatures.length !== 1)) {
        fail('ACK-NACK-1 Hermes messages require exactly one canonical final signature');
      }
      if (expectedRole === 'Codex' && canonicalCodexSignatures.length !== 1) {
        fail('ACK-NACK-1 Codex messages require exactly one canonical final signature');
      }
      if (normalizedType === 'RECEIPT' && !['READ', 'REJECTED'].includes(normalizedState)) fail('ACK-NACK-1 RECEIPT must use READ or REJECTED state');
      if (expectedRole === 'Hermes' && !['sincerely, Hermes', 'sincerely, Hermes (role: bridge-responder)'].includes(lines[signatureIndex])) {
        fail('ACK-NACK-1 requires the Hermes role signature');
      }
      if (normalizedType !== 'TASK' && payloadFields.get('READ_STATUS') !== 'READ') {
        fail('ACK-NACK-1 requires READ_STATUS: READ on every reply or receipt');
      }
      if (normalizedType === 'TASK' && payloadFields.get('READ_STATUS') !== 'NOT_APPLICABLE') {
        fail('ACK-NACK-1 TASK requires READ_STATUS: NOT_APPLICABLE');
      }
      if (normalizedType === 'RECEIPT' && payloadFields.get('RECEIPT_OF') !== headers.get('IN_REPLY_TO')) {
        fail('ACK-NACK-1 RECEIPT must name the exact WIRE it read');
      }
      if (normalizedType === 'ACK') {
        const expectedOwner = normalizedState === 'READ' ? 'CODEX' : 'HERMES';
        if (headers.get('NEXT_OWNER') !== expectedOwner) fail(`ACK-NACK-1 ACK/${normalizedState} has the wrong NEXT_OWNER`);
      }
      if (normalizedType === 'NACK' && headers.get('NEXT_OWNER') !== 'CODEX') {
        fail('ACK-NACK-1 NACK must return ownership to CODEX');
      }
      if (normalizedType === 'RECEIPT' && normalizedState === 'REJECTED' && headers.get('REASON') === 'NONE') {
        fail('ACK-NACK-1 rejected RECEIPT must name REASON');
      }
    }
    if (normalizedType === 'PROGRESS' && !legacyAck) {
      const progressEvidence = lines
        .slice(payloadIndex + 1, signatureIndex)
        .find((line) => line.startsWith('PROGRESS_EVIDENCE: '))
        ?.slice('PROGRESS_EVIDENCE: '.length)
        .trim();
      if (!progressEvidence || /^(?:NONE|NOT_READY|NO_CHANGE)$/i.test(progressEvidence)) {
        fail(`${file ?? 'message'}: PROGRESS requires a concrete PROGRESS_EVIDENCE delta`);
      }
    }

    // NEXT_OWNER is the machine-readable handoff. Do not allow a message to
    // say that Hermes is still implementing while handing the next action to
    // Codex (or vice versa); that contradiction creates silent stalls.
    if (!legacyAck) {
      const expectedNextOwner = normalizedType === 'TASK'
        ? 'HERMES'
        : normalizedType === 'ACK'
          ? (normalizedState === 'READ' ? 'CODEX' : 'HERMES')
          : normalizedType === 'NACK'
            ? 'CODEX'
            : normalizedType === 'PROGRESS'
              ? 'HERMES'
              : normalizedType === 'DELIVERY'
                ? 'CODEX'
                : normalizedType === 'RECEIPT' && terminalReceipt
                  ? 'NONE'
                  : 'HERMES';
      if (headers.get('NEXT_OWNER') !== expectedNextOwner) {
        fail(`${file ?? 'message'}: ${normalizedType}/${normalizedState} must set NEXT_OWNER: ${expectedNextOwner}`);
      }
    }

    const digest = legacyAck ? 'NONE' : headers.get('PAYLOAD_SHA256');
    if (digest !== 'NONE' && !/^[a-f0-9]{64}$/.test(digest ?? '')) fail('PAYLOAD_SHA256 must be NONE or lowercase SHA-256');
    if (!legacyAck && !headers.get('NEXT_ACTION')?.trim()) fail('NEXT_ACTION must not be empty');
    if (!legacyAck && !terminal && /^NONE$/i.test(headers.get('NEXT_ACTION') ?? '')) fail('nonterminal message must name NEXT_ACTION');
    for (const line of lines.slice(1, signatureIndex)) {
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
        : legacyClosed
          ? ' (legacy CLOSED normalized to terminal NACK)'
        : legacyAck
          ? ' (legacy ACKNOWLEDGED normalized)'
          : '';
      console.log(`hermes-protocol: OK: ${normalizedType}/${normalizedState}${compatibility} task=${headers.get('TASK')} seq=${seq}`);
    }
  }
}
