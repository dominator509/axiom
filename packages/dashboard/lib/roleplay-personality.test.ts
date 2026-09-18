import { expect, it } from 'vitest';
import { getRoleplayPersonalitySuggestion, ROLEPLAY_PERSONALITY_SUGGESTIONS } from './roleplay-personality';

it('provides bounded, distinct personality suggestions', () => {
  expect(ROLEPLAY_PERSONALITY_SUGGESTIONS.length).toBeGreaterThanOrEqual(4);
  expect(new Set(ROLEPLAY_PERSONALITY_SUGGESTIONS.map(suggestion => suggestion.key)).size).toBe(ROLEPLAY_PERSONALITY_SUGGESTIONS.length);
  expect(ROLEPLAY_PERSONALITY_SUGGESTIONS.every(suggestion => suggestion.content.length > 0 && suggestion.content.length <= 8_000)).toBe(true);
});

it('resolves a selected suggestion without inventing a fallback', () => {
  const suggestion = getRoleplayPersonalitySuggestion('warm-playful');
  expect(suggestion?.label).toBe('Warm & playful');
  expect(getRoleplayPersonalitySuggestion('missing')).toBeNull();
});
