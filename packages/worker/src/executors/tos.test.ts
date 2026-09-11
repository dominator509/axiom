import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('evaluateMediaToS', () => {
  const video = { kind: 'video', storageKey: 'generated/clip.mp4', sha256: Buffer.alloc(32, 1) };
  const frame = (index: number) => `tos-video-v1/${video.sha256.toString('hex')}/frame-${String(index).padStart(3, '0')}.png`;
  function extraction(overrides = {}) {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      policy: 'sampled-2fps-v1', source_sha256: video.sha256.toString('hex'), duration_seconds: 1,
      frames: [frame(1), frame(2)], ...overrides,
    })));
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }
  it('classifies every extracted frame and requires full-video human review', async () => {
    vi.stubEnv('MEDIA_PLANE_AUTH_TOKEN', 'internal-test-token');
    const fetcher = extraction();
    const report = await evaluateMediaToS(video, 'Safe', [], ['instagram']);
    expect(report.verdict).toBe('review');
    expect(report.scores[0].verdict).toBe('review');
    expect(report.videoCoverage).toEqual({ policy: 'sampled-2fps-v1',
      assetSha256: video.sha256.toString('hex'), durationSeconds: 1, frameCount: 2,
      automatedScores: REPORT.scores });
    expect(report.reasons.join(' ')).toContain('2 frames');
    expect(mockState.evaluate).toHaveBeenCalledTimes(2);
    expect(mockState.evaluate).toHaveBeenNthCalledWith(2, { imageData: frame(2), caption: 'Safe', hashtags: [] }, ['instagram']);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/media/video/frames'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer internal-test-token' }),
    }));
  });
  it('preserves a block and the highest score from a later frame', async () => {
    extraction();
    mockState.evaluate.mockResolvedValueOnce(REPORT).mockResolvedValueOnce({
      verdict: 'block', reasons: ['Unsafe frame'],
      scores: [{ ...REPORT.scores[0], score: 99, verdict: 'block', reasons: ['Unsafe frame'] }],
    });
    const report = await evaluateMediaToS(video, 'Safe', [], ['instagram']);
    expect(report.verdict).toBe('block');
    expect(report.scores[0].score).toBe(99);
    expect(report.videoCoverage?.automatedScores[0].verdict).toBe('block');
  });
  it.each([
    { frames: [] }, { frames: [frame(1), frame(1)] }, { frames: ['../../private'] },
    { source_sha256: 'wrong' }, { duration_seconds: 30 }, { policy: 'unknown' },
  ])('rejects invalid extraction evidence before inference: %s', async overrides => {
    extraction(overrides);
    await expect(evaluateMediaToS(video, 'Safe', [], ['instagram'])).rejects.toThrow('coverage');
    expect(mockState.evaluate).not.toHaveBeenCalled();
  });
  it('does not produce a verdict after partial inference failure', async () => {
    extraction();
    mockState.evaluate.mockResolvedValueOnce(REPORT).mockRejectedValueOnce(new Error('vision unavailable'));
    await expect(evaluateMediaToS(video, 'Safe', [], ['instagram'])).rejects.toThrow('vision unavailable');
  });
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
        { kind: 'audio', storageKey: 'models/model-1/audio.mp3' },
        'caption',
        [],
        ['instagram'],
      ),
    ).rejects.toThrow('visual ToS classification is unavailable for audio assets');
    expect(mockState.evaluate).not.toHaveBeenCalled();
  });
});

describe('tosScan', () => {
  it('binds video machine evidence to a fresh scan and content digest on every scan', async () => {
    const hash = Buffer.alloc(32, 1).toString('hex');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      policy: 'sampled-2fps-v1', source_sha256: hash, duration_seconds: 1,
      frames: [1, 2].map(n => `tos-video-v1/${hash}/frame-${String(n).padStart(3, '0')}.png`),
    }))));
    const bundle = { id: 'bundle-1', modelId: 'model-1', assetId: 'asset-1',
      captions: { instagram: 'Safe' }, hashtags: [],
      tosReport: { revisionId: 'retained-caption-revision', videoScan: { scanId: 'stale-scan' } } };
    const run = async (caption: string) => {
      mockState.results = [[{ ...bundle, captions: { instagram: caption } }],
        [{ kind: 'video', storageKey: 'clip.mp4', sha256: Buffer.from(hash, 'hex') }], []];
      await tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' });
      return (mockState.updates.at(-1) as { tosReport: {
        verdict: string; revisionId: string;
        videoScan: { scanId: string; contentDigest: string; assetSha256: string; automatedScores: unknown[] };
      } }).tosReport;
    };
    const first = await run('Safe');
    const repeated = await run('Safe');
    const changed = await run('Changed caption');
    expect(first.verdict).toBe('review');
    expect(first.revisionId).toBe('retained-caption-revision');
    expect(first.videoScan.assetSha256).toBe(hash);
    expect(first.videoScan.automatedScores).toEqual(REPORT.scores);
    expect(first.videoScan.scanId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.videoScan.scanId).not.toBe(repeated.videoScan.scanId);
    expect(first.videoScan.contentDigest).toBe(repeated.videoScan.contentDigest);
    expect(first.videoScan.contentDigest).not.toBe(changed.videoScan.contentDigest);
  });
  it('preserves the revision identity through the scan', async () => {
    mockState.results = [
      [
        {
          id: 'bundle-1',
          modelId: 'model-1',
          state: 'generated',
          captions: { instagram: 'Safe' },
          hashtags: [],
          tosReport: { revisionId: 'revision-1' },
        },
      ],
      [],
    ];
    await tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' });
    expect(mockState.updates).toEqual([
      expect.objectContaining({
        tosReport: { ...REPORT, revisionId: 'revision-1' },
      }),
    ]);
    expect(mockState.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'relay.card', payload: { bundleId: 'bundle-1', revisionId: 'revision-1' },
    }));
  });
  it('does not replace a pending revision marker with an obsolete scan', async () => {
    mockState.results = [[{ id: 'bundle-1', state: 'revising' }]];
    await expect(
      tosScan({ tx: makeChain(), job: JOB, killSwitchEnabled: false, workerId: 'worker-1' }),
    ).rejects.toThrow('revision is still pending');
    expect(mockState.updates).toHaveLength(0);
    expect(mockState.enqueue).not.toHaveBeenCalled();
  });
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
      expect.objectContaining({ kind: 'relay.card', payload: { bundleId: 'bundle-1', revisionId: null } }),
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
