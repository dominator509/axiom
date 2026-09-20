import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InboxReplies from './InboxReplies';
import LocaleProvider from './LocaleProvider';

it('renders workspace replies in the selected locale', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <InboxReplies
        modelId="model-1"
        connectionId="connection-1"
        counterpartUuid="counterpart-1"
        canPrepare={false}
      />
    </LocaleProvider>,
  );

  expect(html).toContain('Respuestas del espacio de trabajo');
  expect(html).toContain('Cargar historial de respuestas');
  expect(html).not.toContain('Workspace replies');
});
