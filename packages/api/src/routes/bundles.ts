import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AppBindings } from '../index.js';

const router = new Hono<AppBindings>();

const createBundleSchema = z.object({
  modelId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).optional(),
  captions: z.record(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
});

const updateBundleStateSchema = z.object({
  state: z.enum(['generated', 'approved', 'rejected', 'scheduled', 'publishing', 'published', 'failed']),
});

// List bundles
router.get('/', async (c) => {
  const orgId = c.get('orgId');
  return c.json({ data: [], meta: { total: 0 } });
});

// Get bundle
router.get('/:id', async (c) => {
  const { id } = c.req.param();
  return c.json({ data: null });
});

// Create bundle
router.post('/', zValidator('json', createBundleSchema), async (c) => {
  const body = c.req.valid('json');
  const orgId = c.get('orgId');
  return c.json({ data: { id: crypto.randomUUID(), ...body, orgId, state: 'generated', createdAt: new Date().toISOString() } }, 201);
});

// Update bundle state
router.patch('/:id/state', zValidator('json', updateBundleStateSchema), async (c) => {
  const { id } = c.req.param();
  const { state } = c.req.valid('json');
  return c.json({ data: { id, state } });
});

export { router as bundlesRouter };
