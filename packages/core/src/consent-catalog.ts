import { SUPPORTED_LOCALES, type Catalog, type SupportedLocale } from './locale.js';

/** Feature-owned copy for the metadata-only consent vault and its controls. */
export const CONSENT_MESSAGE_KEYS = [
  'consent.title',
  'consent.reviewApprovals',
  'consent.metadataDescription',
  'consent.requiresEditRole',
  'consent.loadFailed',
  'consent.empty',
  'consent.granted',
  'consent.revoked',
  'consent.platform',
  'consent.subject',
  'consent.validity',
  'consent.openEnded',
  'consent.digest',
  'consent.storedDigest',
  'consent.addMetadata',
  'consent.formDescription',
  'consent.platformPlaceholder',
  'consent.documentKind',
  'consent.subjectReference',
  'consent.encryptedDocumentReference',
  'consent.sha256Digest',
  'consent.validFrom',
  'consent.validToOptional',
  'consent.save',
  'consent.saving',
  'consent.saved',
  'consent.saveHttp',
  'consent.saveUnconfirmed',
  'consent.invalidPlatform',
  'consent.invalidKind',
  'consent.invalidReferences',
  'consent.invalidDigest',
  'consent.invalidRange',
  'consent.checkMetadata',
  'consent.revoke',
  'consent.revoking',
  'consent.revokeConfirm',
  'consent.revokedMessage',
  'consent.revokeHttp',
  'consent.revokeUnconfirmed',
] as const;

export type ConsentMessageKey = (typeof CONSENT_MESSAGE_KEYS)[number];

const en: Record<ConsentMessageKey, string> = {
  'consent.title': 'Consent vault',
  'consent.reviewApprovals': 'Review approvals',
  'consent.metadataDescription':
    'Metadata-only records used by publication gates. Document bytes stay in the encrypted object store; this screen never accepts document contents.',
  'consent.requiresEditRole':
    'Adding or revoking consent requires an owner, manager or operator role.',
  'consent.loadFailed': 'Consent records could not be loaded. Refresh to try again.',
  'consent.empty': 'No consent records are registered for this talent.',
  'consent.granted': 'granted',
  'consent.revoked': 'revoked',
  'consent.platform': 'Platform',
  'consent.subject': 'Subject',
  'consent.validity': 'Validity',
  'consent.openEnded': 'open-ended',
  'consent.digest': 'Digest',
  'consent.storedDigest': '[stored digest]',
  'consent.addMetadata': 'Add consent metadata',
  'consent.formDescription':
    'This stores references and a digest only. Do not paste document contents or credentials here.',
  'consent.platformPlaceholder': 'fanvue',
  'consent.documentKind': 'Document kind',
  'consent.subjectReference': 'Subject reference',
  'consent.encryptedDocumentReference': 'Encrypted document reference',
  'consent.sha256Digest': 'SHA-256 digest',
  'consent.validFrom': 'Valid from',
  'consent.validToOptional': 'Valid to (optional)',
  'consent.save': 'Save consent metadata',
  'consent.saving': 'Saving...',
  'consent.saved': 'Consent metadata saved. Document bytes remain in the encrypted object store.',
  'consent.saveHttp':
    'Consent record was not saved (HTTP {status}). Check your permissions and fields, or retry the same save.',
  'consent.saveUnconfirmed':
    'Save not confirmed. Retry the same consent record before changing fields.',
  'consent.invalidPlatform': 'Enter a platform name of 1-50 characters.',
  'consent.invalidKind': 'Choose a document kind.',
  'consent.invalidReferences': 'Enter the subject and encrypted document references.',
  'consent.invalidDigest': 'Enter the document SHA-256 as 64 hexadecimal characters.',
  'consent.invalidRange': 'Enter a valid date range.',
  'consent.checkMetadata': 'Check consent metadata.',
  'consent.revoke': 'Revoke record',
  'consent.revoking': 'Revoking...',
  'consent.revokeConfirm':
    'Revoke this consent record? Publication gates will no longer treat it as granted.',
  'consent.revokedMessage': 'Record revoked. Publication gates will no longer treat it as granted.',
  'consent.revokeHttp': 'Revocation was not confirmed (HTTP {status}).',
  'consent.revokeUnconfirmed': 'Revocation not confirmed. Retry to check the same request.',
};

