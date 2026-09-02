import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  beforeError: null as Error | null,
  afterError: null as Error | null,
  auditFailure: null as Error | null,
  auditRows: null as Array<Record<string, unknown>> | null,
}));

vi.mock('@axiom/db', () => ({
  schema: { prePostRun: {} },
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      if (mockState.auditFailure) throw mockState.auditFailure;
      return callback({
        execute: async () => undefined,
        insert: () => ({
          values: async (row: Record<string, unknown>) => {
            mockState.auditRows?.push(row);
          },
        }),
      });
    },
  },
}));

vi.mock('@axiom/fanvue-mcp', () => ({
  PrePostHook: class {
    beforePublish(input: unknown): unknown {
      if (mockState.beforeError) throw mockState.beforeError;
      return input;
    }

    async afterPublish(): Promise<void> {
      if (mockState.afterError) throw mockState.afterError;
    }

    listScripts(): string[] {
      return [];
    }
  },
}));

import { mediaPlaneEngine, runPrePostAfter, runPrePostBefore } from './pre_post.js';

afterEach(() => {
  mockState.beforeError = null;
  mockState.afterError = null;
  mockState.auditFailure = null;
  mockState.auditRows = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function makeTx(rows: Array<Record<string, unknown>>) {
  return {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        rows.push(row);
      },
    }),
  };
}

const context = {
  job: { id: 'job-1', org_id: 'org-1' },
  tx: undefined,
};

const input = {
  targetId: 'target-1',
  bundleId: 'bundle-1',
  platform: 'instagram',
  modelId: 'model-1',
  caption: 'caption',
  mediaUrls: [],
  hashtags: [],
  phase: 'before' as const,
};

describe('mediaPlaneEngine', () => {
  it('fails closed in production when the Rust media plane is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    await expect(mediaPlaneEngine('http://media.test')).rejects.toThrow(
      'Rust media plane unavailable',
    );
  });

  it('keeps the development-only in-process fallback outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AXIOM_ALLOW_IN_PROCESS_PREPOST', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    await expect(mediaPlaneEngine('http://media.test')).resolves.toBe('in-process');
  });
});

describe('runPrePostBefore', () => {
  it('records an unavailable media plane and does not continue to publication', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const rows: Array<Record<string, unknown>> = [];
    const transactionRows: Array<Record<string, unknown>> = [];
    mockState.auditRows = rows;

    await expect(
      runPrePostBefore({ ...context, tx: makeTx(transactionRows) } as never, input),
    ).rejects.toThrow('pre-post.before failed: Rust media plane unavailable');

    expect(rows[0]).toMatchObject({
      status: 'failed',
      script: 'pre-post.before (unavailable)',
      error: 'Rust media plane unavailable (connection refused)',
    });
    expect(transactionRows).toEqual([]);
  });

  it('records hook failures and blocks publication', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    mockState.beforeError = new Error('hook rejected input');
    const rows: Array<Record<string, unknown>> = [];
    const transactionRows: Array<Record<string, unknown>> = [];
    mockState.auditRows = rows;

    await expect(
      runPrePostBefore({ ...context, tx: makeTx(transactionRows) } as never, input),
    ).rejects.toThrow('pre-post.before failed: hook rejected input');

    expect(rows[0]).toMatchObject({
      status: 'failed',
      script: 'pre-post.before (rust-media-plane)',
      error: 'hook rejected input',
    });
    expect(transactionRows).toEqual([]);
  });

  it('fails when media staging reports a missing input', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ exists: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    );
    const rows: Array<Record<string, unknown>> = [];
    const transactionRows: Array<Record<string, unknown>> = [];
    mockState.auditRows = rows;

    await expect(
      runPrePostBefore({ ...context, tx: makeTx(transactionRows) } as never, {
        ...input,
        mediaUrls: ['asset://asset-1'],
      }),
    ).rejects.toThrow('media-plane probe reported that the input is missing');

    expect(rows[0]).toMatchObject({ status: 'failed', error: expect.any(String) });
    expect(transactionRows).toEqual([]);
  });
});

describe('runPrePostAfter', () => {
  it('persists the post-publish audit outside the publish transaction', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const transactionRows: Array<Record<string, unknown>> = [];
    mockState.auditRows = rows;

    const stage = await runPrePostAfter(
      { ...context, tx: makeTx(transactionRows) } as never,
      { ...input, phase: 'after' },
      { remoteId: 'remote-1' },
    );

    expect(stage.runId).toBeTruthy();
    expect(rows[0]).toMatchObject({
      status: 'success',
      script: 'pre-post.after (in-process)',
    });
    expect(transactionRows).toEqual([]);
  });

  it('does not turn an audit persistence failure into a publish retry', async () => {
    mockState.auditFailure = new Error('audit database unavailable');
    const transactionRows: Array<Record<string, unknown>> = [];

    await expect(
      runPrePostAfter(
        { ...context, tx: makeTx(transactionRows) } as never,
        { ...input, phase: 'after' },
        { remoteId: 'remote-1' },
      ),
    ).resolves.toMatchObject({ engine: 'in-process' });
    expect(transactionRows).toEqual([]);
  });
});
