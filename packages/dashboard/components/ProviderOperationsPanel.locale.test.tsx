import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import ProviderOperationsPanel, { moderationOptionsForCapabilities } from './ProviderOperationsPanel';

it('exposes only exact provider-advertised moderation actions to the UI', () => {
  expect(moderationOptionsForCapabilities(['comments.moderate', 'comments.moderate.delete', 'comments.moderate.block']).map(item => item.action))
    .toEqual(['delete', 'block']);
  expect(moderationOptionsForCapabilities(['comments.moderate'])).toEqual([]);
});

it('renders localized provider comment controls only for granted capabilities', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <ProviderOperationsPanel
        modelId="model-1"
        connectionId="connection-1"
        capabilities={['comments.read', 'comments.reply', 'comments.moderate', 'messages.send']}
      />
    </LocaleProvider>,
  );

  expect(html).toContain('Acciones de comunidad');
  expect(html).toContain('ID de la publicación');
  expect(html).toContain('Cargar comentarios');
  expect(html).toContain('Destinatario o ID del chat');
  expect(html).toContain('Enviar mensaje');
  // Reply/moderation actions are rendered only after the provider returns actual comments.
  expect(html).not.toContain('Responder al comentario');
  expect(html).not.toContain('Ocultar comentario');
});

it('renders Fanvue Vault controls from granted capabilities with localized labels', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <ProviderOperationsPanel
        modelId="model-1"
        connectionId="connection-1"
        capabilities={[
          'vault.folders.read', 'vault.folder.create', 'vault.folder.rename', 'vault.folder.delete',
          'vault.media.read', 'vault.media.add', 'vault.media.remove', 'vault.media.update',
        ]}
      />
    </LocaleProvider>,
  );

  expect(html).toContain('Bóveda de Fanvue');
  expect(html).toContain('Cargar carpetas');
  expect(html).toContain('Crear carpeta');
  expect(html).not.toContain('Acciones de comunidad');
});

it('renders provider messaging when it is granted without comment-read access', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <ProviderOperationsPanel modelId="model-1" connectionId="connection-1" capabilities={['messages.send']} />
    </LocaleProvider>,
  );

  expect(html).toContain('Recipient or chat ID');
  expect(html).toContain('Send message');
  expect(html).not.toContain('Load comments');
});

it('renders inbox reading separately from sending when each provider capability is granted', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <ProviderOperationsPanel modelId="model-1" connectionId="connection-1" capabilities={['messages.read']} />
    </LocaleProvider>,
  );
  expect(html).toContain('Load messages');
  expect(html).not.toContain('Send message');
});

it('renders YouTube channel operations only from the connection capability manifest', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <ProviderOperationsPanel modelId="model-1" connectionId="connection-1" capabilities={[
        'youtube.playlists.read', 'youtube.playlist.create', 'youtube.thumbnail.set', 'youtube.captions.upload',
      ]} />
    </LocaleProvider>,
  );
  expect(html).toContain('Load playlists');
  expect(html).toContain('Create playlist');
  expect(html).toContain('Set thumbnail');
  expect(html).toContain('Upload caption track');
  expect(html).not.toContain('Delete caption track');
});

it('does not render an operation surface when no provider operations were granted', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <ProviderOperationsPanel modelId="model-1" connectionId="connection-1" capabilities={[]} />
    </LocaleProvider>,
  );

  expect(html).toBe('');
});
