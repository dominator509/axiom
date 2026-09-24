import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import MediaPromptSuggestion from './MediaPromptSuggestion';

function render(locale: 'it' | 'de') {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <MediaPromptSuggestion modelId="model-1" bundleId="bundle-1" disabled={false} onUse={() => undefined} />
    </LocaleProvider>,
  );
}

it('localizes provider-revision consent and keeps the request text-only in Italian', () => {
  const html = render('it');
  expect(html).toContain('Suggerimento per il prompt dei media');
  expect(html).toContain('Approvo una richiesta testuale al provider generatore');
  expect(html).toContain('Chiedi al provider una revisione minima');
});

it('localizes the provider-consent boundary in German', () => {
  const html = render('de');
  expect(html).toContain('Medien-Prompt-Vorschlag');
  expect(html).toContain('Ich genehmige eine Textanfrage an den generierenden Provider');
});
