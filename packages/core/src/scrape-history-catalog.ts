import type { Catalog, SupportedLocale } from './locale.js';

const en: Catalog = {
  'scrape.historyColumn': 'History',
  'scrape.benchmarkHistory': 'History ({count})',
  'scrape.observedAt': 'Observed',
};
const es: Catalog = {
  'scrape.historyColumn': 'Historial',
  'scrape.benchmarkHistory': 'Historial ({count})',
  'scrape.observedAt': 'Observado',
};
const ja: Catalog = {
  'scrape.historyColumn': '履歴',
  'scrape.benchmarkHistory': '履歴（{count}件）',
  'scrape.observedAt': '観測日時',
};
const it: Catalog = {
  'scrape.historyColumn': 'Cronologia',
  'scrape.benchmarkHistory': 'Cronologia ({count})',
  'scrape.observedAt': 'Rilevato',
};
const ptBR: Catalog = {
  'scrape.historyColumn': 'Histórico',
  'scrape.benchmarkHistory': 'Histórico ({count})',
  'scrape.observedAt': 'Observado',
};
const de: Catalog = {
  'scrape.historyColumn': 'Verlauf',
  'scrape.benchmarkHistory': 'Verlauf ({count})',
  'scrape.observedAt': 'Beobachtet',
};

export const SCRAPE_HISTORY_CATALOGS: Record<SupportedLocale, Catalog> = {
  en, es, ja, it, 'pt-BR': ptBR, de,
};
export const SCRAPE_HISTORY_MESSAGE_KEYS = Object.keys(en) as Array<keyof typeof en>;