export const CONSENT_CATALOGS: Record<SupportedLocale, Catalog> = {
  en,
  es: {
    'consent.title': 'Bóveda de consentimiento',
    'consent.reviewApprovals': 'Revisar aprobaciones',
    'consent.metadataDescription':
      'Registros solo de metadatos usados por los controles de publicación. Los documentos permanecen en el almacén de objetos cifrado; esta pantalla nunca acepta su contenido.',
    'consent.requiresEditRole':
      'Agregar o revocar consentimiento requiere el rol de propietario, gerente u operador.',
    'consent.loadFailed':
      'No se pudieron cargar los registros de consentimiento. Actualiza para intentarlo de nuevo.',
    'consent.empty': 'No hay registros de consentimiento para este talento.',
    'consent.granted': 'concedido',
    'consent.revoked': 'revocado',
    'consent.platform': 'Plataforma',
    'consent.subject': 'Sujeto',
    'consent.validity': 'Vigencia',
    'consent.openEnded': 'sin fecha de finalización',
    'consent.digest': 'Resumen',
    'consent.storedDigest': '[resumen almacenado]',
    'consent.addMetadata': 'Agregar metadatos de consentimiento',
    'consent.formDescription':
      'Esto guarda solo referencias y un resumen. No pegues aquí documentos ni credenciales.',
    'consent.platformPlaceholder': 'fanvue',
    'consent.documentKind': 'Tipo de documento',
    'consent.subjectReference': 'Referencia del sujeto',
    'consent.encryptedDocumentReference': 'Referencia del documento cifrado',
    'consent.sha256Digest': 'Resumen SHA-256',
    'consent.validFrom': 'Válido desde',
    'consent.validToOptional': 'Válido hasta (opcional)',
    'consent.save': 'Guardar metadatos de consentimiento',
    'consent.saving': 'Guardando...',
    'consent.saved':
      'Metadatos de consentimiento guardados. Los documentos permanecen en el almacén de objetos cifrado.',
    'consent.saveHttp':
      'No se guardó el registro de consentimiento (HTTP {status}). Revisa tus permisos y campos, o reintenta el mismo guardado.',
    'consent.saveUnconfirmed':
      'Guardado no confirmado. Reintenta el mismo registro antes de cambiar los campos.',
    'consent.invalidPlatform': 'Escribe un nombre de plataforma de 1 a 50 caracteres.',
    'consent.invalidKind': 'Elige un tipo de documento.',
    'consent.invalidReferences': 'Escribe las referencias del sujeto y del documento cifrado.',
    'consent.invalidDigest': 'Escribe el SHA-256 del documento con 64 caracteres hexadecimales.',
    'consent.invalidRange': 'Escribe un intervalo de fechas válido.',
    'consent.checkMetadata': 'Revisa los metadatos de consentimiento.',
    'consent.revoke': 'Revocar registro',
    'consent.revoking': 'Revocando...',
    'consent.revokeConfirm':
      '¿Revocar este registro de consentimiento? Los controles de publicación dejarán de tratarlo como concedido.',
    'consent.revokedMessage':
      'Registro revocado. Los controles de publicación dejarán de tratarlo como concedido.',
    'consent.revokeHttp': 'La revocación no se confirmó (HTTP {status}).',
    'consent.revokeUnconfirmed':
      'Revocación no confirmada. Reintenta para comprobar la misma solicitud.',
  },
  ja: {
    'consent.title': '同意管理',
    'consent.reviewApprovals': '承認を確認',
    'consent.metadataDescription':
      '公開ゲートで使うメタデータのみの記録です。文書本体は暗号化オブジェクトストアに保存され、この画面で文書内容を受け取ることはありません。',
    'consent.requiresEditRole':
      '同意の追加または取り消しには、オーナー、マネージャー、またはオペレーター権限が必要です。',
    'consent.loadFailed': '同意記録を読み込めませんでした。更新して再試行してください。',
    'consent.empty': 'このタレントには同意記録がありません。',
    'consent.granted': '付与済み',
    'consent.revoked': '取り消し済み',
    'consent.platform': 'プラットフォーム',
    'consent.subject': '対象',
    'consent.validity': '有効期間',
    'consent.openEnded': '終了日なし',
    'consent.digest': 'ダイジェスト',
    'consent.storedDigest': '[保存済みダイジェスト]',
    'consent.addMetadata': '同意メタデータを追加',
    'consent.formDescription':
      '保存するのは参照情報とダイジェストのみです。文書内容や認証情報を貼り付けないでください。',
    'consent.platformPlaceholder': 'fanvue',
    'consent.documentKind': '文書種別',
    'consent.subjectReference': '対象参照',
    'consent.encryptedDocumentReference': '暗号化文書参照',
    'consent.sha256Digest': 'SHA-256ダイジェスト',
    'consent.validFrom': '開始日',
    'consent.validToOptional': '終了日（任意）',
    'consent.save': '同意メタデータを保存',
    'consent.saving': '保存中...',
    'consent.saved': '同意メタデータを保存しました。文書本体は暗号化オブジェクトストアに残ります。',
    'consent.saveHttp':
      '同意記録を保存できませんでした（HTTP {status}）。権限と入力を確認するか、同じ保存を再試行してください。',
    'consent.saveUnconfirmed':
      '保存を確認できませんでした。項目を変更せず同じ同意記録を再試行してください。',
    'consent.invalidPlatform': 'プラットフォーム名を1〜50文字で入力してください。',
    'consent.invalidKind': '文書種別を選択してください。',
    'consent.invalidReferences': '対象参照と暗号化文書参照を入力してください。',
    'consent.invalidDigest': '文書のSHA-256を64桁の16進数で入力してください。',
    'consent.invalidRange': '有効な日付範囲を入力してください。',
    'consent.checkMetadata': '同意メタデータを確認してください。',
    'consent.revoke': '記録を取り消す',
    'consent.revoking': '取り消し中...',
    'consent.revokeConfirm':
      'この同意記録を取り消しますか？公開ゲートでは付与済みとして扱われなくなります。',
    'consent.revokedMessage': '記録を取り消しました。公開ゲートでは付与済みとして扱われません。',
    'consent.revokeHttp': '取り消しを確認できませんでした（HTTP {status}）。',
    'consent.revokeUnconfirmed':
      '取り消しを確認できませんでした。同じ要求を再試行して確認してください。',
  },
  it: {
    'consent.title': 'Archivio dei consensi',
    'consent.reviewApprovals': 'Rivedi approvazioni',
    'consent.metadataDescription':
      'Record di soli metadati usati dai controlli di pubblicazione. I documenti restano nell’object store cifrato; questa schermata non accetta il contenuto dei documenti.',
    'consent.requiresEditRole':
      'Per aggiungere o revocare un consenso serve il ruolo di proprietario, manager o operatore.',
    'consent.loadFailed': 'Impossibile caricare i record di consenso. Aggiorna per riprovare.',
    'consent.empty': 'Non ci sono record di consenso per questo talent.',
    'consent.granted': 'concesso',
    'consent.revoked': 'revocato',
    'consent.platform': 'Piattaforma',
    'consent.subject': 'Soggetto',
    'consent.validity': 'Validità',
    'consent.openEnded': 'senza scadenza',
    'consent.digest': 'Digest',
    'consent.storedDigest': '[digest salvato]',
    'consent.addMetadata': 'Aggiungi metadati del consenso',
    'consent.formDescription':
      'Vengono salvati solo riferimenti e un digest. Non incollare qui documenti o credenziali.',
    'consent.platformPlaceholder': 'fanvue',
    'consent.documentKind': 'Tipo di documento',
    'consent.subjectReference': 'Riferimento del soggetto',
    'consent.encryptedDocumentReference': 'Riferimento del documento cifrato',
    'consent.sha256Digest': 'Digest SHA-256',
    'consent.validFrom': 'Valido dal',
    'consent.validToOptional': 'Valido fino al (facoltativo)',
    'consent.save': 'Salva metadati del consenso',
    'consent.saving': 'Salvataggio...',
    'consent.saved':
      'Metadati del consenso salvati. I documenti restano nell’object store cifrato.',
    'consent.saveHttp':
      'Il record di consenso non è stato salvato (HTTP {status}). Controlla permessi e campi oppure riprova lo stesso salvataggio.',
    'consent.saveUnconfirmed':
      'Salvataggio non confermato. Riprova lo stesso record prima di modificare i campi.',
    'consent.invalidPlatform': 'Inserisci un nome di piattaforma da 1 a 50 caratteri.',
    'consent.invalidKind': 'Scegli un tipo di documento.',
    'consent.invalidReferences': 'Inserisci i riferimenti del soggetto e del documento cifrato.',
    'consent.invalidDigest': 'Inserisci lo SHA-256 del documento con 64 caratteri esadecimali.',
    'consent.invalidRange': 'Inserisci un intervallo di date valido.',
    'consent.checkMetadata': 'Controlla i metadati del consenso.',
    'consent.revoke': 'Revoca record',
    'consent.revoking': 'Revoca...',
    'consent.revokeConfirm':
      'Revocare questo record di consenso? I controlli di pubblicazione non lo considereranno più concesso.',
    'consent.revokedMessage':
      'Record revocato. I controlli di pubblicazione non lo considereranno più concesso.',
    'consent.revokeHttp': 'Revoca non confermata (HTTP {status}).',
    'consent.revokeUnconfirmed':
      'Revoca non confermata. Riprova per controllare la stessa richiesta.',
  },
  'pt-BR': {
    'consent.title': 'Cofre de consentimentos',
    'consent.reviewApprovals': 'Revisar aprovações',
    'consent.metadataDescription':
      'Registros apenas de metadados usados pelos controles de publicação. Os documentos ficam no armazenamento de objetos criptografado; esta tela nunca aceita o conteúdo dos documentos.',
    'consent.requiresEditRole':
      'Adicionar ou revogar consentimento exige o papel de proprietário, gerente ou operador.',
    'consent.loadFailed':
      'Não foi possível carregar os registros de consentimento. Atualize para tentar novamente.',
    'consent.empty': 'Não há registros de consentimento para este talento.',
    'consent.granted': 'concedido',
    'consent.revoked': 'revogado',
    'consent.platform': 'Plataforma',
    'consent.subject': 'Sujeito',
    'consent.validity': 'Validade',
    'consent.openEnded': 'sem data final',
    'consent.digest': 'Resumo',
    'consent.storedDigest': '[resumo armazenado]',
    'consent.addMetadata': 'Adicionar metadados de consentimento',
    'consent.formDescription':
      'Isto armazena apenas referências e um resumo. Não cole documentos ou credenciais aqui.',
    'consent.platformPlaceholder': 'fanvue',
    'consent.documentKind': 'Tipo de documento',
    'consent.subjectReference': 'Referência do sujeito',
    'consent.encryptedDocumentReference': 'Referência do documento criptografado',
    'consent.sha256Digest': 'Resumo SHA-256',
    'consent.validFrom': 'Válido a partir de',
    'consent.validToOptional': 'Válido até (opcional)',
    'consent.save': 'Salvar metadados de consentimento',
    'consent.saving': 'Salvando...',
    'consent.saved':
      'Metadados de consentimento salvos. Os documentos permanecem no armazenamento de objetos criptografado.',
    'consent.saveHttp':
      'O registro de consentimento não foi salvo (HTTP {status}). Verifique permissões e campos ou tente o mesmo salvamento novamente.',
    'consent.saveUnconfirmed':
      'Salvamento não confirmado. Tente o mesmo registro novamente antes de alterar os campos.',
    'consent.invalidPlatform': 'Informe um nome de plataforma com 1 a 50 caracteres.',
    'consent.invalidKind': 'Escolha um tipo de documento.',
    'consent.invalidReferences': 'Informe as referências do sujeito e do documento criptografado.',
    'consent.invalidDigest': 'Informe o SHA-256 do documento com 64 caracteres hexadecimais.',
    'consent.invalidRange': 'Informe um intervalo de datas válido.',
    'consent.checkMetadata': 'Verifique os metadados de consentimento.',
    'consent.revoke': 'Revogar registro',
    'consent.revoking': 'Revogando...',
    'consent.revokeConfirm':
      'Revogar este registro de consentimento? Os controles de publicação deixarão de tratá-lo como concedido.',
    'consent.revokedMessage':
      'Registro revogado. Os controles de publicação deixarão de tratá-lo como concedido.',
    'consent.revokeHttp': 'A revogação não foi confirmada (HTTP {status}).',
    'consent.revokeUnconfirmed':
      'Revogação não confirmada. Tente novamente para verificar a mesma solicitação.',
  },
  de: {
    'consent.title': 'Einwilligungsarchiv',
    'consent.reviewApprovals': 'Freigaben prüfen',
    'consent.metadataDescription':
      'Reine Metadatenaufzeichnungen für Veröffentlichungsprüfungen. Dokumente bleiben im verschlüsselten Objektspeicher; diese Ansicht nimmt niemals Dokumentinhalte an.',
    'consent.requiresEditRole':
      'Zum Hinzufügen oder Widerrufen einer Einwilligung ist die Rolle Eigentümer, Manager oder Operator erforderlich.',
    'consent.loadFailed':
      'Einwilligungsaufzeichnungen konnten nicht geladen werden. Aktualisieren Sie die Seite und versuchen Sie es erneut.',
    'consent.empty': 'Für dieses Talent sind keine Einwilligungsaufzeichnungen registriert.',
    'consent.granted': 'erteilt',
    'consent.revoked': 'widerrufen',
    'consent.platform': 'Plattform',
    'consent.subject': 'Betreff',
    'consent.validity': 'Gültigkeit',
    'consent.openEnded': 'ohne Enddatum',
    'consent.digest': 'Digest',
    'consent.storedDigest': '[gespeicherter Digest]',
    'consent.addMetadata': 'Einwilligungsmetadaten hinzufügen',
    'consent.formDescription':
      'Es werden nur Referenzen und ein Digest gespeichert. Fügen Sie hier keine Dokumentinhalte oder Zugangsdaten ein.',
    'consent.platformPlaceholder': 'fanvue',
    'consent.documentKind': 'Dokumenttyp',
    'consent.subjectReference': 'Betreffreferenz',
    'consent.encryptedDocumentReference': 'Referenz des verschlüsselten Dokuments',
    'consent.sha256Digest': 'SHA-256-Digest',
    'consent.validFrom': 'Gültig ab',
    'consent.validToOptional': 'Gültig bis (optional)',
    'consent.save': 'Einwilligungsmetadaten speichern',
    'consent.saving': 'Wird gespeichert...',
    'consent.saved':
      'Einwilligungsmetadaten gespeichert. Dokumente bleiben im verschlüsselten Objektspeicher.',
    'consent.saveHttp':
      'Einwilligungsaufzeichnung wurde nicht gespeichert (HTTP {status}). Prüfen Sie Berechtigungen und Felder oder wiederholen Sie denselben Speichervorgang.',
    'consent.saveUnconfirmed':
      'Speichern nicht bestätigt. Wiederholen Sie dieselbe Einwilligungsaufzeichnung, bevor Sie Felder ändern.',
    'consent.invalidPlatform': 'Geben Sie einen Plattformnamen mit 1 bis 50 Zeichen ein.',
    'consent.invalidKind': 'Wählen Sie einen Dokumenttyp aus.',
    'consent.invalidReferences':
      'Geben Sie Betreff- und Referenz des verschlüsselten Dokuments ein.',
    'consent.invalidDigest': 'Geben Sie den Dokument-SHA-256 als 64 hexadezimale Zeichen ein.',
    'consent.invalidRange': 'Geben Sie einen gültigen Datumsbereich ein.',
    'consent.checkMetadata': 'Prüfen Sie die Einwilligungsmetadaten.',
    'consent.revoke': 'Aufzeichnung widerrufen',
    'consent.revoking': 'Wird widerrufen...',
    'consent.revokeConfirm':
      'Diese Einwilligungsaufzeichnung widerrufen? Veröffentlichungsprüfungen behandeln sie dann nicht mehr als erteilt.',
    'consent.revokedMessage':
      'Aufzeichnung widerrufen. Veröffentlichungsprüfungen behandeln sie nicht mehr als erteilt.',
    'consent.revokeHttp': 'Widerruf nicht bestätigt (HTTP {status}).',
    'consent.revokeUnconfirmed':
      'Widerruf nicht bestätigt. Wiederholen Sie die Anfrage, um denselben Vorgang zu prüfen.',
  },
};

export function consentCatalogIsComplete(locale: SupportedLocale): boolean {
  return (
    SUPPORTED_LOCALES.includes(locale) &&
    CONSENT_MESSAGE_KEYS.every(
      (key) =>
        typeof CONSENT_CATALOGS[locale][key] === 'string' &&
        CONSENT_CATALOGS[locale][key].length > 0,
    )
  );
}
