import { SUPPORTED_LOCALES, type Catalog, type SupportedLocale } from './locale.js';

/** Queue and worker states shown before a generated asset is attached. */
export const GENERATION_STATUS_MESSAGE_KEYS = [
  'generation.checking',
  'generation.queued',
  'generation.running',
  'generation.queueDelayed',
  'generation.workerTooLong',
  'generation.failedNoAsset',
  'generation.jobMissing',
] as const;

export type GenerationStatusMessageKey = (typeof GENERATION_STATUS_MESSAGE_KEYS)[number];

const en: Record<GenerationStatusMessageKey, string> = {
  'generation.checking': 'Checking generation status…',
  'generation.queued': 'Grok generation is queued and waiting for a worker. No generated asset is attached yet.',
  'generation.running': 'Grok generation is running. No generated asset is attached yet.',
  'generation.queueDelayed': 'This job has been eligible for a worker for more than five minutes. It may be stalled; check its queue state before submitting another generation.',
  'generation.workerTooLong': 'A worker has held this generation for more than ten minutes. Check Incidents and reconcile the provider outcome before starting another generation.',
  'generation.failedNoAsset': 'The generation job ended without an attached asset.',
  'generation.jobMissing': 'No media-generation job is associated with this bundle.',
};

const es: Record<GenerationStatusMessageKey, string> = {
  'generation.checking': 'Comprobando el estado de la generación…',
  'generation.queued': 'La generación de Grok está en cola y espera a un trabajador. Aún no hay un recurso generado adjunto.',
  'generation.running': 'La generación de Grok está en curso. Aún no hay un recurso generado adjunto.',
  'generation.queueDelayed': 'Este trabajo lleva más de cinco minutos disponible para un trabajador. Puede estar atascado; revisa la cola antes de enviar otra generación.',
  'generation.workerTooLong': 'Un trabajador lleva más de diez minutos con esta generación. Revisa Incidentes y confirma el resultado del proveedor antes de iniciar otra generación.',
  'generation.failedNoAsset': 'El trabajo de generación terminó sin adjuntar un recurso.',
  'generation.jobMissing': 'No hay ningún trabajo de generación de medios asociado con este paquete.',
};

const ja: Record<GenerationStatusMessageKey, string> = {
  'generation.checking': '生成状態を確認しています…',
  'generation.queued': 'Grok生成はワーカー待ちのキューにあります。生成済みアセットはまだ添付されていません。',
  'generation.running': 'Grok生成を実行中です。生成済みアセットはまだ添付されていません。',
  'generation.queueDelayed': 'このジョブは5分以上ワーカーを待っています。停滞している可能性があります。再生成を送信する前にキュー状態を確認してください。',
  'generation.workerTooLong': 'ワーカーがこの生成を10分以上保持しています。別の生成を始める前に、インシデントを確認してプロバイダーの結果を照合してください。',
  'generation.failedNoAsset': '生成ジョブは終了しましたが、アセットは添付されていません。',
  'generation.jobMissing': 'このバンドルに関連付けられたメディア生成ジョブがありません。',
};

const it: Record<GenerationStatusMessageKey, string> = {
  'generation.checking': 'Verifica dello stato della generazione…',
  'generation.queued': 'La generazione Grok è in coda e attende un worker. Nessun asset generato è ancora allegato.',
  'generation.running': 'La generazione Grok è in esecuzione. Nessun asset generato è ancora allegato.',
  'generation.queueDelayed': "Questo job è idoneo per un worker da oltre cinque minuti. Potrebbe essere bloccato; controlla la coda prima di inviare un'altra generazione.",
  'generation.workerTooLong': "Un worker gestisce questa generazione da oltre dieci minuti. Controlla gli incidenti e riconcilia l'esito del provider prima di avviarne un'altra.",
  'generation.failedNoAsset': 'Il job di generazione è terminato senza allegare un asset.',
  'generation.jobMissing': 'Nessun job di generazione media è associato a questo bundle.',
};

const ptBR: Record<GenerationStatusMessageKey, string> = {
  'generation.checking': 'Verificando o status da geração…',
  'generation.queued': 'A geração do Grok está na fila aguardando um worker. Nenhum ativo gerado está anexado.',
  'generation.running': 'A geração do Grok está em andamento. Nenhum ativo gerado está anexado.',
  'generation.queueDelayed': 'Este trabalho está elegível para um worker há mais de cinco minutos. Pode estar parado; verifique a fila antes de enviar outra geração.',
  'generation.workerTooLong': 'Um worker está com esta geração há mais de dez minutos. Verifique Incidentes e reconcilie o resultado do provedor antes de iniciar outra geração.',
  'generation.failedNoAsset': 'O trabalho de geração terminou sem anexar um ativo.',
  'generation.jobMissing': 'Não há um trabalho de geração de mídia associado a este pacote.',
};

const de: Record<GenerationStatusMessageKey, string> = {
  'generation.checking': 'Generierungsstatus wird geprüft…',
  'generation.queued': 'Die Grok-Generierung wartet in der Warteschlange auf einen Worker. Noch kein generiertes Asset ist angehängt.',
  'generation.running': 'Die Grok-Generierung läuft. Noch kein generiertes Asset ist angehängt.',
  'generation.queueDelayed': 'Dieser Job wartet seit mehr als fünf Minuten auf einen Worker. Er könnte feststecken; prüfe den Warteschlangenstatus, bevor du eine weitere Generierung einreichst.',
  'generation.workerTooLong': 'Ein Worker hält diese Generierung seit mehr als zehn Minuten. Prüfe Vorfälle und gleiche das Provider-Ergebnis ab, bevor du eine weitere Generierung startest.',
  'generation.failedNoAsset': 'Der Generierungsjob endete, ohne ein Asset anzuhängen.',
  'generation.jobMissing': 'Diesem Paket ist kein Mediengenerierungsjob zugeordnet.',
};

export const GENERATION_STATUS_CATALOGS: Record<SupportedLocale, Catalog> = {
  en,
  es,
  ja,
  it,
  'pt-BR': ptBR,
  de,
};

export function generationStatusCatalogIsComplete(locale: SupportedLocale): boolean {
  return GENERATION_STATUS_MESSAGE_KEYS.every((key) => typeof GENERATION_STATUS_CATALOGS[locale][key] === 'string');
}

export const GENERATION_STATUS_CATALOG_LOCALES = SUPPORTED_LOCALES;
