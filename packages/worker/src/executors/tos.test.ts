import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  results: [] as unknown[],
  evaluate: vi.fn(),
  textEvaluate: vi.fn(),
  enqueue: vi.fn(),
  updates: [] as unknown[],
}));

function makeChain(): any {
  const handler = {
    get(_target: unknown, prop: string | symbol) {
      if (prop === 'set') {
        return (value: unknown) => {
          mockState.updates.push(value);
          return makeChain();
        };
      }
      if (prop === 'then') {
        return (resolve: (value: unknown) => void, reject?: (error: unknown) => void) => {
          const value = mockState.results.length > 0 ? mockState.results.shift() : [];
          Promise.resolve(value).then(resolve, reject);
        };
      }
      return () => makeChain();
    },
    apply() {
      return makeChain();
    },
  };
  return new Proxy(function () {}, handler);
}

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@axiom/db', () => ({
  schema: {
    contentBundle: {
      id: 'content_bundle.id',
      orgId: 'content_bundle.org_id',
    },
    asset: {
      id: 'asset.id',
      orgId: 'asset.org_id',
      modelId: 'asset.model_id',
      kind: 'asset.kind',
      storageKey: 'asset.storage_key',
    },
    job: {},
  },
}));

vi.mock('@axiom/fanvue-mcp', async () => ({
  ...(await vi.importActual<typeof import('@axiom/fanvue-mcp')>('@axiom/fanvue-mcp')),
  DEFAULT_PLATFORM_THRESHOLDS: { instagram: 70 },
  evaluateTextToS: (...args: unknown[]) => mockState.textEvaluate(...args),
  ToSEngine: class {
    evaluate(asset: unknown, platforms: unknown) {
      return mockState.evaluate(asset, platforms);
    }
  },
}));

vi.mock('../enqueue.js', () => ({
  enqueueJob: mockState.enqueue,
}));

import { evaluateMediaToS, tosScan } from './tos.js';

const JOB = {
  id: 'job-1',
  org_id: 'org-1',
  max_attempts: 3,
  payload: { bundleId: 'bundle-1' },
} as any;

const REPORT = {
  verdict: 'pass' as const,
  scores: [
    {
      platform: 'instagram' as const,
      score: 0,
      threshold: 70,
      verdict: 'pass' as const,
      reasons: [],
    },
  ],
  reasons: [],
};

beforeEach(() => {
  mockState.results = [];
  mockState.updates = [];
  mockState.evaluate.mockReset();
  mockState.textEvaluate.mockReset();
  mockState.evaluate.mockResolvedValue(REPORT);
  mockState.textEvaluate.mockReturnValue(REPORT);
  mockState.enqueue.mockReset();
  mockState.enqueue.mockResolvedValue({ id: 'relay-job-1' });
});

describe('evaluateMediaToS', () => {
  it('sends an image storage key to the local vision ToS engine', async () => {
    await expect(
      evaluateMediaToS(
        { kind: 'image', storageKey: 'models/model-1/image.jpg' },
        'A safe caption',
        ['safe'],
        ['instagram'],
      ),
    ).resolves.toEqual(REPORT);

    expect(mockState.evaluate).toHaveBeenCalledWith(
      { imageData: 'models/model-1/image.jpg', caption: 'A safe caption', hashtags: ['safe'] },
      ['instagram'],
    );
  });

  it('fails closed when no visual classifier contract exists for the asset kind', async () => {
    await expect(
      evaluateMediaToS(
        { kind: 'video', storageKey: 'models/model-1/video.mp4' },
        'caption',
        [],
        ['instagram'],
      ),
    ).rejects.toThrow('visual ToS classification is unavailable for video assets');
    expect(mockState.evaluate).not.toHaveBeenCalled();
  });
});

