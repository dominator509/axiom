// HTTP routes for the LLM Gateway — mounted as a Hono sub-route

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { LLMGateway } from './gateway.js';
import { ProviderError } from './providers/types.js';
import { PLATFORMS } from './prompts.js';

type GatewayEnv = {
  Variables: { userId: string; orgId: string };
};

/** Standard RFC-7807 title for a status code (L3.0 error envelope). */
function statusTitle(status: number): string {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    408: 'Request Timeout',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return titles[status] ?? 'Error';
}

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

const subscriptionProviderSchema = z.enum(['openai', 'anthropic', 'grok']);

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

export function createRouter(gateway: LLMGateway): Hono<GatewayEnv> {
  const router = new Hono<GatewayEnv>();

  // POST /chat — non-streaming completion
  router.post('/chat', zValidator('json', chatBodySchema), async (c) => {
    const { messages, model, temperature, maxTokens, policy, provider, egress } =
      c.req.valid('json');
    try {
      const result = await gateway.chat(messages, {
        model,
        temperature,
        maxTokens,
        policy,
        provider,
        egress,
        userId: c.get('userId'),
      });
      return c.json(result);
    } catch (err) {
      const status = (err instanceof ProviderError ? err.status : 502) as
        400 | 401 | 402 | 403 | 404 | 408 | 409 | 422 | 429 | 500 | 502 | 503 | 504;
      const provider = err instanceof ProviderError ? err.provider : undefined;
      return c.json(
        {
          type: 'about:blank',
          title: statusTitle(status),
          status,
          detail: 'The requested LLM provider could not complete the request',
          ...(provider ? { provider } : {}),
        },
        status,
      );
    }
  });

  // POST /chat/tokenkiller — TOKENKILLER S0–S3 assembled chat (L2.5, LBI-09)
  router.post('/chat/tokenkiller', zValidator('json', tokenkillerBodySchema), async (c) => {
    const { messages, tokenkiller, model, temperature, maxTokens, policy, provider, egress } =
      c.req.valid('json');
    try {
      const result = await gateway.chatWithTokenKiller(messages, {
        model,
        temperature,
        maxTokens,
        policy,
        provider,
        egress,
        userId: c.get('userId'),
        tokenkiller,
      });
      return c.json(result);
    } catch (err) {
      const status = (err instanceof ProviderError ? err.status : 502) as
        400 | 401 | 402 | 403 | 404 | 408 | 409 | 422 | 429 | 500 | 502 | 503 | 504;
      const provider = err instanceof ProviderError ? err.provider : undefined;
      return c.json(
        {
          type: 'about:blank',
          title: statusTitle(status),
          status,
          detail: 'The requested LLM provider could not complete the request',
          ...(provider ? { provider } : {}),
        },
        status,
      );
    }
  });

  // POST /chat/stream — streaming completion via SSE
  router.post('/chat/stream', zValidator('json', chatBodySchema), async (c) => {
    const { messages, model, temperature, maxTokens, policy, provider, egress } =
      c.req.valid('json');
    const stream = gateway.chatStream(messages, {
      model,
      temperature,
      maxTokens,
      policy,
      provider,
      egress,
      userId: c.get('userId'),
    });

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of await stream) {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ content: chunk })}\n\n`),
              );
            }
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          } catch {
            controller.enqueue(
              new TextEncoder().encode(
                'event: error\ndata: The requested LLM provider could not complete the stream\n\n',
              ),
            );
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
  router.get('/subscriptions/:provider', async (c) => {
    const parsed = subscriptionProviderSchema.safeParse(c.req.param('provider'));
    if (!parsed.success) return c.json({ error: 'Unsupported subscription provider' }, 404);
    try {
      return c.json(await gateway.getSubscriptionStatus(parsed.data, c.get('userId')));
    } catch (err) {
      const status = (err instanceof ProviderError ? err.status : 502) as 401 | 404 | 502 | 503;
      return c.json({ error: 'Unable to read subscription status' }, status);
    }
  });

  router.post('/subscriptions/:provider/login', async (c) => {
    const parsed = subscriptionProviderSchema.safeParse(c.req.param('provider'));
    if (!parsed.success) return c.json({ error: 'Unsupported subscription provider' }, 404);
    const events = gateway.connectSubscription(parsed.data, c.get('userId'), c.req.raw.signal);
    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const message of events) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message })}\n\n`));
            }
            controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'));
          } catch {
            controller.enqueue(
              encoder.encode('event: error\ndata: Subscription login did not complete\n\n'),
            );
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        },
      },
    );
  });

  router.delete('/subscriptions/:provider', async (c) => {
    const parsed = subscriptionProviderSchema.safeParse(c.req.param('provider'));
    if (!parsed.success) return c.json({ error: 'Unsupported subscription provider' }, 404);
    try {
      await gateway.disconnectSubscription(parsed.data, c.get('userId'));
      return c.json({ provider: parsed.data, connected: false });
    } catch (err) {
      const status = (err instanceof ProviderError ? err.status : 502) as 401 | 404 | 502 | 503;
      return c.json({ error: 'Unable to disconnect subscription' }, status);
    }
  });

  router.get('/providers', (c) => {
    return c.json({
      providers: gateway.getAvailableProviders(),
      capabilities: gateway.getProviderCapabilities(),
    });
  });

  // GET /stats — cache stats
  router.get('/stats', (c) => {
    return c.json(gateway.getStats());
  });

  return router;
}
