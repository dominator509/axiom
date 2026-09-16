import { expect, it } from 'vitest';
import { contactPayload } from './FanContactForm';

function fields(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
it('matches the scoped API payload and preserves omitted optional fields', () => {
  expect(contactPayload('model', fields({ platform: ' fanvue ', externalId: ' 123 ' })))
    .toEqual({ modelId: 'model', platform: 'fanvue', externalId: '123' });
});
it('preserves explicit zero and selected tier', () => {
  expect(contactPayload('model', fields({ platform: 'x', externalId: '123', lifetimeValueUsd: '0', tier: 'loyal' })))
    .toMatchObject({ lifetimeValueUsd: 0, tier: 'loyal' });
});
it.each(['-1', 'NaN', 'Infinity'])('rejects invalid money %s', amount => {
  expect(() => contactPayload('model', fields({ platform: 'x', externalId: '123', lifetimeValueUsd: amount }))).toThrow();
});
it('requires the provider identity', () => {
  expect(() => contactPayload('model', fields({ platform: 'x' }))).toThrow();
});
