import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import PostTeamNotes from './PostTeamNotes';

it('renders post-note controls from the persisted German catalog', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="de">
      <PostTeamNotes modelId="model" postId="post" canEdit />
    </LocaleProvider>,
  );
  expect(html).toContain('Interne Beitragsnotizen');
  expect(html).toContain('Beitragsnotiz speichern');
  expect(html).toContain('Neueste Notizen laden');
  expect(html).not.toContain('Internal post notes');
});
