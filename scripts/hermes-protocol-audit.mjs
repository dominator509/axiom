#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const allowPending = args.includes('--allow-pending');
const asJson = args.includes('--json');
const positional = args.filter((arg) => !['--allow-pending', '--json'].includes(arg));
const input = positional[0];
const taskFilter = positional[1] ?? null;

function fail(message) {
  throw new Error(message);
}

const forbiddenClockField = (key) => /(?:DATE|TIME|TIMESTAMP|DEADLINE|TTL|EPOCH|CLOCK|EXPIRES?|_AT$)/i.test(key);

function usage() {
    console.error('usage: hermes-protocol-audit.mjs <message.json|directory> [TASK] [--allow-pending] [--json]');
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
  const deployedHermesReply = isHermes
    && 'replied_at' in envelope
    && 'in_reply_to_subject' in envelope
    && !('sent_at' in envelope || 'subject' in envelope);
  const allowedLegacyHermes = new Set(['replied_at', 'in_reply_to_subject']);
  for (const key of keys) {
    if (!required.has(key) && !(isHermes && allowedLegacyHermes.has(key))) {
      fail(`${file}: unexpected envelope field ${key}`);
    }
  }
  const requiredKeys = deployedHermesReply
    ? ['msg_id', 'from', 'replied_at', 'in_reply_to_subject', 'body']
    : [...required];
  for (const key of requiredKeys) {
    if (!(key in envelope)) fail(`${file}: missing envelope field ${key}`);
    if (typeof envelope[key] !== 'string') fail(`${file}: envelope field ${key} must be a string`);
  }
  if (!['codex', 'hermes'].includes(envelope.from)) fail(`${file}: envelope from must be codex or hermes`);
  if (envelope.from === 'codex' && keys.length !== required.size) {
    fail(`${file}: Codex envelope must contain exactly five fields`);
  }
  if (isHermes && !deployedHermesReply && !('sent_at' in envelope && 'subject' in envelope)) {
    fail(`${file}: Hermes envelope must use either the canonical or deployed reply field pair`);
  }
  // sent_at/replied_at are transport fields. They are deliberately not parsed,
  // compared, or used for ordering; logical SEQ is the only ordering signal.
  return {
    ...envelope,
    subject: envelope.subject ?? envelope.in_reply_to_subject,
    sent_at: envelope.sent_at ?? envelope.replied_at,
    file,
  };
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
    : /^(?:sincerely, Hermes(?: \(role: bridge-responder\))?|sincerely, Ip Man(?: \(role: bridge-responder\))?)$/;
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
  const rawStateLine = lines.find((line) => line.startsWith('STATE: '));
  const rawStateLineValue = rawStateLine?.slice('STATE: '.length);
  // The deployed bridge's legacy ACK format may contain a human-readable
  // PAYLOAD section. Its state is the discriminator; modern ACKs use only
  // READ/ACCEPTED and never ACKNOWLEDGED/CLOSED.
  const legacyAck = envelope.from === 'hermes'
    && typeLine === 'TYPE: ACK'
    && (payloadIndex < 0 || ['ACKNOWLEDGED', 'CLOSED'].includes(rawStateLineValue));
  if (!legacyAck && (payloadIndex < 0 || payloadIndex >= signatureIndex)) fail(`${envelope.file}: missing payload delimiter`);
  const headers = new Map();
  const headerEnd = legacyAck ? signatureIndex : payloadIndex;
  for (const line of lines.slice(1, headerEnd)) {
    const match = /^(?<key>[A-Z0-9_]+): (?<value>.*)$/.exec(line);
    if (!match) {
      if (legacyAck) continue;
      fail(`${envelope.file}: invalid header ${line}`);
    }
    if (forbiddenClockField(match.groups.key)) fail(`${envelope.file}: clock/date field is forbidden: ${match.groups.key}`);
    if (headers.has(match.groups.key)) fail(`${envelope.file}: duplicate header ${match.groups.key}`);
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
  const requiredHeaders = [
    'TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL',
    'NEXT_OWNER', 'NEXT_ACTION', 'REASON', 'PAYLOAD_SHA256',
  ];
  if (legacyAck) {
    for (const key of ['TYPE', 'TASK', 'WIRE', 'SEQ', 'IN_REPLY_TO', 'STATE', 'TERMINAL', 'NEXT_OWNER', 'DELIVERY_ACCEPTED', 'LIVE_ACTIONS']) {
      const value = ['DELIVERY_ACCEPTED', 'LIVE_ACTIONS'].includes(key) ? legacyField(key) : headers.get(key);
      if (value === undefined) fail(`${envelope.file}: legacy ACK missing header ${key}`);
    }
    if (!legacyField('DELIVERY_ACCEPTED')?.startsWith('NO')) fail(`${envelope.file}: legacy ACK cannot claim delivery`);
    if (!legacyField('LIVE_ACTIONS')?.startsWith('NONE')) fail(`${envelope.file}: legacy ACK must declare LIVE_ACTIONS NONE`);
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
  if (!types.has(normalizedType)) fail(`${envelope.file}: invalid TYPE`);
  if (!states.has(normalizedState)) fail(`${envelope.file}: invalid STATE`);
  if (!owners.has(headers.get('NEXT_OWNER'))) fail(`${envelope.file}: invalid NEXT_OWNER`);
  if (!['YES', 'NO'].includes(headers.get('TERMINAL'))) fail(`${envelope.file}: invalid TERMINAL`);
  const terminalState = new Set(['DELIVERED', 'REJECTED', 'BLOCKED']).has(normalizedState);
  const terminalReceipt = normalizedType === 'RECEIPT'
    && normalizedState === 'READ'
    && headers.get('TERMINAL') === 'YES'
    && headers.get('NEXT_OWNER') === 'NONE';
  const terminal = terminalState || terminalReceipt;
  if (!legacyBlocked && (headers.get('TERMINAL') === 'YES') !== terminal) fail(`${envelope.file}: TERMINAL does not match STATE`);
  if (legacyBlocked && headers.get('NEXT_OWNER') !== 'CODEX') fail(`${envelope.file}: legacy blocked ACK must return ownership to CODEX`);
  if (legacyClosed) {
    if (headers.get('TERMINAL') !== 'YES') fail(`${envelope.file}: legacy CLOSED ACK must be terminal`);
    if (!['CODEX', 'NONE'].includes(headers.get('NEXT_OWNER'))) fail(`${envelope.file}: legacy CLOSED ACK has invalid NEXT_OWNER`);
    if (!headers.get('REASON') || headers.get('REASON') === 'NONE') fail(`${envelope.file}: legacy CLOSED ACK must name REASON`);
  }
  if (normalizedType === 'TASK' && (normalizedState !== 'OPEN' || seq !== 1 || headers.get('IN_REPLY_TO') !== 'NONE')) {
    fail(`${envelope.file}: TASK must be SEQ 1 / OPEN / IN_REPLY_TO NONE`);
  }
  if (normalizedType === 'ACK' && !['READ', 'ACCEPTED'].includes(normalizedState)) fail(`${envelope.file}: ACK state invalid`);
  if (normalizedType === 'NACK' && !['REJECTED', 'BLOCKED'].includes(normalizedState)) fail(`${envelope.file}: NACK state invalid`);
  if (normalizedType === 'PROGRESS' && normalizedState !== 'IN_PROGRESS') fail(`${envelope.file}: PROGRESS must be IN_PROGRESS`);
  if (normalizedType === 'DELIVERY' && normalizedState !== 'DELIVERED') fail(`${envelope.file}: DELIVERY must be DELIVERED`);
  if (normalizedType === 'PROGRESS' && !legacyAck) {
    const progressEvidence = lines
      .slice(payloadIndex + 1, signatureIndex)
      .find((line) => line.startsWith('PROGRESS_EVIDENCE: '))
      ?.slice('PROGRESS_EVIDENCE: '.length)
      .trim();
    if (!progressEvidence || /^(?:NONE|NOT_READY|NO_CHANGE)$/i.test(progressEvidence)) {
      fail(`${envelope.file}: PROGRESS requires a concrete PROGRESS_EVIDENCE delta`);
    }
  }
  if (!legacyAck && !headers.get('NEXT_ACTION')?.trim()) fail(`${envelope.file}: NEXT_ACTION must not be empty`);
  if (!legacyAck && !terminal && /^NONE$/i.test(headers.get('NEXT_ACTION') ?? '')) fail(`${envelope.file}: nonterminal message must name NEXT_ACTION`);
  if (!legacyAck && headers.get('TYPE') === 'NACK' && headers.get('REASON') === 'NONE') fail(`${envelope.file}: NACK must name REASON`);
  if (!legacyAck && headers.get('TYPE') === 'RECEIPT' && normalizedState === 'REJECTED' && headers.get('REASON') === 'NONE') fail(`${envelope.file}: rejected RECEIPT must name REASON`);
  if (!legacyAck && !/^(NONE|[a-f0-9]{64})$/.test(headers.get('PAYLOAD_SHA256'))) fail(`${envelope.file}: invalid PAYLOAD_SHA256`);
  if (!legacyAck && /^(DATE|TIME|TIMESTAMP|SENT_AT|CREATED_AT|UPDATED_AT|DEADLINE|TTL):/m.test(lines.slice(1, signatureIndex).join('\n'))) {
    fail(`${envelope.file}: wall-clock/deadline fields are forbidden anywhere in a strict message`);
  }
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
  if (roleByType[normalizedType] !== envelope.from) {
    fail(`${envelope.file}: ${normalizedType} cannot be sent by ${envelope.from}`);
  }

  const contract = headers.get('CONTRACT');
  const payloadLines = legacyAck ? [] : lines.slice(payloadIndex + 1, signatureIndex);
  const payloadFields = new Map();
  for (const line of payloadLines) {
    const match = /^(?<key>[A-Z0-9_]+): (?<value>.*)$/.exec(line);
    if (match) {
      if (forbiddenClockField(match.groups.key)) fail(`${envelope.file}: clock/date field is forbidden: ${match.groups.key}`);
      if (payloadFields.has(match.groups.key)) fail(`${envelope.file}: duplicate payload field ${match.groups.key}`);
      payloadFields.set(match.groups.key, match.groups.value);
    }
  }

  // ACK-NACK-1 is the strict contract for all new lanes. Legacy bridge
  // replies remain readable for historical journals, but they cannot advance
  // a strict lane. This is the compatibility boundary that prevents an
  // ACKNOWLEDGED/CLOSED reply from silently becoming a new task state.
  if (contract === 'ACK-NACK-1') {
    if (legacyAck) fail(`${envelope.file}: ACK-NACK-1 rejects legacy ACK envelopes`);
    if (normalizedType === 'RECEIPT' && !['READ', 'REJECTED'].includes(normalizedState)) fail(`${envelope.file}: ACK-NACK-1 RECEIPT must use READ or REJECTED state`);
    if (envelope.from === 'hermes' && !['sincerely, Hermes', 'sincerely, Hermes (role: bridge-responder)'].includes(signature)) {
      fail(`${envelope.file}: ACK-NACK-1 requires the Hermes role signature`);
    }
    if (normalizedType !== 'TASK' && payloadFields.get('READ_STATUS') !== 'READ') {
      fail(`${envelope.file}: ACK-NACK-1 requires READ_STATUS: READ on every reply or receipt`);
    }
    if (normalizedType === 'TASK' && payloadFields.get('READ_STATUS') !== 'NOT_APPLICABLE') {
      fail(`${envelope.file}: ACK-NACK-1 TASK requires READ_STATUS: NOT_APPLICABLE`);
    }
    if (normalizedType === 'RECEIPT' && payloadFields.get('RECEIPT_OF') !== headers.get('IN_REPLY_TO')) {
      fail(`${envelope.file}: ACK-NACK-1 RECEIPT must name the exact WIRE it read`);
    }
    if (normalizedType === 'ACK') {
      const expectedOwner = normalizedState === 'READ' ? 'CODEX' : 'HERMES';
      if (headers.get('NEXT_OWNER') !== expectedOwner) {
        fail(`${envelope.file}: ACK-NACK-1 ACK/${normalizedState} has the wrong NEXT_OWNER`);
      }
    }
    if (normalizedType === 'NACK' && headers.get('NEXT_OWNER') !== 'CODEX') {
      fail(`${envelope.file}: ACK-NACK-1 NACK must return ownership to CODEX`);
    }
  }
  if (headers.get('TYPE') === 'DELIVERY') {
    const payloadKeys = payloadFields;
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
    legacy: legacyAck,
    type: normalizedType,
    task: headers.get('TASK'),
    wire: headers.get('WIRE'),
    seq,
    inReplyTo: headers.get('IN_REPLY_TO'),
    state: normalizedState,
    terminal,
    nextOwner: headers.get('NEXT_OWNER'),
    nextAction: headers.get('NEXT_ACTION') ?? (legacyBlocked
      ? 'Resolve the named blocker or close the task'
      : legacyClosed
        ? 'Close the lane; no further work is assigned'
      : legacyAck
        ? 'Publish PROGRESS or DELIVERY'
        : undefined),
    reason: headers.get('REASON') ?? (legacyBlocked ? 'LEGACY_BLOCKED_STATUS' : legacyClosed ? 'LEGACY_CLOSED_ACK' : legacyAck ? 'LEGACY_BRIDGE_ACK' : undefined),
    contract,
    signature,
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
  const strictContract = sorted[0]?.contract === 'ACK-NACK-1';
  if (strictContract) {
    for (const current of sorted) {
      if (current.contract !== 'ACK-NACK-1') {
        fail(`${current.file}: ACK-NACK-1 task contains a message without CONTRACT: ACK-NACK-1`);
      }
      if (current.legacy) {
        fail(`${current.file}: ACK-NACK-1 task cannot use a legacy bridge envelope`);
      }
    }
  }
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
    if (index > 0 && current.from === 'hermes' && current.type === 'ACK' && current.state !== 'BLOCKED' && sorted[index - 1].type === 'RECEIPT' && sorted[index - 1].from === 'codex') {
      fail(`${current.file}: Hermes ACK after Codex RECEIPT is an ACK loop; require PROGRESS, DELIVERY, or BLOCKED`);
    }
    if (current.seq === 2) {
      if (!['ACK', 'NACK'].includes(current.type) || current.inReplyTo !== sorted[0].wire) {
        fail(`${current.file}: SEQ 2 must be a correlated ACK or NACK for the TASK`);
      }
    }
    if (!current.legacy) {
      const expectedNextOwner = current.type === 'TASK'
        ? 'HERMES'
        : current.type === 'ACK'
          ? (current.state === 'READ' ? 'CODEX' : 'HERMES')
          : current.type === 'NACK'
            ? 'CODEX'
            : current.type === 'PROGRESS'
              ? 'HERMES'
                : current.type === 'DELIVERY'
                ? 'CODEX'
                : current.type === 'RECEIPT' && current.terminal && current.state === 'READ'
                  ? 'NONE'
                : 'HERMES';
      if (current.nextOwner !== expectedNextOwner) {
        fail(`${current.file}: ${current.type}/${current.state} must set NEXT_OWNER: ${expectedNextOwner}`);
      }
      if (current.type === 'RECEIPT' && current.terminal && current.state === 'READ') {
        const referenced = sorted.find((candidate) => candidate.wire === current.inReplyTo);
        if (!referenced?.terminal || referenced.from !== 'hermes') {
          fail(`${current.file}: terminal READ receipt must acknowledge a terminal Hermes reply`);
        }
      }
    }
  }
  const last = sorted.at(-1);
  const unconfirmed = sorted.length === 1 && last.type === 'TASK';
  const terminalReplyNeedsReceipt = strictContract && last.from === 'hermes' && last.terminal;
  const correctionNeedsReply = strictContract && last.type === 'RECEIPT' && last.state === 'REJECTED';
  const pending = (!last.terminal && last.nextOwner !== 'NONE') || terminalReplyNeedsReceipt || correctionNeedsReply;
  const effectiveNextOwner = terminalReplyNeedsReceipt ? 'CODEX' : last.nextOwner;
  const effectiveNextAction = terminalReplyNeedsReceipt
    ? `Send terminal READ receipt for ${last.wire}`
    : last.nextAction;
  const status = unconfirmed
    ? 'UNCONFIRMED'
    : pending && (!allowPending || terminalReplyNeedsReceipt || correctionNeedsReply)
      ? 'PENDING'
      : 'OK';
  const summary = {
    status,
    task: last.task,
    messages: sorted.length,
    state: last.state,
    next_owner: effectiveNextOwner,
    next_action: effectiveNextAction,
  };
  if (asJson) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(`hermes-protocol-audit: ${status} task=${last.task} messages=${sorted.length} state=${last.state} next_owner=${effectiveNextOwner} next_action=${effectiveNextAction}`);
  }
  // A missing logical reply is never made successful by --allow-pending. The
  // flag is only for an already acknowledged, nonterminal lane.
  if (unconfirmed || (pending && (!allowPending || terminalReplyNeedsReceipt || correctionNeedsReply))) process.exitCode = 2;
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
