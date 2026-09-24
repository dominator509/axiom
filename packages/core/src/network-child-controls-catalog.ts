import { SUPPORTED_LOCALES, type Catalog, type SupportedLocale } from './locale.js';

/** Copy for the mounted network child controls: credentials, health and activation. */
export const NETWORK_CHILD_CONTROLS_MESSAGE_KEYS = [
  'egress.credentialsTitleWireGuard',
  'egress.credentialsTitleProxy',
  'egress.credentialsDescription',
  'egress.wireguardProtocol',
  'egress.providerHelp',
  'egress.importConfig',
  'egress.privateKey',
  'egress.publicKey',
  'egress.presharedKey',
  'egress.endpoint',
  'egress.interfaceAddress',
  'egress.allowedIps',
  'egress.keepalive',
  'egress.keepaliveHelp',
  'egress.proxyUsername',
  'egress.proxyPassword',
  'egress.replaceAcknowledgement',
  'egress.imported',
  'egress.errorConfigSize',
  'egress.errorInvalidKeys',
  'egress.errorTunnelAddress',
  'egress.errorKeepalive',
  'egress.errorProxyCredentials',
  'egress.errorMode',
  'egress.errorReadConfig',
  'egress.errorFields',
  'egress.saving',
  'egress.retry',
  'egress.save',
  'egress.saved',
  'egress.saveHttp',
  'egress.saveUnconfirmed',
  'networkHealth.title',
  'networkHealth.initial',
  'networkHealth.checking',
  'networkHealth.description',
  'networkHealth.check',
  'networkHealth.noLive',
  'networkHealth.direct',
  'networkHealth.unhealthy',
  'networkHealth.missingIp',
  'networkHealth.healthy',
  'networkHealth.failure',
  'networkHealth.unexpectedResponse',
  'networkHealth.unexpectedConnection',
  'networkActivation.title',
  'networkActivation.description',
  'networkActivation.approval',
  'networkActivation.applying',
  'networkActivation.apply',
  'networkActivation.completed',
  'networkActivation.failed',
  'networkActivation.httpFailed',
  'networkActivation.unconfirmed',
] as const;

export type NetworkChildControlsMessageKey = (typeof NETWORK_CHILD_CONTROLS_MESSAGE_KEYS)[number];

const en: Record<NetworkChildControlsMessageKey, string> = {
  'egress.credentialsTitleWireGuard': 'WireGuard connection credentials',
  'egress.credentialsTitleProxy': 'Authenticated proxy credentials',
  'egress.credentialsDescription':
    'This replaces the complete saved credential set. Re-enter all required secrets; existing secrets are never displayed. Only submit over HTTPS.',
  'egress.wireguardProtocol':
    'VPN mode uses WireGuard, not an OpenVPN configuration. Enter the address supplied by your VPN provider.',
  'egress.providerHelp':
    'Use your own VPN subscription or WireGuard server. Your provider must supply a compatible WireGuard configuration.',
  'egress.importConfig': 'Import WireGuard configuration',
  'egress.privateKey': 'Private key',
  'egress.publicKey': 'Peer public key',
  'egress.presharedKey': 'Preshared key (optional)',
  'egress.endpoint': 'Peer endpoint (host:port)',
  'egress.interfaceAddress': 'Assigned IPv4 tunnel address (CIDR)',
  'egress.allowedIps': 'Allowed IP ranges',
  'egress.keepalive': 'Keepalive interval (seconds)',
  'egress.keepaliveHelp': "Use your provider's keepalive interval. Zero disables keepalive.",
  'egress.proxyUsername': 'Proxy username',
  'egress.proxyPassword': 'Proxy password',
  'egress.replaceAcknowledgement':
    "Replace this talent's saved credentials with the complete set above.",
  'egress.imported':
    'Configuration imported locally. Review the fields and save to connect this talent to your VPN.',
  'egress.errorConfigSize': 'WireGuard configuration must be smaller than 16 KB.',
  'egress.errorInvalidKeys': 'Enter valid WireGuard keys.',
  'egress.errorTunnelAddress': 'Enter the peer endpoint and assigned tunnel address.',
  'egress.errorKeepalive': 'Keepalive must be between 0 and 65535 seconds.',
  'egress.errorProxyCredentials': 'Enter both proxy credentials (up to 500 characters each).',
  'egress.errorMode': 'Select and save a proxy or WireGuard mode first.',
  'egress.errorReadConfig': 'Could not read the configuration.',
  'egress.errorFields': 'Check the credential fields.',
  'egress.saving': 'Saving…',
  'egress.retry': 'Retry same credential save',
  'egress.save': 'Save encrypted credentials',
  'egress.saved':
    'Credentials saved encrypted. This does not confirm activation or a healthy protected connection.',
  'egress.saveHttp':
    'Credential save not confirmed (HTTP {status}). Check your permissions and fields, or retry the same save.',
  'egress.saveUnconfirmed':
    'Save not confirmed. Retry the same save; do not enter another credential set yet.',
  'networkHealth.title': 'Live connection status',
  'networkHealth.initial': 'Live connection status has not been checked.',
  'networkHealth.checking': 'Checking network service status…',
  'networkHealth.description':
    "Reads the network service's latest health result. It does not activate a tunnel or perform a new leak test.",
  'networkHealth.check': 'Check live connection status',
  'networkHealth.noLive':
    'No live connection confirmed. The connection may be unbound or the network service unavailable.',
  'networkHealth.direct': 'Direct mode: traffic is not protected by a VPN or proxy.',
  'networkHealth.unhealthy':
    'The network service reports this connection as unhealthy. Protected connectivity is not confirmed.',
  'networkHealth.missingIp':
    'Connection reports healthy, but no outbound IP was returned. IP verification is incomplete.',
  'networkHealth.healthy':
    'The network service reports a healthy connection. Observed outbound IP: {ip}.',
  'networkHealth.failure':
    'Live status could not be checked. Do not assume the connection is protected. Try again.',
  'networkHealth.unexpectedResponse': 'Unexpected network status response',
  'networkHealth.unexpectedConnection': 'Unexpected connection identity',
  'networkActivation.title': 'Apply saved connection',
  'networkActivation.description':
    "This applies only this talent's saved configuration and may interrupt ongoing work. Direct mode removes its isolated connection. This does not disable the safety switch.",
  'networkActivation.approval': "I approve applying this talent's saved configuration.",
  'networkActivation.applying': 'Applying saved connection configuration…',
  'networkActivation.apply': 'Apply saved connection',
  'networkActivation.completed':
    'Configuration reconciliation completed ({bound} bound, {skipped} skipped). Check live connection status: completion does not mean the tunnel is healthy.',
  'networkActivation.failed':
    'Activation not confirmed. Check live status before retrying the same request.',
  'networkActivation.httpFailed':
    'Activation not confirmed (HTTP {status}). Check live status before retrying. A 404 may mean the network service needs updating.',
  'networkActivation.unconfirmed': 'Unconfirmed activation response',
};

