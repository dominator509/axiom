import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AppBindings } from '../index.js';

const router = new Hono<AppBindings>();

const createModelSchema = z.object({
  displayName: z.string().min(1).max(100),
  handle: z.string().min(1).max(50),
  bio: z.string().max(500).optional(),
});

const updateModelSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  handle: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
});

// List all models
router.get('/', async (c) => {
  const orgId = c.get('orgId');
  // TODO: query db for models by orgId
  return c.json({ data: [], meta: { total: 0 } });
});

// Get single model
router.get('/:id', async (c) => {
  const { id } = c.req.param();
  // TODO: query db
  return c.json({ data: null });
});

// Create model
router.post('/', zValidator('json', createModelSchema), async (c) => {
  const body = c.req.valid('json');
  const orgId = c.get('orgId');
  // TODO: insert into db
  return c.json({ data: { id: crypto.randomUUID(), ...body, orgId } }, 201);
});

// Update model
router.patch('/:id', zValidator('json', updateModelSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid('json');
  // TODO: update in db
  return c.json({ data: { id, ...body } });
});

// Delete model
router.delete('/:id', async (c) => {
  const { id } = c.req.param();
  // TODO: soft delete
  return c.json({ success: true }, 200);
});

export { router as modelsRouter };
