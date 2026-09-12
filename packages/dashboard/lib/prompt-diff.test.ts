import { expect, it } from 'vitest';
import { promptDiff } from './prompt-diff';

it.each([
  ['A red vase', 'A blue vase'], ['A vase', 'A tall vase'], ['A tall vase', 'A vase'],
  ['Same', 'Same'], ['', 'New'], ['Old', ''], ['🌅 view', '🌄 view'],
  ['a red vase in shade', 'a blue vase in sun'],
])('preserves both exact prompts: %s -> %s', (before, after) => {
  const diff = promptDiff(before, after);
  expect(diff.prefix + diff.removed + diff.suffix).toBe(before);
  expect(diff.prefix + diff.added + diff.suffix).toBe(after);
});
it('isolates the changed word while retaining surrounding text', () => {
  expect(promptDiff('A red vase', 'A blue vase')).toEqual({ prefix: 'A ', removed: 'red', added: 'blue', suffix: ' vase' });
});
it('does not split surrogate pairs', () => {
  expect(promptDiff('🌅 view', '🌄 view')).toEqual({ prefix: '', removed: '🌅', added: '🌄', suffix: ' view' });
});