const es: Record<NetworkChildControlsMessageKey, string> = {
  'egress.credentialsTitleWireGuard': 'Credenciales de conexión WireGuard',
  'egress.credentialsTitleProxy': 'Credenciales de proxy autenticado',
  'egress.credentialsDescription':
    'Esto reemplaza el conjunto completo de credenciales guardadas. Introduce de nuevo todos los secretos; los existentes nunca se muestran. Envía solo mediante HTTPS.',
  'egress.wireguardProtocol':
    'El modo VPN usa WireGuard, no una configuración de OpenVPN. Introduce la dirección de tu proveedor de VPN.',
  'egress.providerHelp':
    'Usa tu propia suscripción VPN o servidor WireGuard. Tu proveedor debe ofrecer una configuración WireGuard compatible.',
  'egress.importConfig': 'Importar configuración WireGuard',
  'egress.privateKey': 'Clave privada',
  'egress.publicKey': 'Clave pública del par',
  'egress.presharedKey': 'Clave precompartida (opcional)',
  'egress.endpoint': 'Punto final del par (host:puerto)',
  'egress.interfaceAddress': 'Dirección IPv4 asignada al túnel (CIDR)',
  'egress.allowedIps': 'Rangos IP permitidos',
  'egress.keepalive': 'Intervalo de mantenimiento (segundos)',
  'egress.keepaliveHelp': 'Usa el intervalo de mantenimiento de tu proveedor. Cero lo desactiva.',
  'egress.proxyUsername': 'Usuario del proxy',
  'egress.proxyPassword': 'Contraseña del proxy',
  'egress.replaceAcknowledgement':
    'Reemplazar las credenciales guardadas de este talento con el conjunto completo anterior.',
  'egress.imported':
    'Configuración importada localmente. Revisa los campos y guarda para conectar este talento a tu VPN.',
  'egress.errorConfigSize': 'La configuración WireGuard debe pesar menos de 16 KB.',
  'egress.errorInvalidKeys': 'Introduce claves WireGuard válidas.',
  'egress.errorTunnelAddress': 'Introduce el punto final del par y la dirección asignada al túnel.',
  'egress.errorKeepalive': 'El mantenimiento debe estar entre 0 y 65535 segundos.',
  'egress.errorProxyCredentials':
    'Introduce el usuario y la contraseña del proxy (hasta 500 caracteres cada uno).',
  'egress.errorMode': 'Selecciona y guarda primero un modo proxy o WireGuard.',
  'egress.errorReadConfig': 'No se pudo leer la configuración.',
  'egress.errorFields': 'Revisa los campos de credenciales.',
  'egress.saving': 'Guardando…',
  'egress.retry': 'Reintentar el mismo guardado de credenciales',
  'egress.save': 'Guardar credenciales cifradas',
  'egress.saved':
    'Credenciales guardadas y cifradas. Esto no confirma la activación ni una conexión protegida saludable.',
  'egress.saveHttp':
    'No se confirmó el guardado (HTTP {status}). Revisa tus permisos y campos, o repite el mismo guardado.',
  'egress.saveUnconfirmed':
    'Guardado no confirmado. Repite el mismo guardado; no introduzcas otro conjunto todavía.',
  'networkHealth.title': 'Estado de la conexión en vivo',
  'networkHealth.initial': 'Todavía no se ha comprobado el estado de la conexión.',
  'networkHealth.checking': 'Comprobando el estado del servicio de red…',
  'networkHealth.description':
    'Lee el último estado de salud del servicio de red. No activa un túnel ni realiza una nueva prueba de fugas.',
  'networkHealth.check': 'Comprobar estado de la conexión',
  'networkHealth.noLive':
    'No se confirmó ninguna conexión en vivo. Puede no estar vinculada o el servicio de red no estar disponible.',
  'networkHealth.direct': 'Modo directo: el tráfico no está protegido por una VPN o un proxy.',
  'networkHealth.unhealthy':
    'El servicio de red informa que la conexión no está sana. La conectividad protegida no está confirmada.',
  'networkHealth.missingIp':
    'La conexión indica que está sana, pero no devolvió una IP de salida. La verificación de IP está incompleta.',
  'networkHealth.healthy':
    'El servicio de red informa una conexión sana. IP de salida observada: {ip}.',
  'networkHealth.failure':
    'No se pudo comprobar el estado en vivo. No asumas que la conexión está protegida. Inténtalo de nuevo.',
  'networkHealth.unexpectedResponse': 'Respuesta de estado de red inesperada',
  'networkHealth.unexpectedConnection': 'Identidad de conexión inesperada',
  'networkActivation.title': 'Aplicar conexión guardada',
  'networkActivation.description':
    'Esto aplica solo la configuración guardada de este talento y puede interrumpir trabajos en curso. El modo directo elimina su conexión aislada. No desactiva el interruptor de seguridad.',
  'networkActivation.approval': 'Apruebo aplicar la configuración guardada de este talento.',
  'networkActivation.applying': 'Aplicando la configuración de conexión guardada…',
  'networkActivation.apply': 'Aplicar conexión guardada',
  'networkActivation.completed':
    'Reconciliación completada ({bound} vinculados, {skipped} omitidos). Comprueba el estado en vivo: completar no significa que el túnel esté sano.',
  'networkActivation.failed':
    'Activación no confirmada. Comprueba el estado en vivo antes de repetir la misma solicitud.',
  'networkActivation.httpFailed':
    'Activación no confirmada (HTTP {status}). Comprueba el estado antes de repetirla. Un 404 puede indicar que el servicio necesita actualizarse.',
  'networkActivation.unconfirmed': 'Respuesta de activación no confirmada',
};

