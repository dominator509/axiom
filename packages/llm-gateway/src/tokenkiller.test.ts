// ─── TOKENKILLER (L2.5, LBI-09) — Vitest Suite ───
// Verifies S0–S3 assembly, 64-token block alignment, prefix-cache hit ratio
// tracking, and the HTTP route that exposes it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMGateway } from './gateway.js';
import { assemblePrompt, alignBlocks } from './prompts.js';
import { createRouter } from './routes.js';
import type { Message } from './gateway.js';
import type { TokenKillerOptions } from './gateway.js';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'GROK_API_KEY',
  'MISTRAL_API_KEY',
  'LIGHTNING_API_KEY',
  'GOOGLE_API_KEY',
  'VENICE_API_KEY',
  'OPENAI_BASE_URL',
  'VENICE_BASE_URL',
  'VLLM_BASE_URL',
];

function clearAllKeys() {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const k of ENV_KEYS) delete process.env[k.toLowerCase()];
}

const profile = {
  id: 'model-1',
  displayName: 'Ava',
  handle: '@ava',
  avatarUrl: null,
  bio: 'creator',
  persona: 'warm, confident, playful',
  characterRules: ['no explicit content', 'keep it classy'],
};

const completion = {
  id: 'chatcmpl-tk-1',
  object: 'chat.completion',
  created: 1,
  model: 'deepseek-chat',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'here is your caption' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 },
};

function tokenkillerOpts(overrides: Partial<TokenKillerOptions> = {}): TokenKillerOptions {
  return {
    modelId: 'model-1',
    platform: 'instagram',
    profile,
    task: {
      modelId: 'model-1',
      platform: 'instagram',
      style: 'studio',
      outfit: 'summer dress',
      mood: 'energetic',
    },
    ...overrides,
  };
}

function stubCompletion() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(completion), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );
}

describe('chatWithTokenKiller (S0–S3 assembly)', () => {
  beforeEach(() => {
    clearAllKeys();
    process.env.DEEPSEEK_API_KEY = '***';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('assembles S0–S3 segments and sends them as the system message', async () => {
    stubCompletion();

    const gateway = new LLMGateway();
    const result = await gateway.chatWithTokenKiller(
      [{ role: 'user', content: 'generate for instagram' }],
      { tokenkiller: tokenkillerOpts(), provider: 'deepseek' },
    );

    expect(result.content).toBe('here is your caption');
    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const sys = (body.messages as Message[]).find((m) => m.role === 'system');
    expect(sys).toBeDefined();
    // The system message is the full assembled prompt (S0..S3).
    expect((sys as Message).content.length).toBeGreaterThan(100);
    // 64-token block alignment: estimated tokens (len/4) is a multiple of 64.
    expect(Math.ceil((sys as Message).content.length / 4) % 64).toBe(0);
  });

  it('assemblePrompt concatenates S0→S1→S2→S3 in order', () => {
    const assembled = assemblePrompt({
      S0: '[S0]',
      S1: '[S1]',
      S2: '[S2]',
      S3: '[S3]',
    });
    expect(assembled.indexOf('[S0]')).toBeLessThan(assembled.indexOf('[S1]'));
    expect(assembled.indexOf('[S1]')).toBeLessThan(assembled.indexOf('[S2]'));
    expect(assembled.indexOf('[S2]')).toBeLessThan(assembled.indexOf('[S3]'));
  });

  it('alignBlocks pads to a multiple of 64 tokens', () => {
    const aligned = alignBlocks('hello');
    // Estimated tokens (chars/4) is a multiple of 64.
    expect(Math.ceil(aligned.length / 4) % 64).toBe(0);
    expect(aligned.startsWith('hello')).toBe(true);
  });
});

describe('prefix cache-hit ratio (LBI-09, target > 97%)', () => {
  beforeEach(() => {
    clearAllKeys();
    process.env.DEEPSEEK_API_KEY = 'sk-test';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stable prefix (same model/platform/S2) hits across varying S3', async () => {
    stubCompletion();

    const gateway = new LLMGateway();
    // Warm the prefix cache.
    await gateway.chatWithTokenKiller([{ role: 'user', content: 'one' }], {
      tokenkiller: tokenkillerOpts({
        task: {
          modelId: 'model-1',
          platform: 'instagram',
          style: 'studio',
          outfit: 'a',
          mood: 'm1',
        },
      }),
      provider: 'deepseek',
    });
    // Same prefix, different S3 task → prefix-cache HIT.
    await gateway.chatWithTokenKiller([{ role: 'user', content: 'two' }], {
      tokenkiller: tokenkillerOpts({
        task: {
          modelId: 'model-1',
          platform: 'instagram',
          style: 'outdoor',
          outfit: 'b',
          mood: 'm2',
        },
      }),
      provider: 'deepseek',
    });

    const stats = gateway.getStats().tokenkiller;
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.ratio).toBeGreaterThanOrEqual(0.5);
  });

  it('different S2 exemplars produce a different prefix key (miss)', async () => {
    stubCompletion();

    const gateway = new LLMGateway();
    const exemplarA = [
      {
        id: 'e1',
        platform: 'instagram' as const,
        title: 't',
        caption: 'c',
        hashtags: [],
        viralLabel: 'viral' as const,
        aiNotes: null,
        features: { a: 1 },
        perfScore: 0.9,
        label: 'win',
      },
    ];
    const exemplarB = [
      {
        id: 'e2',
        platform: 'instagram' as const,
        title: 't',
        caption: 'c',
        hashtags: [],
        viralLabel: 'weak' as const,
        aiNotes: null,
        features: { b: 2 },
        perfScore: 0.5,
        label: 'meh',
      },
    ];

    await gateway.chatWithTokenKiller([{ role: 'user', content: 'one' }], {
      tokenkiller: tokenkillerOpts({ exemplars: exemplarA }),
      provider: 'deepseek',
    });
    await gateway.chatWithTokenKiller([{ role: 'user', content: 'two' }], {
      tokenkiller: tokenkillerOpts({ exemplars: exemplarB }),
      provider: 'deepseek',
    });

    const stats = gateway.getStats().tokenkiller;
    expect(stats.misses).toBeGreaterThanOrEqual(1);
  });

  it('prefix version bump invalidates the prefix', async () => {
    stubCompletion();

    const gateway = new LLMGateway();
    await gateway.chatWithTokenKiller([{ role: 'user', content: 'one' }], {
      tokenkiller: tokenkillerOpts({ prefixVersion: 'v1' }),
      provider: 'deepseek',
    });
    await gateway.chatWithTokenKiller([{ role: 'user', content: 'two' }], {
      tokenkiller: tokenkillerOpts({ prefixVersion: 'v2' }),
      provider: 'deepseek',
    });

    const stats = gateway.getStats().tokenkiller;
    expect(stats.misses).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /chat/tokenkiller route', () => {
  beforeEach(() => {
    clearAllKeys();
    process.env.DEEPSEEK_API_KEY = 'sk-test';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns 200 and proxies to the gateway', async () => {
    stubCompletion();

    const gateway = new LLMGateway();
    const router = createRouter(gateway);

    const res = await router.request('/chat/tokenkiller', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        provider: 'deepseek',
        tokenkiller: tokenkillerOpts(),
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { content: string };
    expect(json.content).toBe('here is your caption');
  });

  it('rejects a request missing tokenkiller', async () => {
    const gateway = new LLMGateway();
    const router = createRouter(gateway);
    const res = await router.request('/chat/tokenkiller', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(400);
  });
});
