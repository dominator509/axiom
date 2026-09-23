import { expect, it } from 'vitest';
import { computeRoiPercent } from './linkbio-roi.js';

it('computes net ROI from observed revenue and spend in the same minor currency unit', () => {
  expect(computeRoiPercent(1_500, 1_000)).toBe(50);
  expect(computeRoiPercent(500, 1_000)).toBe(-50);
});

it('does not invent ROI when spend is missing or malformed', () => {
  expect(computeRoiPercent(1_000, 0)).toBeUndefined();
  expect(computeRoiPercent(Number.NaN, 100)).toBeUndefined();
});
