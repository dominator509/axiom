/** Return net ROI as a percentage. Undefined means no spend denominator exists. */
export function computeRoiPercent(revenueCents: number, costCents: number): number | undefined {
  if (!Number.isSafeInteger(revenueCents) || !Number.isSafeInteger(costCents) || costCents <= 0) return undefined;
  return Math.round(((revenueCents - costCents) / costCents) * 10_000) / 100;
}
