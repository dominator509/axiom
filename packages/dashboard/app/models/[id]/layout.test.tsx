import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog, type SupportedLocale } from '@axiom/core';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), getModel: vi.fn(), getServerLocale: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: mocks.getSession, api: { models: { get: mocks.getModel } } }));
vi.mock('@/lib/server-locale', () => ({ getServerLocale: mocks.getServerLocale }));
vi.mock('@/components/ModelTabs', () => ({ default: ({ modelId }: { modelId: string }) => <div data-tabs-for={modelId} /> }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('next/link', () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));

import ModelLayout from './layout';

const catalog = new LocaleCatalog(CATALOGS);
const localeFor = (locale: SupportedLocale) => ({
  locale,
  t: (key: string, values?: Record<string, string | number>) => catalog.t(locale, key, values),
  dateTime: (value: string | Date) => String(value),
});

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ user: { role: 'owner' } });
  mocks.getModel.mockResolvedValue({ data: { displayName: 'Ari', handle: 'ari', isActive: true } });
  mocks.getServerLocale.mockResolvedValue(localeFor('en'));
});

it.each(['es', 'ja', 'it', 'pt-BR', 'de'] as SupportedLocale[])('localizes the model workspace header in %s', async (locale) => {
  mocks.getServerLocale.mockResolvedValue(localeFor(locale));
  const html = renderToStaticMarkup(await ModelLayout({
    params: Promise.resolve({ id: 'model' }),
    children: <div>child</div>,
  }));
  expect(html).toContain(catalog.t(locale, 'modelSurface.talentPortfolio'));
  expect(html).toContain(catalog.t(locale, 'modelSurface.talentWorkspace'));
  expect(html).toContain(catalog.t(locale, 'modelSurface.active'));
  expect(html).not.toContain(catalog.t('en', 'modelSurface.talentWorkspace'));
  expect(html).toContain('Ari');
  expect(html).toContain('@ari');
});

it('keeps a temporary model API failure out of the not-found boundary', async () => {
  mocks.getModel.mockRejectedValue(Object.assign(new Error('private backend detail'), { status: 429 }));
  const html = renderToStaticMarkup(await ModelLayout({
    params: Promise.resolve({ id: 'model' }),
    children: <div>child</div>,
  }));
  expect(html).toContain('role="alert"');
  expect(html).toContain(catalog.t('en', 'status.error'));
  expect(html).toContain(catalog.t('en', 'error.network'));
  expect(html).toContain('href="/"');
  expect(html).not.toContain('private backend detail');
  expect(html).not.toContain('data-tabs-for');
  expect(mocks.notFound).not.toHaveBeenCalled();
});

it('uses the not-found boundary only when the API confirms the model is missing', async () => {
  mocks.getModel.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
  mocks.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
  await expect(ModelLayout({
    params: Promise.resolve({ id: 'model' }),
    children: <div>child</div>,
  })).rejects.toThrow('NEXT_NOT_FOUND');
  expect(mocks.notFound).toHaveBeenCalledOnce();
});

