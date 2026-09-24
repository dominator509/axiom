import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import LinkbioPostLinkManager from './LinkbioPostLinkManager';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it('renders localized per-post attribution controls and existing links', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="de">
      <LinkbioPostLinkManager
        modelId="model-1"
        posts={[{ id: 'post-1', platform: 'instagram', publishedAt: '2026-09-01T00:00:00Z', caption: 'New post' }]}
        links={[{
          id: 'link-1', slug: 'post-link-1', targetUrl: 'https://fanvue.com/creator',
          postTargetId: 'post-1', clicks: 4, createdAt: '2026-09-01T00:00:00Z',
          path: '/linkbio/model-1/s/post-link-1',
        }]}
        canEdit
      />
    </LocaleProvider>,
  );
  expect(html).toContain('Attributionslinks für Beiträge');
  expect(html).toContain('Tracking-Link erstellen');
  expect(html).toContain('Veröffentlichter Beitrag');
  expect(html).toContain('Fanvue-Profil- oder Angebots-URL');
  expect(html).toContain('/linkbio/model-1/s/post-link-1');
  expect(html).toContain('4 erfasste Klicks');
  expect(html).not.toContain('Create tracked link');
});

it('keeps tracked links readable without showing create controls to read-only users', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <LinkbioPostLinkManager modelId="model-1" posts={[]} links={[]} canEdit={false} />
    </LocaleProvider>,
  );
  expect(html).toContain('No published posts are available');
  expect(html).not.toContain('Create tracked link');
});
