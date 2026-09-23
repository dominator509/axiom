import { expect, it } from 'vitest';
import { matchingModerationKeywords } from './comment-moderation-contract.js';

it('matches literal Unicode-normalized terms without returning comment content', () => {
  expect(matchingModerationKeywords('ＳＰＡＭ link in comments', ['spam', 'link', 'scam'])).toEqual(['spam', 'link']);
  expect(matchingModerationKeywords('ordinary update', ['spam'])).toEqual([]);
});

it('requires complete tokens and supports multiword keyword phrases', () => {
  expect(matchingModerationKeywords('the spammer wrote spam messages in bad faith', ['spam', 'bad faith']))
    .toEqual(['spam', 'bad faith']);
  expect(matchingModerationKeywords('scamper and bad-faith claims', ['scam', 'bad faith'])).toEqual(['bad faith']);
});
