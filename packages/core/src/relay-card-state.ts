// ─── Relay card delivery state (F-85 ↔ F-28, L2.7) ─────────────────────────
// A relay_card row is durable evidence of an internal card lifecycle. It is
// not, by itself, proof that an external channel accepted anything.

export const RELAY_CARD_STATES = ['stored', 'pending', 'sent', 'failed', 'unknown'] as const;

export type RelayCardState = (typeof RELAY_CARD_STATES)[number];

/** States that mean the card crossed the provider-dispatch boundary. */
export const RELAY_CARD_DISPATCHED_STATES: ReadonlySet<RelayCardState> = new Set([
  'pending',
  'sent',
  'failed',
  'unknown',
]);

export type RelayCardExternalDelivery = 'not-attempted' | 'attempted' | 'unknown';

/**
 * Map a persisted state to the least-claiming external-delivery statement.
 * Unknown values remain unknown rather than being presented as not attempted.
 */
export function relayCardExternalDelivery(
  state: string | null | undefined,
): RelayCardExternalDelivery {
  if (state === 'stored') return 'not-attempted';
  if (state === 'pending' || state === 'sent' || state === 'failed') return 'attempted';
  return 'unknown';
}

/** True only for recognized states that imply a dispatch attempt or marker. */
export function isExternallyDispatched(state: string | null | undefined): boolean {
  return typeof state === 'string' && RELAY_CARD_DISPATCHED_STATES.has(state as RelayCardState);
}
