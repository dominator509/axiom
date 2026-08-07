// HTTP routes for the LLM Gateway — mounted as a Hono sub-route

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { LLMGateway } from './gateway.js';
import { ProviderError } from './providers/types.js';
import { PLATFORMS } from './prompts.js';

const chatBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    }),
  ),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  policy: z.enum(['cost', 'latency', 'quality']).optional(),
  provider: z.string().optional(),
  stream: z.boolean().optional(),
  /** Route through the model's bound egress sidecar (L2.6). */
  egress: z.boolean().optional(),
});

/** TOKENKILLER body: S0–S3 assembly inputs (L2.5, LBI-09). */
const tokenkillerBodySchema = chatBodySchema.extend({
  tokenkiller: z.object({
    modelId: z.string().min(1),
    platform: z.string().min(1),
    exemplars: z
      .array(
        z.object({
          id: z.string(),
          // Full ViralExemplar surface (prompts.ts) — zod strips unknown keys,
          // so every field the gateway needs must be declared here.
          platform: z.enum(PLATFORMS),
          title: z.string(),
          caption: z.string(),
          hashtags: z.array(z.string()),
          viralLabel: z.enum(['viral', 'strong', 'baseline', 'weak']),
          aiNotes: z.string().nullable(),
          // Viral-store enrichment fields (kept for compatibility).
          features: z.record(z.unknown()).optional(),
          perfScore: z.number().optional(),
          label: z.string().optional(),
        }),
      )
      .optional(),
    task: z
      .object({
        modelId: z.string(),
        platform: z.enum(PLATFORMS),
        angle: z.string().optional(),
        emojiStyle: z.enum(['minimal', 'moderate', 'heavy']).optional(),
        cta: z.string().optional(),
        talkingPoints: z.array(z.string()).optional(),
        mediaDescriptions: z.array(z.string()).optional(),
        imageCaption: z.string().optional(),
      })
      .passthrough(),
    profile: z.object({
      id: z.string(),
      displayName: z.string(),
      handle: z.string(),
      avatarUrl: z.string().nullable(),
      bio: z.string().nullable(),
      persona: z.string().optional(),
      characterRules: z.array(z.string()).optional(),
    }),
    prefixVersion: z.string().optional(),
  }),
});

export function createRouter(gateway: LLMGateway): Hono {
  const router = new Hono();

  // POST /chat — non-streaming completion
  router.post('/chat', zValidator('json', chatBodySchema), async (c) => {
    const { messages, model, temperature, maxTokens, policy, provider, egress } = c.req.valid('json');
    try {
      const result = await gateway.chat(messages, {
        model,
        temperature,
        maxTokens,
        policy,
        provider,
        egress,
      });
      return c.json(result);
    } catch (err) {
      const status = (err instanceof ProviderError ? err.status : 502) as 400 | 401 | 402 | 403 | 404 | 408 | 409 | 422 | 429 | 500 | 502 | 503 | 504;
      const msg = err instanceof Error ? err.message : 'LLM gateway error';
      return c.json({ error: { message: msg, provider: err instanceof ProviderError ? err.provider : undefined } }, status);
    }
  });

  // POST /chat/tokenkiller — TOKENKILLER S0–S3 assembled chat (L2.5, LBI-09)
  router.post('/chat/tokenkiller', zValidator('json', tokenkillerBodySchema), async (c) => {
    const { messages, tokenkiller, model, temperature, maxTokens, policy, provider, egress } = c.req.valid('json');
    try {
      const result = await gateway.chatWithTokenKiller(messages, {
        model,
        temperature,
        maxTokens,
        policy,
        provider,
        egress,
        tokenkiller,
      });
      return c.json(result);
    } catch (err) {
      const status = (err instanceof ProviderError ? err.status : 502) as 400 | 401 | 402 | 403 | 404 | 408 | 409 | 422 | 429 | 500 | 502 | 503 | 504;
      const msg = err instanceof Error ? err.message : 'LLM gateway error';
      return c.json({ error: { message: msg, provider: err instanceof ProviderError ? err.provider : undefined } }, status);
    }
  });

  // POST /chat/stream — streaming completion via SSE
  router.post('/chat/stream', zValidator('json', chatBodySchema), async (c) => {
    const { messages, model, temperature, maxTokens, policy, provider, egress } = c.req.valid('json');
    const stream = gateway.chatStream(messages, {
      model,
      temperature,
      maxTokens,
      policy,
      provider,
      egress,
    });

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of await stream) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
            }
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Stream error';
            controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${msg}\n\n`));
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      },
    );
  });

  // GET /providers — list available providers
  router.get('/providers', (c) => {
    return c.json({ providers: gateway.getAvailableProviders() });
  });

  // GET /stats — cache stats
  router.get('/stats', (c) => {
    return c.json(gateway.getStats());
  });

  return router;
}
