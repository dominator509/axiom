import { describe, expect, it } from 'vitest';
import { classifyPersistedScrapeRunState } from './scrape-result.js';

describe('classifyPersistedScrapeRunState', () => {
  it('persists observable social evidence as completed', () => {
    expect(classifyPersistedScrapeRunState('social', { followers: 0 })).toBe('completed');
  });

  it('fails social results with no observable evidence or an error', () => {
    expect(classifyPersistedScrapeRunState('social', { followers: null })).toBe('failed');
    expect(classifyPersistedScrapeRunState('social', { followers: 12, error: 'unavailable' })).toBe('failed');
  });

  it('persists mixed competitor evidence as partial', () => {
    expect(classifyPersistedScrapeRunState('competitor', {
      results: [{ followers: 12 }, { error: 'unavailable' }],
    })).toBe('partial');
  });

  it('never persists an all-failed or malformed result as completed', () => {
    expect(classifyPersistedScrapeRunState('competitor', { results: [{ error: 'unavailable' }] })).toBe('failed');
    expect(classifyPersistedScrapeRunState('competitor', { results: [] })).toBe('failed');
    expect(classifyPersistedScrapeRunState('competitor', null)).toBe('failed');
  });
});
