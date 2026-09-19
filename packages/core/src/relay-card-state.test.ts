import { describe, expect, it } from 'vitest';
import {
  RELAY_CARD_DISPATCHED_STATES,
  RELAY_CARD_STATES,
  isExternallyDispatched,
  relayCardExternalDelivery,
} from './relay-card-state.js';

describe('relay card delivery state contract', () => {
  it('declares the persisted lifecycle vocabulary', () => {
    expect(RELAY_CARD_STATES).toEqual(['stored', 'pending', 'sent', 'failed', 'unknown']);
  });

  it('keeps stored cards separate from external dispatch', () => {
    expect(RELAY_CARD_DISPATCHED_STATES.has('stored')).toBe(false);
    expect(isExternallyDispatched('stored')).toBe(false);
    expect(relayCardExternalDelivery('stored')).toBe('not-attempted');
  });

  it('reports provider-bound lifecycle states without claiming acceptance', () => {
    for (const state of ['pending', 'sent', 'failed'] as const) {
      expect(isExternallyDispatched(state)).toBe(true);
      expect(relayCardExternalDelivery(state)).toBe('attempted');
    }
  });

  it('keeps uncertain and unrecognized states fail-closed', () => {
    expect(isExternallyDispatched('unknown')).toBe(true);
    expect(relayCardExternalDelivery('unknown')).toBe('unknown');
    expect(isExternallyDispatched('delivered')).toBe(false);
    expect(relayCardExternalDelivery('delivered')).toBe('unknown');
    expect(relayCardExternalDelivery(null)).toBe('unknown');
  });
});
