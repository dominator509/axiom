import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AppBindings } from '../index.js';

const router = new Hono<AppBindings>();

const createConnectionSchema = z.object({
  modelId: z.string().uuid(),
  platform: z.enum([
    'instagram', 'tiktok', 'x', 'youtube', 'reddit',
    'threads', 'discord', 'telegram', 'facebook', 'snapchat', 'fanvue',
  ]),
  displayName: z.string().min(1).max(100),
  authCode: z.string().optional(),
});

// List connections
router.get('/', async (c) => {
  // TODO: filter by orgId (c.get('orgId'))
  return c.json({ data: [], meta: { total: 0 } });
});

// Get connection
router.get('/:id', async (c) => {
  // TODO: query db with c.req.param('id')
  return c.json({ data: null });
});

// Create connection (OAuth initiation)
router.post('/', zValidator('json', createConnectionSchema), async (c) => {
  const body = c.req.valid('json');
  const orgId = c.get('orgId');
  return c.json({ data: { id: crypto.randomUUID(), ...body, orgId, status: 'active', connectedAt: new Date().toISOString() } }, 201);
});

// Revoke connection
router.post('/:id/revoke', async (c) => {
  const { id } = c.req.param();
  return c.json({ data: { id, status: 'revoked' } });
});

// Refresh token
router.post('/:id/refresh', async (c) => {
  const { id } = c.req.param();
  return c.json({ data: { id, status: 'refreshed' } });
});

export { router as socialRouter };