describe('tosScan', () => {
  it('preserves a review verdict from a later destination', async () => {
    const { evaluateTextToS } =
      await vi.importActual<typeof import('@axiom/fanvue-mcp')>('@axiom/fanvue-mcp');
    mockState.textEvaluate.mockImplementation(evaluateTextToS);
    mockState.results = [
      [
        {
          id: 'bundle-1',
          modelId: 'model-1',
          assetId: null,
          captions: { instagram: 'Safe', tiktok: 'https://example.com' },
          hashtags: [],
        },
      ],
      [],
    ];
    await tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' });
    expect(mockState.updates).toEqual([
      expect.objectContaining({
        tosReport: expect.objectContaining({ verdict: 'review' }),
      }),
    ]);
  });

  it('does not persist a partial report or enqueue relay when a later media check fails', async () => {
    mockState.evaluate
      .mockResolvedValueOnce(REPORT)
      .mockRejectedValueOnce(new Error('vision unavailable'));
    mockState.results = [
      [
        {
          id: 'bundle-1',
          modelId: 'model-1',
          assetId: 'asset-1',
          captions: { instagram: 'First', threads: 'Second' },
          hashtags: [],
        },
      ],
      [{ kind: 'image', storageKey: 'image.jpg' }],
    ];
    await expect(
      tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' }),
    ).rejects.toThrow('vision unavailable');
    expect(mockState.evaluate).toHaveBeenCalledTimes(2);
    expect(mockState.updates).toHaveLength(0);
    expect(mockState.enqueue).not.toHaveBeenCalled();
  });

  it('checks each actual caption with real text rules and keeps the strongest verdict', async () => {
    const { evaluateTextToS } =
      await vi.importActual<typeof import('@axiom/fanvue-mcp')>('@axiom/fanvue-mcp');
    mockState.textEvaluate.mockImplementation(evaluateTextToS);
    mockState.results = [
      [
        {
          id: 'bundle-1',
          modelId: 'model-1',
          assetId: null,
          captions: { instagram: 'A safe caption', threads: 'nude', tiktok: 'https://example.com' },
          hashtags: [],
        },
      ],
      [],
    ];
    await tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' });
    expect(mockState.updates).toEqual([
      expect.objectContaining({
        tosReport: expect.objectContaining({
          verdict: 'block',
          scores: [
            expect.objectContaining({ platform: 'instagram', verdict: 'pass' }),
            expect.objectContaining({ platform: 'threads', verdict: 'block' }),
            expect.objectContaining({ platform: 'tiktok', verdict: 'review' }),
          ],
          reasons: expect.arrayContaining([
            'Caption contains blocked keywords: nude',
            'Links are not allowed in tiktok captions',
          ]),
        }),
      }),
    ]);
  });

  it('groups identical media captions but evaluates distinct captions separately', async () => {
    const blocked = {
      verdict: 'block',
      reasons: ['unsafe caption'],
      scores: [
        { ...REPORT.scores[0], platform: 'tiktok', verdict: 'block', reasons: ['unsafe caption'] },
      ],
    };
    mockState.evaluate
      .mockResolvedValueOnce({
        ...REPORT,
        scores: [REPORT.scores[0], { ...REPORT.scores[0], platform: 'threads' }],
      })
      .mockResolvedValueOnce(blocked);
    mockState.results = [
      [
        {
          id: 'bundle-1',
          modelId: 'model-1',
          assetId: 'asset-1',
          captions: { instagram: 'Safe', threads: 'Safe', tiktok: 'Unsafe' },
          hashtags: [],
        },
      ],
      [{ kind: 'image', storageKey: 'image.jpg' }],
      [],
    ];
    await tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' });
    expect(mockState.evaluate).toHaveBeenCalledTimes(2);
    expect(mockState.evaluate).toHaveBeenNthCalledWith(
      1,
      { imageData: 'image.jpg', caption: 'Safe', hashtags: [] },
      ['instagram', 'threads'],
    );
    expect(mockState.evaluate).toHaveBeenNthCalledWith(
      2,
      { imageData: 'image.jpg', caption: 'Unsafe', hashtags: [] },
      ['tiktok'],
    );
    expect(mockState.updates).toEqual([
      expect.objectContaining({
        tosReport: expect.objectContaining({
          verdict: 'block',
          scores: expect.arrayContaining(blocked.scores),
        }),
      }),
    ]);
  });

  it.each([
    [{}, 'bundle has no target captions'],
    [{ instagram: null }, 'invalid caption'],
    [{ unknown: 'caption' }, 'unsupported target platform'],
  ])(
    'rejects invalid target captions before evaluating or handing off: %j',
    async (captions, error) => {
      mockState.results = [[{ id: 'bundle-1', modelId: 'model-1', captions, hashtags: [] }]];
      await expect(
        tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' }),
      ).rejects.toThrow(error);
      expect(mockState.updates).toHaveLength(0);
      expect(mockState.evaluate).not.toHaveBeenCalled();
      expect(mockState.textEvaluate).not.toHaveBeenCalled();
      expect(mockState.enqueue).not.toHaveBeenCalled();
    },
  );

  it('loads the asset under the bundle org/model and uses the visual report', async () => {
    mockState.results = [
      [
        {
          id: 'bundle-1',
          modelId: 'model-1',
          assetId: 'asset-1',
          captions: { instagram: 'A safe caption' },
          hashtags: ['safe'],
        },
      ],
      [{ kind: 'image', storageKey: 'models/model-1/image.jpg' }],
      [],
    ];

    await expect(
      tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' }),
    ).resolves.toBeUndefined();

    expect(mockState.evaluate).toHaveBeenCalledWith(
      { imageData: 'models/model-1/image.jpg', caption: 'A safe caption', hashtags: ['safe'] },
      ['instagram'],
    );
    expect(mockState.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'relay.card', payload: { bundleId: 'bundle-1' } }),
    );
  });

  it('rejects an asset missing from the bundle org/model scope', async () => {
    mockState.results = [
      [
        {
          id: 'bundle-1',
          modelId: 'model-1',
          assetId: 'asset-1',
          captions: { instagram: 'A safe caption' },
          hashtags: [],
        },
      ],
      [],
    ];

    await expect(
      tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' }),
    ).rejects.toThrow('asset asset-1 not found or not owned by model model-1');
    expect(mockState.enqueue).not.toHaveBeenCalled();
  });

  it('uses the shared text ToS evaluator for text-only bundles', async () => {
    mockState.results = [
      [
        {
          id: 'bundle-1',
          modelId: 'model-1',
          assetId: null,
          captions: { instagram: 'A safe caption' },
          hashtags: [],
        },
      ],
      [],
    ];

    await tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' });

    expect(mockState.textEvaluate).toHaveBeenCalledWith('A safe caption', [], ['instagram']);
  });
});
