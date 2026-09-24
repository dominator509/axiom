import { expect, it } from 'vitest';
import { formatVariantCollectedAt, formatVariantCount, formatVariantMetric, formatVariantPercent, formatVariantPercentValue } from './variant-formatters';

it('formats variant values through the selected locale', () => {
  expect(formatVariantCount(12345, 'de')).toBe('12.345');
  expect(formatVariantMetric(1234.5, 'de')).toBe('1.234,50');
  expect(formatVariantPercentValue(0.1234, 'de')).toBe('12,34');
  expect(formatVariantPercent(0.1234, 'de')).toBe('12,34%');
  expect(formatVariantCollectedAt('2026-09-15T12:00:00Z', 'de')).toBe('15.09.2026, 12:00');
});

it('fails closed for an invalid collection timestamp', () => {
  expect(formatVariantCollectedAt('not-a-date', 'en')).toBe('—');
});
