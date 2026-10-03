import { SUPPORTED_LOCALES, type Catalog, type SupportedLocale } from './locale.js';

/** Server-rendered approval-queue messages kept separate from the base catalog. */
export const REVIEW_MESSAGE_KEYS = [
  'review.loadFailed',
  'review.tos.pass',
  'review.tos.review',
  'review.tos.block',
  'review.tos.pending',
  'review.tos.unknown',
  'review.tosRescanAction',
  'review.tosRescanHelp',
  'review.tosRescanQueued',
  'review.tosRescanError',
  'review.tosRescanUnconfirmed',
] as const;

export type ReviewMessageKey = (typeof REVIEW_MESSAGE_KEYS)[number];

const en: Record<ReviewMessageKey, string> = {
  'review.tosRescanAction': 'Retry ToS scan',
  'review.tosRescanHelp': 'The saved media and current captions will be scanned again. This will not generate new media.',
  'review.tosRescanQueued': 'A new scan was queued. Approval stays blocked until the scan passes.',
  'review.tosRescanError': 'The ToS scan retry was not accepted.',
  'review.tosRescanUnconfirmed': 'The request could not be confirmed. Retry the same request or refresh to check its status.',
  'review.loadFailed': 'The review queue could not be loaded. Refresh to try again.',
  'review.tos.pass': 'pass',
  'review.tos.review': 'review',
  'review.tos.block': 'block',
  'review.tos.pending': 'pending',
  'review.tos.unknown': 'unknown',
};

const es: Record<ReviewMessageKey, string> = {
  'review.tosRescanAction': 'Reintentar el análisis de ToS',
  'review.tosRescanHelp': 'Se volverán a analizar el contenido guardado y los textos actuales. No se generará contenido nuevo.',
  'review.tosRescanQueued': 'Se programó un nuevo análisis. La aprobación seguirá bloqueada hasta que se complete correctamente.',
  'review.tosRescanError': 'No se aceptó el reintento del análisis de ToS.',
  'review.tosRescanUnconfirmed': 'No se pudo confirmar la solicitud. Repite la misma solicitud o actualiza para consultar el estado.',
  'review.loadFailed': 'No se pudo cargar la cola de revisión. Actualiza para intentarlo de nuevo.',
  'review.tos.pass': 'aprobado',
  'review.tos.review': 'revisión',
  'review.tos.block': 'bloqueado',
  'review.tos.pending': 'pendiente',
  'review.tos.unknown': 'desconocido',
};

const ja: Record<ReviewMessageKey, string> = {
  'review.tosRescanAction': 'ToSスキャンを再試行',
  'review.tosRescanHelp': '保存済みメディアと現在のキャプションを再スキャンします。新しいメディアは生成しません。',
  'review.tosRescanQueued': '新しいスキャンを登録しました。スキャンが合格するまで承認はブロックされます。',
  'review.tosRescanError': 'ToSスキャンの再試行は受け付けられませんでした。',
  'review.tosRescanUnconfirmed': 'リクエストを確認できませんでした。同じリクエストを再試行するか、更新して状態を確認してください。',
  'review.loadFailed': 'レビューキューを読み込めませんでした。更新して再試行してください。',
  'review.tos.pass': '合格',
  'review.tos.review': '要確認',
  'review.tos.block': 'ブロック',
  'review.tos.pending': '保留中',
  'review.tos.unknown': '不明',
};

const it: Record<ReviewMessageKey, string> = {
  'review.tosRescanAction': 'Riprova la scansione ToS',
  'review.tosRescanHelp': 'Verranno analizzati di nuovo i media salvati e le didascalie attuali. Non verranno generati nuovi media.',
  'review.tosRescanQueued': 'È stata accodata una nuova scansione. L’approvazione resta bloccata finché la scansione non viene superata.',
  'review.tosRescanError': 'Il nuovo tentativo di scansione ToS non è stato accettato.',
  'review.tosRescanUnconfirmed': 'Non è stato possibile confermare la richiesta. Riprova la stessa richiesta o aggiorna per verificarne lo stato.',
  'review.loadFailed': 'Impossibile caricare la coda di revisione. Aggiorna per riprovare.',
  'review.tos.pass': 'superato',
  'review.tos.review': 'da rivedere',
  'review.tos.block': 'bloccato',
  'review.tos.pending': 'in attesa',
  'review.tos.unknown': 'sconosciuto',
};

const ptBR: Record<ReviewMessageKey, string> = {
  'review.tosRescanAction': 'Tentar novamente a verificação de ToS',
  'review.tosRescanHelp': 'A mídia salva e as legendas atuais serão verificadas novamente. Nenhuma mídia nova será gerada.',
  'review.tosRescanQueued': 'Uma nova verificação foi enfileirada. A aprovação continua bloqueada até a verificação ser aprovada.',
  'review.tosRescanError': 'A nova tentativa da verificação de ToS não foi aceita.',
  'review.tosRescanUnconfirmed': 'Não foi possível confirmar a solicitação. Tente a mesma solicitação novamente ou atualize para conferir o status.',
  'review.loadFailed': 'Não foi possível carregar a fila de revisão. Atualize para tentar novamente.',
  'review.tos.pass': 'aprovado',
  'review.tos.review': 'em revisão',
  'review.tos.block': 'bloqueado',
  'review.tos.pending': 'pendente',
  'review.tos.unknown': 'desconhecido',
};

const de: Record<ReviewMessageKey, string> = {
  'review.tosRescanAction': 'ToS-Scan erneut versuchen',
  'review.tosRescanHelp': 'Die gespeicherten Medien und aktuellen Bildtexte werden erneut geprüft. Es werden keine neuen Medien erstellt.',
  'review.tosRescanQueued': 'Ein neuer Scan wurde eingereiht. Die Freigabe bleibt blockiert, bis der Scan bestanden ist.',
  'review.tosRescanError': 'Der erneute ToS-Scan wurde nicht angenommen.',
  'review.tosRescanUnconfirmed': 'Die Anfrage konnte nicht bestätigt werden. Wiederholen Sie dieselbe Anfrage oder aktualisieren Sie den Status.',
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
