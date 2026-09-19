import { expect, it, vi } from 'vitest';
import { classifyPersistedScrapeRunState } from '@axiom/core';
import { readScrapeResult, validateScrapeEvidence } from './scrape.js';
it('reads a valid result', async () => {
  await expect(readScrapeResult(new Response('{"platform":"instagram","followers":12}'))).resolves.toMatchObject({ followers: 12 });
});
it('cancels an oversized chunked response before consuming the rest', async () => {
  const cancel = vi.fn();
  let chunks = 0;
  const response = new Response(new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(300_000)); }, cancel,
  }));
  await expect(readScrapeResult(response)).rejects.toThrow('maximum supported size');
  expect(cancel).toHaveBeenCalledOnce();
  expect(chunks).toBeLessThanOrEqual(3);
});
it('cancels HTTP error bodies without exposing them', async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { status: 503 });
  await expect(readScrapeResult(response)).rejects.toThrow('scraper returned HTTP 503');
  expect(cancel).toHaveBeenCalledOnce();
});
it.each(['null', '[]', '{}', '42', '"text"'])('rejects invalid result envelope %s', async body => {
  await expect(readScrapeResult(new Response(body))).rejects.toThrow('empty or invalid result');
});
it('does not echo malformed provider content in parsing errors', async () => {
  await expect(readScrapeResult(new Response('private response content'))).rejects.toThrow(/^scraper returned invalid JSON$/);
});
it('distinguishes missing counts from observed zero', () => {
  expect(() => validateScrapeEvidence({ followers: null, posts: null }, 'social')).toThrow('no observable');
  expect(() => validateScrapeEvidence({ followers: 0, posts: null }, 'social')).not.toThrow();
});
it('does not complete a competitor run with only failed or empty lookups', () => {
  expect(() => validateScrapeEvidence({ results: [{ error: 'HTTP failure', followers: 0 }, { error: null, followers: null }] }, 'competitor')).toThrow('no observable');
  expect(() => validateScrapeEvidence({ results: [{ error: null, followers: 12 }, { error: 'HTTP failure' }] }, 'competitor')).not.toThrow();
});
it('persists a mixed competitor response as partial', () => {
  expect(classifyPersistedScrapeRunState('competitor', { results: [{ followers: 12 }, { error: 'HTTP failure' }] })).toBe('partial');
});
