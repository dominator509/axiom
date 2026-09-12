import { expect, it } from 'vitest';
import { characterLockSnapshot, buildMediaPrompt } from './media-prompt.js';

it('preserves legacy scenes without adding a current profile lock', () => {
  expect(buildMediaPrompt('A scene', characterLockSnapshot({}))).toBe('A scene');
});
it('includes the exact immutable lock and scene', () => {
  const lock = { characterLockPrompt: 'Green eyes\nDistinctive freckles', characterLockVersion: 7 };
  expect(buildMediaPrompt('At the beach', lock)).toBe('CHARACTER / PERSONA — preserve this identity:\nGreen eyes\nDistinctive freckles\n\nSCENE:\nAt the beach');
  expect(characterLockSnapshot(lock)).toEqual(lock);
});
it.each([
  { characterLockPrompt: 'Missing revision' }, { characterLockVersion: 1 },
  { characterLockPrompt: '', characterLockVersion: -1 },
  { characterLockPrompt: 'x'.repeat(2001), characterLockVersion: 1 },
])('rejects malformed snapshots instead of dropping the lock', input => {
  expect(() => characterLockSnapshot(input)).toThrow('Invalid character lock snapshot');
});
it('rejects combined overflow without truncation', () => {
  expect(() => buildMediaPrompt('x'.repeat(3000), { characterLockPrompt: 'y'.repeat(1500), characterLockVersion: 1 })).toThrow('4000-character');
});
