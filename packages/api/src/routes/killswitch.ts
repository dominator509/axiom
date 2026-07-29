import { Hono } from 'hono';
import type { AppBindings } from '../index.js';

const router = new Hono<AppBindings>();

// Global kill switch — when enabled, returns 503 for all non-critical operations
const killSwitchState = {
  enabled: false,
  reason: '',
  startedAt: null as string | null,
  updatedAt: null as string | null,
};

// Check kill switch status
router.get('/killswitch', (c) => {
  return c.json({
    data: killSwitchState,
  });
});

// Enable kill switch
router.post('/killswitch/enable', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  killSwitchState.enabled = true;
  killSwitchState.reason = body.reason ?? 'Emergency shutdown triggered';
  killSwitchState.startedAt = new Date().toISOString();
  killSwitchState.updatedAt = new Date().toISOString();
  return c.json({ data: killSwitchState });
});

// Disable kill switch
router.post('/killswitch/disable', (c) => {
  killSwitchState.enabled = false;
  killSwitchState.reason = '';
  killSwitchState.updatedAt = new Date().toISOString();
  return c.json({ data: killSwitchState });
});

export { router as killswitchRouter };
