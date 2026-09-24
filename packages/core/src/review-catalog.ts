import { SUPPORTED_LOCALES, type Catalog, type SupportedLocale } from './locale.js';

/** Server-rendered approval-queue messages kept separate from the base catalog. */
export const REVIEW_MESSAGE_KEYS = [
  'review.loadFailed',
  'review.tos.pass',
  'review.tos.review',
  'review.tos.block',
  'review.tos.pending',
  'review.tos.unknown',
] as const;

export type ReviewMessageKey = (typeof REVIEW_MESSAGE_KEYS)[number];

const en: Record<ReviewMessageKey, string> = {
  'review.loadFailed': 'The review queue could not be loaded. Refresh to try again.',
  'review.tos.pass': 'pass',
  'review.tos.review': 'review',
  'review.tos.block': 'block',
  'review.tos.pending': 'pending',
  'review.tos.unknown': 'unknown',
};

const es: Record<ReviewMessageKey, string> = {
  'review.loadFailed': 'No se pudo cargar la cola de revisión. Actualiza para intentarlo de nuevo.',
  'review.tos.pass': 'aprobado',
  'review.tos.review': 'revisión',
  'review.tos.block': 'bloqueado',
  'review.tos.pending': 'pendiente',
  'review.tos.unknown': 'desconocido',
};

const ja: Record<ReviewMessageKey, string> = {
  'review.loadFailed': 'レビューキューを読み込めませんでした。更新して再試行してください。',
  'review.tos.pass': '合格',
  'review.tos.review': '要確認',
  'review.tos.block': 'ブロック',
  'review.tos.pending': '保留中',
  'review.tos.unknown': '不明',
};

const it: Record<ReviewMessageKey, string> = {
  'review.loadFailed': 'Impossibile caricare la coda di revisione. Aggiorna per riprovare.',
  'review.tos.pass': 'superato',
  'review.tos.review': 'da rivedere',
  'review.tos.block': 'bloccato',
  'review.tos.pending': 'in attesa',
  'review.tos.unknown': 'sconosciuto',
};

const ptBR: Record<ReviewMessageKey, string> = {
  'review.loadFailed': 'Não foi possível carregar a fila de revisão. Atualize para tentar novamente.',
  'review.tos.pass': 'aprovado',
  'review.tos.review': 'em revisão',
  'review.tos.block': 'bloqueado',
  'review.tos.pending': 'pendente',
  'review.tos.unknown': 'desconhecido',
};

const de: Record<ReviewMessageKey, string> = {
  'review.loadFailed': 'Die Prüfwarteschlange konnte nicht geladen werden. Aktualisieren Sie die Seite und versuchen Sie es erneut.',
  'review.tos.pass': 'bestanden',
  'review.tos.review': 'zu prüfen',
  'review.tos.block': 'blockiert',
  'review.tos.pending': 'ausstehend',
  'review.tos.unknown': 'unbekannt',
};

export const REVIEW_CATALOGS: Record<SupportedLocale, Catalog> = {
  en,
  es,
  ja,
  it,
  'pt-BR': ptBR,
  de,
};

export function reviewCatalogIsComplete(locale: SupportedLocale): boolean {
  return REVIEW_MESSAGE_KEYS.every((key) => typeof REVIEW_CATALOGS[locale][key] === 'string');
}

export const REVIEW_CATALOG_LOCALES = SUPPORTED_LOCALES;