const ja: Record<NetworkChildControlsMessageKey, string> = {
  'egress.credentialsTitleWireGuard': 'WireGuard 接続の認証情報',
  'egress.credentialsTitleProxy': '認証付きプロキシの認証情報',
  'egress.credentialsDescription':
    '保存済みの認証情報をすべて置き換えます。必要な秘密情報を再入力してください。既存の秘密情報は表示されません。HTTPS 経由でのみ送信してください。',
  'egress.wireguardProtocol':
    'VPN モードは OpenVPN ではなく WireGuard を使用します。VPN プロバイダーから提供されたアドレスを入力してください。',
  'egress.providerHelp':
    '自分の VPN サブスクリプションまたは WireGuard サーバーを使用します。プロバイダーが互換性のある WireGuard 設定を提供している必要があります。',
  'egress.importConfig': 'WireGuard 設定をインポート',
  'egress.privateKey': '秘密鍵',
  'egress.publicKey': 'ピア公開鍵',
  'egress.presharedKey': '事前共有鍵（任意）',
  'egress.endpoint': 'ピアエンドポイント（ホスト:ポート）',
  'egress.interfaceAddress': '割り当てられた IPv4 トンネルアドレス（CIDR）',
  'egress.allowedIps': '許可する IP 範囲',
  'egress.keepalive': 'キープアライブ間隔（秒）',
  'egress.keepaliveHelp': 'プロバイダーのキープアライブ間隔を使用します。0 は無効です。',
  'egress.proxyUsername': 'プロキシユーザー名',
  'egress.proxyPassword': 'プロキシパスワード',
  'egress.replaceAcknowledgement':
    'このタレントの保存済み認証情報を、上記の完全なセットで置き換えます。',
  'egress.imported':
    '設定をローカルにインポートしました。項目を確認して保存し、このタレントを VPN に接続してください。',
  'egress.errorConfigSize': 'WireGuard 設定は 16 KB 未満である必要があります。',
  'egress.errorInvalidKeys': '有効な WireGuard 鍵を入力してください。',
  'egress.errorTunnelAddress':
    'ピアエンドポイントと割り当てられたトンネルアドレスを入力してください。',
  'egress.errorKeepalive': 'キープアライブは 0～65535 秒で指定してください。',
  'egress.errorProxyCredentials':
    'プロキシのユーザー名とパスワードを入力してください（各 500 文字以内）。',
  'egress.errorMode': '先にプロキシまたは WireGuard モードを選択して保存してください。',
  'egress.errorReadConfig': '設定を読み取れませんでした。',
  'egress.errorFields': '認証情報の項目を確認してください。',
  'egress.saving': '保存中…',
  'egress.retry': '同じ認証情報の保存を再試行',
  'egress.save': '暗号化された認証情報を保存',
  'egress.saved':
    '認証情報を暗号化して保存しました。これは有効化や保護された接続の正常性を確認するものではありません。',
  'egress.saveHttp':
    '保存を確認できませんでした（HTTP {status}）。権限と項目を確認するか、同じ保存を再試行してください。',
  'egress.saveUnconfirmed':
    '保存を確認できませんでした。同じ保存を再試行し、別の認証情報を入力しないでください。',
  'networkHealth.title': 'ライブ接続の状態',
  'networkHealth.initial': 'ライブ接続の状態はまだ確認されていません。',
  'networkHealth.checking': 'ネットワークサービスの状態を確認中…',
  'networkHealth.description':
    'ネットワークサービスの最新のヘルス結果を読み取ります。トンネルの有効化や新しい漏えいテストは行いません。',
  'networkHealth.check': 'ライブ接続の状態を確認',
  'networkHealth.noLive':
    'ライブ接続を確認できませんでした。接続がバインドされていないか、ネットワークサービスが利用できない可能性があります。',
  'networkHealth.direct': '直接接続モード：通信は VPN またはプロキシで保護されません。',
  'networkHealth.unhealthy':
    'ネットワークサービスは接続を不健全と報告しました。保護された接続は確認されていません。',
  'networkHealth.missingIp':
    '接続は正常と報告されましたが、外向き IP が返されませんでした。IP 検証は未完了です。',
  'networkHealth.healthy':
    'ネットワークサービスは正常な接続を報告しました。確認された外向き IP：{ip}。',
  'networkHealth.failure':
    'ライブ状態を確認できませんでした。接続が保護されていると判断しないでください。再試行してください。',
  'networkHealth.unexpectedResponse': '予期しないネットワーク状態の応答',
  'networkHealth.unexpectedConnection': '予期しない接続 ID',
  'networkActivation.title': '保存済み接続を適用',
  'networkActivation.description':
    'このタレントの保存済み設定だけを適用し、進行中の作業を中断する可能性があります。直接接続モードでは分離接続を削除します。安全スイッチは無効にしません。',
  'networkActivation.approval': 'このタレントの保存済み設定を適用することを承認します。',
  'networkActivation.applying': '保存済み接続設定を適用中…',
  'networkActivation.apply': '保存済み接続を適用',
  'networkActivation.completed':
    '設定の調整が完了しました（{bound} 件をバインド、{skipped} 件をスキップ）。ライブ状態を確認してください。完了してもトンネルが正常とは限りません。',
  'networkActivation.failed':
    '有効化を確認できませんでした。同じリクエストを再試行する前にライブ状態を確認してください。',
  'networkActivation.httpFailed':
    '有効化を確認できませんでした（HTTP {status}）。再試行する前にライブ状態を確認してください。404 はネットワークサービスの更新が必要な場合があります。',
  'networkActivation.unconfirmed': '有効化の応答を確認できませんでした',
};

