/** Provider-reported charges. Null means unreported or invalid, never free. */
export interface ProviderBilling {
  usd: number | null;
  diem: number | null;
}

export type ProviderBillingObserver = (observation: {
  provider: string;
  model: string;
  billing: ProviderBilling;
}) => void | Promise<void>;

export function normalizeVeniceBilling(cost: unknown): ProviderBilling {
  const value = cost && typeof cost === 'object' ? (cost as Record<string, unknown>) : {};
  const amount = (input: unknown): number | null =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
  return { usd: amount(value.usd), diem: amount(value.diem) };
}

/** Observation failure must never retry a completed, potentially billed request. */
export async function observeProviderBilling(
  observer: ProviderBillingObserver | undefined,
  provider: string,
  model: string,
  billing: ProviderBilling,
): Promise<void> {
  try {
    await observer?.({ provider, model, billing: { ...billing } });
  } catch {
    // Observer errors can contain secrets. Do not log their messages or bodies.
  }
}
