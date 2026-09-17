import { expect, it } from 'vitest';
import { learningStructure } from './learning-state.js';

it('mines bounded structural arms without retaining persona text', () => {
  expect(learningStructure('Private identity?', null)).toEqual({ arm: 'short:question', context: 'learn-v1:scheduled-utc-unknown' });
  expect(learningStructure('x'.repeat(300), '2026-09-17T18:01:00Z')).toEqual({ arm: 'long:statement', context: 'learn-v1:scheduled-utc-3' });
});
it('does not invent a time bucket for invalid scheduling data', () => {
  expect(learningStructure('vase', 'invalid').context).toBe('learn-v1:scheduled-utc-unknown');
});