const it: Record<NetworkChildControlsMessageKey, string> = {
  'egress.credentialsTitleWireGuard': 'Credenziali connessione WireGuard',
  'egress.credentialsTitleProxy': 'Credenziali proxy autenticato',
  'egress.credentialsDescription':
    'Sostituisce l’intero set di credenziali salvate. Reinserisci tutti i segreti richiesti; quelli esistenti non vengono mai mostrati. Invia solo tramite HTTPS.',
  'egress.wireguardProtocol':
    'La modalità VPN usa WireGuard, non una configurazione OpenVPN. Inserisci l’indirizzo fornito dal tuo provider VPN.',
  'egress.providerHelp':
    'Usa il tuo abbonamento VPN o server WireGuard. Il provider deve fornire una configurazione WireGuard compatibile.',
  'egress.importConfig': 'Importa configurazione WireGuard',
  'egress.privateKey': 'Chiave privata',
  'egress.publicKey': 'Chiave pubblica del peer',
  'egress.presharedKey': 'Chiave precondivisa (facoltativa)',
  'egress.endpoint': 'Endpoint peer (host:porta)',
  'egress.interfaceAddress': 'Indirizzo IPv4 del tunnel assegnato (CIDR)',
  'egress.allowedIps': 'Intervalli IP consentiti',
  'egress.keepalive': 'Intervallo keepalive (secondi)',
  'egress.keepaliveHelp': 'Usa l’intervallo keepalive del provider. Zero lo disattiva.',
  'egress.proxyUsername': 'Nome utente proxy',
  'egress.proxyPassword': 'Password proxy',
  'egress.replaceAcknowledgement':
    'Sostituisci le credenziali salvate di questo talento con il set completo indicato sopra.',
  'egress.imported':
    'Configurazione importata localmente. Controlla i campi e salva per collegare questo talento alla VPN.',
  'egress.errorConfigSize': 'La configurazione WireGuard deve essere inferiore a 16 KB.',
  'egress.errorInvalidKeys': 'Inserisci chiavi WireGuard valide.',
  'egress.errorTunnelAddress': 'Inserisci endpoint peer e indirizzo del tunnel assegnato.',
  'egress.errorKeepalive': 'Keepalive deve essere tra 0 e 65535 secondi.',
  'egress.errorProxyCredentials':
    'Inserisci nome utente e password proxy (fino a 500 caratteri ciascuno).',
  'egress.errorMode': 'Seleziona e salva prima una modalità proxy o WireGuard.',
  'egress.errorReadConfig': 'Impossibile leggere la configurazione.',
  'egress.errorFields': 'Controlla i campi delle credenziali.',
  'egress.saving': 'Salvataggio…',
  'egress.retry': 'Riprova lo stesso salvataggio delle credenziali',
  'egress.save': 'Salva credenziali cifrate',
  'egress.saved':
    'Credenziali salvate e cifrate. Non conferma l’attivazione né una connessione protetta sana.',
  'egress.saveHttp':
    'Salvataggio non confermato (HTTP {status}). Controlla permessi e campi o riprova lo stesso salvataggio.',
  'egress.saveUnconfirmed':
    'Salvataggio non confermato. Riprova lo stesso salvataggio; non inserire ancora un altro set di credenziali.',
  'networkHealth.title': 'Stato connessione live',
  'networkHealth.initial': 'Lo stato della connessione live non è ancora stato verificato.',
  'networkHealth.checking': 'Verifica dello stato del servizio di rete…',
  'networkHealth.description':
    'Legge l’ultimo risultato di salute del servizio di rete. Non attiva un tunnel né esegue un nuovo test di perdite.',
  'networkHealth.check': 'Verifica stato connessione live',
  'networkHealth.noLive':
    'Nessuna connessione live confermata. La connessione potrebbe non essere associata o il servizio di rete non disponibile.',
  'networkHealth.direct': 'Modalità diretta: il traffico non è protetto da VPN o proxy.',
  'networkHealth.unhealthy':
    'Il servizio di rete segnala una connessione non sana. La connettività protetta non è confermata.',
  'networkHealth.missingIp':
    'La connessione risulta sana, ma non è stato restituito alcun IP in uscita. La verifica IP è incompleta.',
  'networkHealth.healthy':
    'Il servizio di rete segnala una connessione sana. IP in uscita osservato: {ip}.',
  'networkHealth.failure':
    'Impossibile verificare lo stato live. Non presumere che la connessione sia protetta. Riprova.',
  'networkHealth.unexpectedResponse': 'Risposta di stato della rete imprevista',
  'networkHealth.unexpectedConnection': 'Identità della connessione imprevista',
  'networkActivation.title': 'Applica connessione salvata',
  'networkActivation.description':
    'Applica solo la configurazione salvata di questo talento e potrebbe interrompere il lavoro in corso. La modalità diretta rimuove la connessione isolata. Non disattiva l’interruttore di sicurezza.',
  'networkActivation.approval':
    'Approvo l’applicazione della configurazione salvata di questo talento.',
  'networkActivation.applying': 'Applicazione della configurazione salvata…',
  'networkActivation.apply': 'Applica connessione salvata',
  'networkActivation.completed':
    'Riconciliazione completata ({bound} associati, {skipped} ignorati). Controlla lo stato live: il completamento non significa che il tunnel sia sano.',
  'networkActivation.failed':
    'Attivazione non confermata. Controlla lo stato live prima di riprovare la stessa richiesta.',
  'networkActivation.httpFailed':
    'Attivazione non confermata (HTTP {status}). Controlla lo stato live prima di riprovare. Un 404 può indicare che il servizio di rete deve essere aggiornato.',
  'networkActivation.unconfirmed': 'Risposta di attivazione non confermata',
};

