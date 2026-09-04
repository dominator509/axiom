import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  results: [] as unknown[],
  evaluate: vi.fn(),
  enqueue: vi.fn(),
}));

function makeChain(): any {
  const handler = {
    get(_target: unknown, prop: string | symbol) {
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

vi.mock('@axiom/fanvue-mcp', () => ({
  DEFAULT_PLATFORM_THRESHOLDS: { instagram: 70 },
  PLATFORM_RULES: { instagram: { blockedKeywords: [], maxHashtags: 30, maxCaptionLength: 2200 } },
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
  mockState.evaluate.mockReset();
  mockState.evaluate.mockResolvedValue(REPORT);
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
});
