import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MediaBundleCreate from './MediaBundleCreate';

it('offers a caption and destination for a saved asset without generation or publication', () => {
  const html = renderToStaticMarkup(<MediaBundleCreate modelId="model" assetId="asset" mimeType="image/jpeg" />);
  expect(html).toContain('Create post from this media');
  expect(html).toContain('Destination');
  expect(html).toContain('Caption');
  expect(html).toContain('Create review bundle');
  expect(html).toContain('without generating media or publishing');
});
it('explains the required MP4 conversion for WebM', () => {
  const html = renderToStaticMarkup(<MediaBundleCreate modelId="model" assetId="asset" mimeType="video/webm" />);
  expect(html).toContain('transcode it to MP4');
  expect(html).not.toContain('Create review bundle');
});