const ptBR: Record<NetworkChildControlsMessageKey, string> = {
  'egress.credentialsTitleWireGuard': 'Credenciais de conexão WireGuard',
  'egress.credentialsTitleProxy': 'Credenciais de proxy autenticado',
  'egress.credentialsDescription':
    'Isso substitui o conjunto completo de credenciais salvas. Digite novamente todos os segredos; os existentes nunca são exibidos. Envie apenas por HTTPS.',
  'egress.wireguardProtocol':
    'O modo VPN usa WireGuard, não uma configuração OpenVPN. Informe o endereço fornecido pelo seu provedor de VPN.',
  'egress.providerHelp':
    'Use sua própria assinatura VPN ou servidor WireGuard. O provedor precisa fornecer uma configuração WireGuard compatível.',
  'egress.importConfig': 'Importar configuração WireGuard',
  'egress.privateKey': 'Chave privada',
  'egress.publicKey': 'Chave pública do peer',
  'egress.presharedKey': 'Chave pré-compartilhada (opcional)',
  'egress.endpoint': 'Endpoint do peer (host:porta)',
  'egress.interfaceAddress': 'Endereço IPv4 atribuído ao túnel (CIDR)',
  'egress.allowedIps': 'Faixas de IP permitidas',
  'egress.keepalive': 'Intervalo de keepalive (segundos)',
  'egress.keepaliveHelp': 'Use o intervalo de keepalive do provedor. Zero desativa.',
  'egress.proxyUsername': 'Usuário do proxy',
  'egress.proxyPassword': 'Senha do proxy',
  'egress.replaceAcknowledgement':
    'Substituir as credenciais salvas deste talento pelo conjunto completo acima.',
  'egress.imported':
    'Configuração importada localmente. Revise os campos e salve para conectar este talento à sua VPN.',
  'egress.errorConfigSize': 'A configuração WireGuard deve ser menor que 16 KB.',
  'egress.errorInvalidKeys': 'Informe chaves WireGuard válidas.',
  'egress.errorTunnelAddress': 'Informe o endpoint do peer e o endereço atribuído ao túnel.',
  'egress.errorKeepalive': 'O keepalive deve estar entre 0 e 65535 segundos.',
  'egress.errorProxyCredentials': 'Informe usuário e senha do proxy (até 500 caracteres cada).',
  'egress.errorMode': 'Selecione e salve primeiro um modo proxy ou WireGuard.',
  'egress.errorReadConfig': 'Não foi possível ler a configuração.',
  'egress.errorFields': 'Verifique os campos de credenciais.',
  'egress.saving': 'Salvando…',
  'egress.retry': 'Tentar novamente o mesmo salvamento de credenciais',
  'egress.save': 'Salvar credenciais criptografadas',
  'egress.saved':
    'Credenciais salvas e criptografadas. Isso não confirma a ativação nem uma conexão protegida saudável.',
  'egress.saveHttp':
    'O salvamento não foi confirmado (HTTP {status}). Verifique suas permissões e campos ou repita o mesmo salvamento.',
  'egress.saveUnconfirmed':
    'Salvamento não confirmado. Repita o mesmo salvamento; ainda não informe outro conjunto de credenciais.',
  'networkHealth.title': 'Status da conexão ao vivo',
  'networkHealth.initial': 'O status da conexão ao vivo ainda não foi verificado.',
  'networkHealth.checking': 'Verificando o status do serviço de rede…',
  'networkHealth.description':
    'Lê o resultado de saúde mais recente do serviço de rede. Não ativa um túnel nem faz um novo teste de vazamento.',
  'networkHealth.check': 'Verificar status da conexão',
  'networkHealth.noLive':
    'Nenhuma conexão ao vivo confirmada. A conexão pode não estar vinculada ou o serviço de rede pode estar indisponível.',
  'networkHealth.direct': 'Modo direto: o tráfego não é protegido por VPN ou proxy.',
  'networkHealth.unhealthy':
    'O serviço de rede informa que a conexão não está saudável. A conectividade protegida não foi confirmada.',
  'networkHealth.missingIp':
    'A conexão informa que está saudável, mas não retornou um IP de saída. A verificação de IP está incompleta.',
  'networkHealth.healthy':
    'O serviço de rede informa uma conexão saudável. IP de saída observado: {ip}.',
  'networkHealth.failure':
    'Não foi possível verificar o status ao vivo. Não presuma que a conexão está protegida. Tente novamente.',
  'networkHealth.unexpectedResponse': 'Resposta inesperada do status da rede',
  'networkHealth.unexpectedConnection': 'Identidade de conexão inesperada',
  'networkActivation.title': 'Aplicar conexão salva',
  'networkActivation.description':
    'Aplica apenas a configuração salva deste talento e pode interromper trabalhos em andamento. O modo direto remove sua conexão isolada. Isso não desativa o interruptor de segurança.',
  'networkActivation.approval': 'Aprovo aplicar a configuração salva deste talento.',
  'networkActivation.applying': 'Aplicando configuração de conexão salva…',
  'networkActivation.apply': 'Aplicar conexão salva',
  'networkActivation.completed':
    'Reconciliação concluída ({bound} vinculados, {skipped} ignorados). Verifique o status ao vivo: conclusão não significa que o túnel está saudável.',
  'networkActivation.failed':
    'Ativação não confirmada. Verifique o status ao vivo antes de tentar a mesma solicitação novamente.',
  'networkActivation.httpFailed':
    'Ativação não confirmada (HTTP {status}). Verifique o status antes de tentar novamente. Um 404 pode indicar que o serviço de rede precisa ser atualizado.',
  'networkActivation.unconfirmed': 'Resposta de ativação não confirmada',
};

