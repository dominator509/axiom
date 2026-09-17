import { expect, it } from 'vitest';
import { inboxMediaMetadata } from './inbox-media.js';

it('projects attachment metadata without signed URLs, provider names or errors', () => {
  const result = inboxMediaMetadata({ results: {
    a: { uuid: 'a', messageUuid: 'message', ownerUuid: 'private-owner', mediaType: 'video', created_at: null,
      sentAt: null, name: 'private-filename', purchasedAt: null, pricing: { USD: { price: 1200 } },
      amountPaid: { USD: { price: 900 } }, variants: [{ variantType: 'main', displayPosition: 0,
        url: 'https://provider.invalid/private?signature=secret', width: 720, height: 1280, lengthMs: 6000 }] },
    b: null,
  }, errors: [{ mediaUuid: 'b', code: 'INTERNAL' }] }, 'message', ['b', 'a']);
  expect(result).toEqual({ kind: 'attachments', messageUuid: 'message', data: [
    { uuid: 'b', available: false },
    { uuid: 'a', available: true, mediaType: 'video', purchasedAt: null,
      pricing: { USD: { price: 1200 } }, amountPaid: { USD: { price: 900 } },
      variants: [{ variantType: 'main', width: 720, height: 1280, lengthMs: 6000 }] },
  ] });
  expect(JSON.stringify(result)).not.toMatch(/private|signature|secret|INTERNAL|https:/);
});

it('does not invent previews or purchases for absent fields', () => {
  const result = inboxMediaMetadata({ results: { a: { uuid: 'a', messageUuid: 'message', ownerUuid: 'owner',
    mediaType: 'unknown', created_at: null, sentAt: null, name: null } }, errors: [] }, 'message', ['a']);
  expect(result.data[0]).toMatchObject({ variants: [], purchasedAt: null, pricing: null, amountPaid: null });
});
