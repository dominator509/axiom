import { expect, it } from 'vitest';
import { chooseLearningArm, learningStructure } from './learning-state.js';

it('mines bounded structural arms without retaining persona text', () => {
  expect(learningStructure('Private identity?', null)).toEqual({ arm: 'short:question', context: 'learn-v1:scheduled-utc-unknown' });
  expect(learningStructure('x'.repeat(300), '2026-09-17T18:01:00Z')).toEqual({ arm: 'long:statement', context: 'learn-v1:scheduled-utc-3' });
});
it('does not invent a time bucket for invalid scheduling data', () => {
  expect(learningStructure('vase', 'invalid').context).toBe('learn-v1:scheduled-utc-unknown');
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
