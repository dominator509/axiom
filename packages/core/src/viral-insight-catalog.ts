import type { SupportedLocale, Catalog } from './locale.js';

/** Localized controls for the model-scoped F-85 Relay insight action. */
export const VIRAL_INSIGHT_CATALOGS: Record<SupportedLocale, Catalog> = {
  en: {
    'dashboard.viralInsight.generate': 'Create Relay insight',
    'dashboard.viralInsight.generating': 'Building insight…',
    'dashboard.viralInsight.queued': 'Insight queued ({jobId})',
    'dashboard.viralInsight.notConfirmed': 'Insight enqueue could not be confirmed.',
    'dashboard.viralInsight.retry': 'Insight request could not be confirmed. Check again before retrying.',
  },
  es: {
    'dashboard.viralInsight.generate': 'Crear insight de Relay',
    'dashboard.viralInsight.generating': 'Creando insight…',
    'dashboard.viralInsight.queued': 'Insight en cola ({jobId})',
    'dashboard.viralInsight.notConfirmed': 'No se pudo confirmar la cola del insight.',
    'dashboard.viralInsight.retry': 'No se pudo confirmar la solicitud. Comprueba el estado antes de reintentar.',
  },
  ja: {
    'dashboard.viralInsight.generate': 'Relayインサイトを作成',
    'dashboard.viralInsight.generating': 'インサイトを作成中…',
    'dashboard.viralInsight.queued': 'インサイトをキューに追加しました（{jobId}）',
    'dashboard.viralInsight.notConfirmed': 'インサイトのキュー投入を確認できませんでした。',
    'dashboard.viralInsight.retry': 'リクエストを確認できません。再試行前に状態を確認してください。',
  },
  it: {
    'dashboard.viralInsight.generate': 'Crea insight Relay',
    'dashboard.viralInsight.generating': 'Creazione insight…',
    'dashboard.viralInsight.queued': 'Insight in coda ({jobId})',
    'dashboard.viralInsight.notConfirmed': 'Non è stato possibile confermare la coda dell’insight.',
    'dashboard.viralInsight.retry': 'La richiesta non è stata confermata. Controlla lo stato prima di riprovare.',
  },
  'pt-BR': {
    'dashboard.viralInsight.generate': 'Criar insight do Relay',
    'dashboard.viralInsight.generating': 'Criando insight…',
    'dashboard.viralInsight.queued': 'Insight enfileirado ({jobId})',
    'dashboard.viralInsight.notConfirmed': 'Não foi possível confirmar o enfileiramento do insight.',
    'dashboard.viralInsight.retry': 'Não foi possível confirmar a solicitação. Verifique o status antes de tentar novamente.',
  },
  de: {
    'dashboard.viralInsight.generate': 'Relay-Insight erstellen',
    'dashboard.viralInsight.generating': 'Insight wird erstellt…',
    'dashboard.viralInsight.queued': 'Insight eingereiht ({jobId})',
    'dashboard.viralInsight.notConfirmed': 'Das Einreihen des Insights konnte nicht bestätigt werden.',
    'dashboard.viralInsight.retry': 'Die Anfrage konnte nicht bestätigt werden. Prüfe den Status vor einem neuen Versuch.',
  },
};
