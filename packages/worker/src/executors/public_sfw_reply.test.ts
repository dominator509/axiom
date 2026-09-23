import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectorForConnection = vi.fn();
vi.mock('../connection.js', () => ({
  asPlatform: (value: string) => {
    if (!['x', 'instagram', 'reddit'].includes(value)) throw new Error('unsupported');
    return value;
  },
  connectorForConnection: (...args: unknown[]) => connectorForConnection(...args),
}));

import { publicSfwReply } from './public_sfw_reply.js';
import type { ExecutorContext } from './context.js';

const connection = { id: 'connection-1', orgId: 'org-1', modelId: 'model-1', platform: 'x', status: 'connected' };
const job = {
  id: 'job-1', org_id: 'org-1', worker_id: undefined,
  payload: { modelId: 'model-1', connectionId: 'connection-1', platform: 'x', postId: 'post-1', commentId: 'comment-1', text: 'Thanks for asking! https://discord.gg/Invite-Code' },
};
const events: string[] = [];
const executeOperation = vi.fn();

function makeTx() {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    for: () => chain,
    then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve([connection]).then(resolve, reject),
    execute: async () => ({ rows: [{ id: 'job-1' }] }),
  };
  return chain;
}

function ctx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  const tx = makeTx();
  return {
    tx,
    job: job as any,
    workerId: 'worker-1',
    killSwitchEnabled: false,
    markExternalSideEffect: () => { events.push('side-effect'); },
    persistSideEffectMarker: async operation => {
      events.push('marker');
      return operation(tx);
    },
    ...overrides,
  };
}

beforeEach(() => {
  events.length = 0;
  executeOperation.mockReset().mockResolvedValue({ type: 'mutation', success: true, remoteId: 'reply-1' });
  connectorForConnection.mockReset().mockResolvedValue({
    connector: { capability: () => ({ operations: ['comments.reply'] }), executeOperation: (...args: unknown[]) => {
      events.push('provider');
      return executeOperation(...args);
    } },
  });
});
afterEach(() => vi.restoreAllMocks());

describe('public SFW reply executor', () => {
  it('rechecks the active connection and ToS, persists its dispatch marker, then replies once', async () => {
    await publicSfwReply(ctx());
    expect(connectorForConnection).toHaveBeenCalledWith(connection);
    expect(events).toEqual(['marker', 'side-effect', 'provider']);
    expect(executeOperation).toHaveBeenCalledWith({
      type: 'comments.reply', commentId: 'comment-1', text: 'Thanks for asking! https://discord.gg/Invite-Code',
    });
  });

  it('parks without provider access while the global kill switch is enabled', async () => {
    await expect(publicSfwReply(ctx({ killSwitchEnabled: true }))).rejects.toMatchObject({ name: 'ParkJobError' });
    expect(connectorForConnection).not.toHaveBeenCalled();
    expect(executeOperation).not.toHaveBeenCalled();
  });

  it('refuses malformed or non-SFW payloads before connector construction', async () => {
    const badJob = { ...job, payload: { ...job.payload, text: 'Here is explicit adult content' } };
    await expect(publicSfwReply(ctx({ job: badJob as any }))).rejects.toThrow('ToS gate');
    expect(connectorForConnection).not.toHaveBeenCalled();
  });

  it('requires the capability again at dispatch and marks uncertain provider results', async () => {
    connectorForConnection.mockResolvedValueOnce({ connector: { capability: () => ({ operations: [] }), executeOperation } });
    await expect(publicSfwReply(ctx())).rejects.toThrow('no longer grants');
    expect(executeOperation).not.toHaveBeenCalled();

    connectorForConnection.mockResolvedValueOnce({ connector: { capability: () => ({ operations: ['comments.reply'] }), executeOperation } });
    executeOperation.mockResolvedValueOnce({ type: 'mutation', success: false });
    await expect(publicSfwReply(ctx())).rejects.toThrow('reconciliation');
    expect(events).toContain('side-effect');
  });
});
