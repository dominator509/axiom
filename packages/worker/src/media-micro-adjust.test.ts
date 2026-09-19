import { expect, it } from 'vitest';
import { adaptiveMicroAdjustRgba, microAdjustRgba } from './media-micro-adjust.js';
const none = { rgbOffset: [0, 0, 0] as const, rotationDegrees: 0, cropPerEdge: 0 };
it('keeps the source immutable and bounds each channel, not only the mean', () => {
  const source = new Uint8Array([10, 20, 30, 255, 250, 253, 255, 255]);
  const copy = source.slice();
  const result = microAdjustRgba(source, 2, 1, { ...none, rgbOffset: [4, -4, 1] });
  expect(source).toEqual(copy);
  expect(result.pixels).toEqual(new Uint8Array([14, 16, 31, 255, 254, 249, 255, 255]));
  expect(result.receipt.maxChannelDelta).toBe(4);
  expect(result.receipt.normalizedMeanAbsoluteDifference).toBeLessThan(0.02);
  expect(result.receipt.requiresPreviewApproval).toBe(true);
});
it('keeps alpha unchanged and clears invisible RGB', () => {
  const result = microAdjustRgba(new Uint8Array([123, 45, 67, 0, 5, 6, 7, 128]), 2, 1, { ...none, rgbOffset: [1, 1, 1] });
  expect(result.pixels).toEqual(new Uint8Array([0, 0, 0, 0, 6, 7, 8, 128]));
});
it.each([{ ...none, rotationDegrees: 0.051 }, { ...none, cropPerEdge: 0.0011 },
  { ...none, rotationDegrees: NaN }, { ...none, cropPerEdge: -0.001 }, { ...none, rgbOffset: [5, 0, 0] as const }])('rejects out-of-range requests', options => {
  expect(() => microAdjustRgba(new Uint8Array([0, 0, 0, 255]), 1, 1, options)).toThrow('bounds');
});
it('allows bounded rotation/crop of smooth imagery without inventing borders', () => {
  const source = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) source.set([x, y, 100, 255], (y * 64 + x) * 4);
  const result = microAdjustRgba(source, 64, 64, { ...none, rotationDegrees: 0.05, cropPerEdge: 0.001 });
  expect(result.receipt.maxChannelDelta).toBeLessThanOrEqual(4);
  expect(result.pixels.length).toBe(source.length);
});
it('rejects crop at a sharp edge when it violates the total source-relative limit', () => {
  const source = new Uint8Array(4096 * 4);
  for (let x = 0; x < 4096; x++) source.set([x === 0 ? 255 : 0, 0, 0, 255], x * 4);
  expect(() => microAdjustRgba(source, 4096, 1, { ...none, cropPerEdge: 0.001 })).toThrow('channel limit');
});
it('rejects missing borders and transparent geometry rather than silently padding', () => {
  const source = new Uint8Array(64 * 64 * 4).fill(255);
  expect(() => microAdjustRgba(source, 64, 64, { ...none, rotationDegrees: 0.05 })).toThrow('borders');
  source[3] = 0;
  expect(() => microAdjustRgba(source, 64, 64, { ...none, cropPerEdge: 0.001 })).toThrow('opaque');
});
it('halves geometry until a sharp edge stays within the original-relative limit', () => {
  const source = new Uint8Array(4096 * 4);
  for (let x = 0; x < 4096; x++) source.set([x === 0 ? 255 : 0, 0, 0, 255], x * 4);
  const result = adaptiveMicroAdjustRgba(source, 4096, 1, { ...none, cropPerEdge: 0.001 });
  expect(result.adaptation.attempts).toBeGreaterThan(1);
  expect(result.adaptation.attempts).toBeLessThanOrEqual(9);
  expect(result.adaptation.outcome).toBe('adjusted');
  expect(result.receipt.maxChannelDelta).toBeLessThanOrEqual(4);
  expect(result.receipt.cropPerEdge).toBe(0.001 * result.adaptation.scale);
  expect(source[0]).toBe(255);
});
it('returns an unchanged report when no geometric candidate is valid', () => {
  const source = new Uint8Array([100, 110, 120, 128]);
  const result = adaptiveMicroAdjustRgba(source, 1, 1, { ...none, rotationDegrees: 0.05 });
  expect(result.pixels).toEqual(source);
  expect(result.adaptation).toEqual({ attempts: 9, scale: 0, outcome: 'unchanged' });
});
it('does not invent a change when adjustments quantize away or clip', () => {
  const source = new Uint8Array([255, 255, 255, 255]);
  const result = adaptiveMicroAdjustRgba(source, 1, 1, { ...none, rgbOffset: [1, 1, 1] });
  expect(result.pixels).toEqual(source);
  expect(result.adaptation.outcome).toBe('unchanged');
});
it('never converts invalid input into successful unchanged output', () => {
  expect(() => adaptiveMicroAdjustRgba(new Uint8Array(3), 1, 1, none)).toThrow('buffer');
  expect(() => adaptiveMicroAdjustRgba(new Uint8Array(4), 1, 1, { ...none, rgbOffset: [5, 0, 0] })).toThrow('bounds');
});
it('rejects sparse RGB options instead of producing NaN measurements or black pixels', () => {
  const options = { ...none, rgbOffset: new Array(3) as [number, number, number] };
  const source = new Uint8Array([100, 110, 120, 255]);
  expect(() => microAdjustRgba(source, 1, 1, options)).toThrow('bounds');
  expect(() => adaptiveMicroAdjustRgba(source, 1, 1, options)).toThrow('bounds');
});
it('records effective RGB offsets without retaining a mutable caller reference', () => {
  const rgbOffset: [number, number, number] = [1, -1, 0];
  const result = adaptiveMicroAdjustRgba(new Uint8Array([100, 110, 120, 255]), 1, 1, { ...none, rgbOffset });
  rgbOffset[0] = 4;
  expect(result.receipt.rgbOffset).toEqual([1, -1, 0]);
});
