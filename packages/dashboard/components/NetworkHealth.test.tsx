import { expect, it } from 'vitest';
import { describeNetworkHealth } from './NetworkHealth';
const response = (live: unknown) => ({ data: { modelId: 'model', live, db: { healthy: true } } });
it('never treats a saved healthy flag as live protection', () => {
  expect(describeNetworkHealth(response(null), 'model')).toContain('No live connection confirmed');
});
it('distinguishes direct, unhealthy and incomplete observations', () => {
  expect(
    describeNetworkHealth(response({ model_id: 'model', mode: 'direct', healthy: true }), 'model'),
  ).toContain('not protected');
  expect(describeNetworkHealth(response({ model_id: 'model', healthy: false }), 'model')).toContain(
    'unhealthy',
  );
  expect(describeNetworkHealth(response({ model_id: 'model', healthy: true }), 'model')).toContain(
    'verification is incomplete',
  );
});
it('shows observed outbound IP only for matching healthy connection', () => {
  expect(
    describeNetworkHealth(
      response({ model_id: 'model', healthy: true, egress_ip: '203.0.113.4' }),
      'model',
    ),
  ).toContain('203.0.113.4');
  expect(() =>
    describeNetworkHealth(response({ model_id: 'other', healthy: true }), 'model'),
  ).toThrow();
});
