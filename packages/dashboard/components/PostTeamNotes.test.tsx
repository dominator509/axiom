import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PostTeamNotes, { isPostNote } from './PostTeamNotes';
it('displays a post-specific internal workflow and hides editing from viewers', () => {
  const viewer = renderToStaticMarkup(<PostTeamNotes modelId="m" postId="p" canEdit={false} />);
  expect(viewer).toContain('Internal post notes'); expect(viewer).toContain('Load latest notes');
  expect(viewer).toContain('never published as captions'); expect(viewer).not.toContain('<textarea');
  expect(renderToStaticMarkup(<PostTeamNotes modelId="m" postId="p" canEdit />)).toContain('Save post note');
});
it('does not accept a receipt for a different model, post or target type', () => {
  const note = { id: 'n', modelId: 'm', targetType: 'post', targetId: 'p', body: 'Note', authorUserId: 'u', createdAt: '2030-01-01T00:00:00Z' };
  expect(isPostNote(note, 'm', 'p')).toBe(true);
  for (const change of [{ modelId: 'other' }, { targetId: 'other' }, { targetType: 'model' }, { body: {} }, { createdAt: 'bad' }])
    expect(isPostNote({ ...note, ...change }, 'm', 'p')).toBe(false);
});
