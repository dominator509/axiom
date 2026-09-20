import { expect, it } from 'vitest';
import { captionGuidanceReceipt, matchingCaptionGuidance } from './caption-guidance.js';

it('records the selection and exemplar identities without storing prompt or caption text', () => {
  const receipt = captionGuidanceReceipt('Private caption?', { selectedArm: 'short:question',
    context: 'learn-v1:scheduled-utc-unknown', exemplars: [{ id: 'exemplar' }] });
  expect(receipt).toMatchObject({ version: 'caption-guidance-v1', selectedArm: 'short:question', exemplarIds: ['exemplar'] });
  expect(receipt.captionSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(receipt)).not.toContain('Private caption');
  expect(matchingCaptionGuidance('Private caption?', receipt)).toEqual(receipt);
  expect(matchingCaptionGuidance('Edited caption?', receipt)).toBeNull();
  expect(matchingCaptionGuidance('Private caption? ', receipt)).toBeNull();
});
it('does not invent guidance for legacy/manual captions and preserves an empty selection honestly', () => {
  expect(matchingCaptionGuidance('Manual caption', undefined)).toBeNull();
  const receipt = captionGuidanceReceipt('Generated', { selectedArm: null, context: 'learn-v1:scheduled-utc-unknown', exemplars: [] });
  expect(receipt.selectedArm).toBeNull(); expect(receipt.exemplarIds).toEqual([]);
});
it('persists only bounded evidence supplied by the server-side selector', () => {
  const receipt = captionGuidanceReceipt('Generated?', {
    selectedArm: 'v2:short:question:hook=question:format=reel',
    context: 'learn-v2:scheduled-utc-1',
    exemplars: [],
    guidanceEvidence: { hookType: 'question', format: 'reel', postingHourUtc: 9, timingBucket: 'morning' },
  });
  expect(receipt).toMatchObject({ hookType: 'question', format: 'reel', postingHourUtc: 9, timingBucket: 'morning' });
  expect(captionGuidanceReceipt('Generated?', {
    selectedArm: null, context: 'learn-v2:scheduled-utc-1', exemplars: [], guidanceEvidence: { hookType: 'untrusted' },
  })).not.toHaveProperty('hookType');
});
