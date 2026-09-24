import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FanvueAnalyticsCard from './FanvueAnalyticsCard';
import LocaleProvider from './LocaleProvider';

it('renders Fanvue account analytics in the selected locale', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <FanvueAnalyticsCard modelId="model-1" canSync />
    </LocaleProvider>,
  );

  expect(html).toContain('Analítica de la cuenta de Fanvue');
  expect(html).toContain('Sincronizar analítica de Fanvue');
  expect(html).not.toContain('Fanvue account analytics');
});