const de: Record<NetworkChildControlsMessageKey, string> = {
  'egress.credentialsTitleWireGuard': 'WireGuard-Verbindungsdaten',
  'egress.credentialsTitleProxy': 'Anmeldedaten für authentifizierten Proxy',
  'egress.credentialsDescription':
    'Ersetzt den vollständigen gespeicherten Datensatz. Geben Sie alle Geheimnisse erneut ein; vorhandene Geheimnisse werden nie angezeigt. Nur über HTTPS senden.',
  'egress.wireguardProtocol':
    'Der VPN-Modus verwendet WireGuard, keine OpenVPN-Konfiguration. Geben Sie die von Ihrem VPN-Anbieter bereitgestellte Adresse ein.',
  'egress.providerHelp':
    'Verwenden Sie Ihr eigenes VPN-Abonnement oder einen WireGuard-Server. Ihr Anbieter muss eine kompatible WireGuard-Konfiguration bereitstellen.',
  'egress.importConfig': 'WireGuard-Konfiguration importieren',
  'egress.privateKey': 'Privater Schlüssel',
  'egress.publicKey': 'Öffentlicher Peer-Schlüssel',
  'egress.presharedKey': 'Pre-Shared-Key (optional)',
  'egress.endpoint': 'Peer-Endpunkt (Host:Port)',
  'egress.interfaceAddress': 'Zugewiesene IPv4-Tunneladresse (CIDR)',
  'egress.allowedIps': 'Erlaubte IP-Bereiche',
  'egress.keepalive': 'Keepalive-Intervall (Sekunden)',
  'egress.keepaliveHelp':
    'Verwenden Sie das Keepalive-Intervall Ihres Anbieters. Null deaktiviert es.',
  'egress.proxyUsername': 'Proxy-Benutzername',
  'egress.proxyPassword': 'Proxy-Passwort',
  'egress.replaceAcknowledgement':
    'Gespeicherte Anmeldedaten dieses Talents durch den vollständigen Satz oben ersetzen.',
  'egress.imported':
    'Konfiguration lokal importiert. Prüfen Sie die Felder und speichern Sie, um dieses Talent mit Ihrem VPN zu verbinden.',
  'egress.errorConfigSize': 'Die WireGuard-Konfiguration muss kleiner als 16 KB sein.',
  'egress.errorInvalidKeys': 'Geben Sie gültige WireGuard-Schlüssel ein.',
  'egress.errorTunnelAddress': 'Geben Sie Peer-Endpunkt und zugewiesene Tunneladresse ein.',
  'egress.errorKeepalive': 'Keepalive muss zwischen 0 und 65535 Sekunden liegen.',
  'egress.errorProxyCredentials':
    'Geben Sie Proxy-Benutzername und -Passwort ein (jeweils höchstens 500 Zeichen).',
  'egress.errorMode': 'Wählen und speichern Sie zuerst einen Proxy- oder WireGuard-Modus.',
  'egress.errorReadConfig': 'Die Konfiguration konnte nicht gelesen werden.',
  'egress.errorFields': 'Prüfen Sie die Felder für die Anmeldedaten.',
  'egress.saving': 'Wird gespeichert…',
  'egress.retry': 'Dieselben Anmeldedaten erneut speichern',
  'egress.save': 'Verschlüsselte Anmeldedaten speichern',
  'egress.saved':
    'Anmeldedaten wurden verschlüsselt gespeichert. Dies bestätigt weder die Aktivierung noch eine gesunde geschützte Verbindung.',
  'egress.saveHttp':
    'Speichern nicht bestätigt (HTTP {status}). Prüfen Sie Berechtigungen und Felder oder wiederholen Sie denselben Speichervorgang.',
  'egress.saveUnconfirmed':
    'Speichern nicht bestätigt. Wiederholen Sie denselben Vorgang; geben Sie noch keinen anderen Anmeldedatensatz ein.',
  'networkHealth.title': 'Status der Live-Verbindung',
  'networkHealth.initial': 'Der Status der Live-Verbindung wurde noch nicht geprüft.',
  'networkHealth.checking': 'Netzwerkdienststatus wird geprüft…',
  'networkHealth.description':
    'Liest das neueste Gesundheitsergebnis des Netzwerkdienstes. Es aktiviert keinen Tunnel und führt keinen neuen Leak-Test aus.',
  'networkHealth.check': 'Status der Live-Verbindung prüfen',
  'networkHealth.noLive':
    'Keine Live-Verbindung bestätigt. Die Verbindung ist möglicherweise nicht gebunden oder der Netzwerkdienst nicht verfügbar.',
  'networkHealth.direct': 'Direktmodus: Der Datenverkehr ist nicht durch VPN oder Proxy geschützt.',
  'networkHealth.unhealthy':
    'Der Netzwerkdienst meldet diese Verbindung als fehlerhaft. Geschützte Konnektivität ist nicht bestätigt.',
  'networkHealth.missingIp':
    'Die Verbindung meldet gesund, aber keine ausgehende IP. Die IP-Prüfung ist unvollständig.',
  'networkHealth.healthy':
    'Der Netzwerkdienst meldet eine gesunde Verbindung. Beobachtete ausgehende IP: {ip}.',
  'networkHealth.failure':
    'Der Live-Status konnte nicht geprüft werden. Gehen Sie nicht von einer geschützten Verbindung aus. Versuchen Sie es erneut.',
  'networkHealth.unexpectedResponse': 'Unerwartete Netzwerkstatusantwort',
  'networkHealth.unexpectedConnection': 'Unerwartete Verbindungsidentität',
  'networkActivation.title': 'Gespeicherte Verbindung anwenden',
  'networkActivation.description':
    'Wendet nur die gespeicherte Konfiguration dieses Talents an und kann laufende Arbeit unterbrechen. Der Direktmodus entfernt seine isolierte Verbindung. Der Sicherheitsschalter wird nicht deaktiviert.',
  'networkActivation.approval':
    'Ich genehmige die Anwendung der gespeicherten Konfiguration dieses Talents.',
  'networkActivation.applying': 'Gespeicherte Verbindungskonfiguration wird angewendet…',
  'networkActivation.apply': 'Gespeicherte Verbindung anwenden',
  'networkActivation.completed':
    'Konfigurationsabgleich abgeschlossen ({bound} gebunden, {skipped} übersprungen). Prüfen Sie den Live-Status: Der Abschluss bedeutet nicht, dass der Tunnel gesund ist.',
  'networkActivation.failed':
    'Aktivierung nicht bestätigt. Prüfen Sie den Live-Status, bevor Sie dieselbe Anfrage wiederholen.',
  'networkActivation.httpFailed':
    'Aktivierung nicht bestätigt (HTTP {status}). Prüfen Sie den Live-Status vor einem erneuten Versuch. Ein 404 kann bedeuten, dass der Netzwerkdienst aktualisiert werden muss.',
  'networkActivation.unconfirmed': 'Aktivierungsantwort nicht bestätigt',
};

export const NETWORK_CHILD_CONTROLS_CATALOGS: Record<SupportedLocale, Catalog> = {
  en,
  es,
  ja,
  it,
  'pt-BR': ptBR,
  de,
};

export function networkChildControlsCatalogIsComplete(locale: SupportedLocale): boolean {
  return NETWORK_CHILD_CONTROLS_MESSAGE_KEYS.every(
    (key) => typeof NETWORK_CHILD_CONTROLS_CATALOGS[locale][key] === 'string',
  );
}

export function networkChildControlsCatalogsAreComplete(): boolean {
  return SUPPORTED_LOCALES.every(networkChildControlsCatalogIsComplete);
}
