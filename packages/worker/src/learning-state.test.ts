import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { chooseLearningArm, learningContextForArm, learningStructure } from './learning-state.js';

it('mines bounded structural arms without retaining persona text', () => {
  expect(learningStructure('Private identity?', null)).toEqual({ arm: 'short:question', context: 'learn-v1:scheduled-utc-unknown' });
  expect(learningStructure('x'.repeat(300), '2026-09-17T18:01:00Z')).toEqual({ arm: 'long:statement', context: 'learn-v1:scheduled-utc-3' });
});
it('does not invent a time bucket for invalid scheduling data', () => {
  expect(learningStructure('vase', 'invalid').context).toBe('learn-v1:scheduled-utc-unknown');
});
it('uses a verified caption receipt for the richer versioned arm namespace', () => {
  const caption = 'Question-led ceramic vase';
  const receipt = {
    version: 'caption-guidance-v1' as const,
    selectedArm: 'short:question',
    context: 'learn-v1:scheduled-utc-unknown',
    exemplarIds: [],
    captionSha256: createHash('sha256').update(caption).digest('hex'),
    hookType: 'question',
    format: 'reel',
  };
  expect(learningStructure(caption, '2026-09-17T09:00:00Z', receipt)).toEqual({
    arm: 'v2:short:statement:hook=question:format=reel',
    context: 'learn-v2:scheduled-utc-1',
    version: 'learn-v2',
    evidence: { hookType: 'question', format: 'reel' },
  });
  expect(learningContextForArm('v2:short:statement:hook=question:format=reel', null)).toBe('learn-v2:scheduled-utc-unknown');
  expect(learningStructure(caption, null, { ...receipt, captionSha256: '0'.repeat(64) }).context).toBe('learn-v1:scheduled-utc-unknown');
});
it('preserves a verified timing bucket in the richer arm without inferring it', () => {
  const caption = 'Timing-aware caption';
  const receipt = {
    version: 'caption-guidance-v1' as const,
    selectedArm: 'short:statement',
    context: 'learn-v1:scheduled-utc-unknown',
    exemplarIds: [],
    captionSha256: createHash('sha256').update(caption).digest('hex'),
    hookType: 'story',
    format: 'single',
    timingBucket: 'morning' as const,
    postingHourUtc: 9,
  };
  expect(learningStructure(caption, '2026-09-17T09:00:00Z', receipt)).toMatchObject({
    arm: 'v2:short:statement:hook=story:format=single:time=morning',
    evidence: { hookType: 'story', format: 'single', timingBucket: 'morning', postingHourUtc: 9 },
  });
  expect(learningStructure(caption, '2026-09-17T09:00:00Z', { ...receipt, timingBucket: undefined })).toMatchObject({
    arm: 'v2:short:statement:hook=story:format=single',
    evidence: { hookType: 'story', format: 'single', postingHourUtc: 9 },
  });
});

function seeded() {
  let state = 731;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
it('favors learned success while preserving exploration', () => {
  const rng = seeded();
  const arms = [{ arm: 'high', alpha: 100, beta: 1, recentUses: 0 }, { arm: 'low', alpha: 1, beta: 100, recentUses: 0 }];
  const choices = Array.from({ length: 500 }, () => chooseLearningArm(arms, rng));
  expect(choices.filter(arm => arm === 'high').length).toBeGreaterThan(450);
  expect(choices).toContain('low');
});
it('penalizes recently repeated structures', () => {
  const rng = seeded();
  const arms = [{ arm: 'fatigued', alpha: 100, beta: 1, recentUses: 20 }, { arm: 'fresh', alpha: 10, beta: 10, recentUses: 0 }];
  const choices = Array.from({ length: 500 }, () => chooseLearningArm(arms, rng));
  expect(choices.filter(arm => arm === 'fresh').length).toBeGreaterThan(450);
});
it('handles fractional posteriors and rejects invalid state', () => {
  expect(chooseLearningArm([{ arm: 'one', alpha: 1.4, beta: 2.6, recentUses: 0 }], seeded())).toBe('one');
  expect(chooseLearningArm([])).toBeNull();
  expect(() => chooseLearningArm([{ arm: 'bad', alpha: NaN, beta: 1, recentUses: 0 }])).toThrow('Invalid learning posterior');
});
