import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatNumber } from '@axiom/core';
import LocaleProvider from './LocaleProvider';
import InboxAttachments, { AttachmentPreview, formatAttachmentOrdinal } from './InboxAttachments';

const id = '11111111-1111-4111-8111-111111111111';
const scope = { modelId: id, connectionId: id, userUuid: id, messageUuid: id, mediaUuids: [id] };
const item = {
  uuid: id,
  available: true,
  mediaType: 'image',
  variants: [{ variantType: 'main', width: 800, height: 1000, lengthMs: null }],
};

it('uses the persisted Spanish catalog for attachment preview controls', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <AttachmentPreview scope={scope} item={item} />
    </LocaleProvider>,
  );
  expect(html).toContain('Variante de vista previa');
  expect(html).toContain('Mostrar vista previa');
  expect(html).not.toContain('Preview variant');
});

it('uses the persisted Spanish catalog for attachment loading states', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <InboxAttachments {...scope} />
    </LocaleProvider>,
  );
  expect(html).toContain('Cargar detalles de los archivos adjuntos');
  expect(html).toContain('archivo(s) adjunto(s)');
  expect(html).not.toContain('Load attachment details');
});

it('formats the attachment summary count through the selected locale', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="de">
      <InboxAttachments {...scope} mediaUuids={Array.from({ length: 12 }, () => id)} />
    </LocaleProvider>,
  );
  expect(html).toContain(`${formatNumber(12, 'de')} Anhang/Anhänge`);
});

it('formats attachment ordinals through the selected locale', () => {
  expect(formatAttachmentOrdinal(1234, 'de')).toBe('1.234');
  expect(formatAttachmentOrdinal(1234, 'ja')).toBe('1,234');
});
