import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('./LocaleProvider', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => ({
  'team.postNotesSummary': 'Internal post notes',
  'team.loadLatestPostNotes': 'Load latest notes',
  'team.postNotesDescription': 'Workspace-only notes attached to this post, never published as captions.',
  'team.savePostNote': 'Save post note',
  'team.retryPostNote': 'Retry same note',
  'team.postNotesLoadFailed': 'Post notes could not be loaded. Try again.',
  'team.postNoteSaveUnconfirmed': 'Save not confirmed. Retry the same note; do not create a duplicate.',
  'team.postNoteSaved': 'Internal note saved. Nothing was sent to the social platform.',
  'team.noPostNotes': 'No notes for this post yet.',
  'team.loadOlderPostNotes': 'Load older notes',
  'team.newPostNote': 'New internal note',
}[key] ?? key) }) }));
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
