// ─── Locale contract (F-89) ───
//
// Six launch locales: en, es, ja, it, pt-BR, de. This module owns the typed
// message-key contract, deterministic locale normalization, precedence
// resolution (explicit user → organization → Accept-Language → en), safe
// interpolation/escaping and locale-aware Intl formatting.
//
// UI locale and content (model/creator) locale are deliberately separate:
// nothing here ever translates user-authored captions, persona/soul text,
// playbooks or provider content.

/** The six launch locales. `pt-BR` is explicit; a bare `pt` normalizes to it. */
export const SUPPORTED_LOCALES = ['en', 'es', 'ja', 'it', 'pt-BR', 'de'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Fallback locale. Every missing key resolves here before a raw key is shown. */
export const FALLBACK_LOCALE: SupportedLocale = 'en';

/** BCP-47 language subtags mapped to their canonical launch locale. */
const LANGUAGE_ALIASES: Record<string, SupportedLocale> = {
  en: 'en',
  es: 'es',
  ja: 'ja',
  it: 'it',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  'pt-pt': 'pt-BR',
  de: 'de',
};

/**
 * Normalize an arbitrary BCP-47 tag to a supported locale.
 * Returns undefined for anything unrecognized so callers can fall through the
 * precedence chain rather than silently picking a wrong locale.
 */
export function normalizeLocale(input: string | null | undefined): SupportedLocale | undefined {
  if (!input || typeof input !== 'string') return undefined;

  const trimmed = input.trim().replace(/_/g, '-');
  if (trimmed.length === 0) return undefined;

  const parts = trimmed.split('-');

  // Exact canonical match first (region matters: pt-BR is not pt-PT).
  const canonical = `${parts[0].toLowerCase()}${parts[1] ? `-${parts[1].toUpperCase()}` : ''}`;
  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === canonical.toLowerCase());
  if (exact) return exact;

  // Language-only fallback.
  const base = parts[0].toLowerCase();
  return LANGUAGE_ALIASES[base];
}

export interface LocalePreferenceInput {
  /** Explicit user preference — highest precedence. */
  userLocale?: string | null;
  /** Organization default — middle precedence. */
  orgLocale?: string | null;
  /** Raw Accept-Language header — first-visit detection only. */
  acceptLanguage?: string | null;
  /** Overall default when everything else is absent. */
  defaultLocale?: SupportedLocale;
}

export interface ResolvedLocale {
  locale: SupportedLocale;
  source: 'user' | 'org' | 'accept-language' | 'default';
}

/**
 * Resolve a locale with explicit precedence:
 * user → org → Accept-Language → en.
 * An unrecognized higher-precedence value is skipped, never coerced.
 */
export function resolveLocale(input: LocalePreferenceInput): ResolvedLocale {
  const user = normalizeLocale(input.userLocale);
  if (user) return { locale: user, source: 'user' };

  const org = normalizeLocale(input.orgLocale);
  if (org) return { locale: org, source: 'org' };

  const accept = pickFromAcceptLanguage(input.acceptLanguage);
  if (accept) return { locale: accept, source: 'accept-language' };

  return { locale: input.defaultLocale ?? FALLBACK_LOCALE, source: 'default' };
}

/**
 * Parse an Accept-Language header by descending quality weight.
 * Ties keep header order. Unknown languages are skipped.
 */
export function pickFromAcceptLanguage(header: string | null | undefined): SupportedLocale | undefined {
  if (!header || typeof header !== 'string') return undefined;

  const entries = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      let quality = 1;
      for (const param of params) {
        const [key, value] = param.trim().split('=');
        if (key?.toLowerCase() === 'q') {
          const parsed = Number.parseFloat(value ?? '');
          quality = Number.isFinite(parsed) ? parsed : 0;
        }
      }
      return { tag: tag.trim(), quality, index };
    })
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    .sort((a, b) => (b.quality - a.quality) || (a.index - b.index));

  for (const entry of entries) {
    const normalized = normalizeLocale(entry.tag);
    if (normalized) return normalized;
  }
  return undefined;
}

/** A flat catalog of message keys to translated strings. */
export type Catalog = Record<string, string>;

/** The complete typed key set. Every supported catalog must cover exactly this. */
export const MESSAGE_KEYS = [
  'nav.dashboard',
  'nav.talent',
  'nav.shifts',
  'shifts.accessUnavailable',
  'shifts.accessUnavailableDescription',
  'shifts.back',
  'shifts.title',
  'shifts.description',
  'shifts.accessWarning',
  'shifts.handoffNotes',
  'shifts.timeTo',
  'shifts.utc',
  'shifts.refresh',
  'shifts.loadFailed',
  'shifts.empty',
  'shifts.emptyContact',
  'shifts.queue',
  'shifts.recordedStatus',
  'shifts.invalidTime',
  'shifts.activeAtLoad',
  'shifts.openInbox',
  'shifts.openFans',
  'shifts.ended',
  'shifts.notStarted',
  'shifts.notActive',
  'shifts.refreshAfterUpdate',
  'shifts.pages',
  'shifts.firstPage',
  'shifts.nextPage',
  'team.shiftTime',
  'team.handoffForNextOperator',
  'team.handoffSaveHint',
  'team.closedCannotEdit',
  'team.startShift',
  'team.completeShift',
  'team.cancelShift',
  'team.operationsDescription',
  'team.olderShiftsLoadFailed',
  'team.olderNotesLoadFailed',
  'team.teamChangeNotAccepted',
  'team.teamChangeNotConfirmed',
  'team.chooseActorTimes',
  'team.enterNote',
  'team.llmActor',
  'team.humanActor',
  'team.loadOlderShifts',
  'team.loadOlderNotes',
  'team.scheduleShift',
  'team.actorType',
  'team.humanChatter',
  'team.assignedLlm',
  'team.teamMember',
  'team.llmPermission',
  'team.selectEditableActor',
  'team.queue',
  'team.starts',
  'team.ends',
  'team.shiftNote',
  'team.addInternalNote',
  'team.internalNotePlaceholder',
  'team.saveInternalNote',
  'team.retrySameChange',
  'team.recentNotes',
  'team.unknownActor',
  'nav.members',
  'nav.grokStorage',
  'connection.title',
  'connection.description',
  'connection.statusConnected',
  'connection.statusNotConnected',
  'connection.statusChecking',
  'connection.statusUnavailable',
  'connection.connecting',
  'connection.disconnecting',
  'connection.disconnected',
  'connection.changeUnconfirmed',
  'connection.disconnectConfirm',
  'connection.loginOutput',
  'connection.providerOpenAI',
  'connection.providerAnthropic',
  'affiliate.accessTitle',
  'affiliate.accessDescription',
  'affiliate.backToWorkspace',
  'affiliate.loadFailed',
  'affiliate.eyebrow',
  'affiliate.title',
  'affiliate.description',
  'affiliate.summaryAria',
  'affiliate.partners',
  'affiliate.activeDisclosure',
  'affiliate.campaigns',
  'affiliate.attributionEvents',
  'affiliate.accruedCommission',
  'affiliate.openHolds',
  'affiliate.partnerOnboarding',
  'affiliate.invitePartner',
  'affiliate.displayName',
  'affiliate.email',
  'affiliate.termsVersion',
  'affiliate.status',
  'affiliate.invited',
  'affiliate.activeNow',
  'affiliate.disclosureAcceptance',
  'affiliate.activeRequiresDisclosure',
  'affiliate.createPartner',
  'affiliate.attributionSetup',
  'affiliate.createCampaign',
  'affiliate.activePartner',
  'affiliate.selectDisclosedPartner',
  'affiliate.campaignName',
  'affiliate.slug',
  'affiliate.commissionBps',
  'affiliate.state',
  'affiliate.draft',
  'affiliate.active',
  'affiliate.defaultRate',
  'affiliate.partnerCreated',
  'affiliate.campaignCreated',
  'affiliate.statusChanged',
  'affiliate.holdResolved',
  'affiliate.requestUnconfirmed',
  'affiliate.retrySame',
  'affiliate.reportLoadFailed',
  'affiliate.partnerLedger',
  'affiliate.referralPartners',
  'affiliate.terms',
  'affiliate.noPartners',
  'affiliate.partnerTable',
  'affiliate.name',
  'affiliate.actions',
  'affiliate.disclosureRecorded',
  'affiliate.disclosurePending',
  'affiliate.activate',
  'affiliate.suspend',
  'affiliate.reactivate',
  'affiliate.payoutCsv',
  'affiliate.referralLinks',
  'affiliate.campaignsHeading',
  'affiliate.noCampaigns',
  'affiliate.campaignTable',
  'affiliate.campaign',
  'affiliate.partner',
  'affiliate.commission',
  'affiliate.referralToken',
  'affiliate.viewReport',
  'affiliate.reportTitle',
  'affiliate.clicksVisits',
  'affiliate.identityStitches',
  'affiliate.conversions',
  'affiliate.attributedSignups',
  'affiliate.exportable',
  'affiliate.blockedOpenHold',
  'affiliate.noOpenHold',
  'affiliate.riskReview',
  'affiliate.holdsTitle',
  'affiliate.holdDescription',
  'affiliate.noOpenHolds',
  'affiliate.reason',
  'affiliate.opened',
  'affiliate.decision',
  'affiliate.release',
  'affiliate.uphold',
  'affiliate.status.active',
  'affiliate.status.invited',
  'affiliate.status.suspended',
  'affiliate.status.draft',
  'affiliate.status.open',
  'affiliate.status.resolved',
  'affiliate.status.approved',
  'affiliate.status.revoked',
  'affiliate.status.released',
  'affiliate.status.upheld',
  'earnings.accessTitle',
  'earnings.accessDescription',
  'earnings.backToWorkspace',
  'earnings.title',
  'earnings.description',
  'earnings.accountsLoadFailed',
  'earnings.accountUnavailable',
  'earnings.readFailed',
  'earnings.reloadChoices',
  'earnings.noConnectedTitle',
  'earnings.noConnectedDescription',
  'earnings.openProfile',
  'earnings.accountLabel',
  'earnings.selectAccount',
  'earnings.refresh',
  'earnings.load',
  'earnings.freshData',
  'earnings.readAmounts',
  'earnings.amountsDescription',
  'earnings.rewardsNote',
  'earnings.observedAt',
  'earnings.periodTimezone',
  'earnings.allTime',
  'earnings.thisMonth',
  'earnings.previousMonth',
  'earnings.gross',
  'earnings.netAfterFees',
  'earnings.monthChange',
  'earnings.notComparable',
  'earnings.bySource',
  'earnings.providerPeriod',
  'earnings.noBound',
  'earnings.timeline',
  'earnings.noTimeline',
  'earnings.timelineCaption',
  'earnings.periodStart',
  'earnings.source.subs',
  'earnings.source.messages',
  'earnings.source.posts',
  'earnings.source.tips',
  'earnings.source.referrals',
  'earnings.source.renewals',
  'earnings.source.other',
  'nav.audit',
  'audit.title',
  'audit.chainValid',
  'audit.chainBroken',
  'audit.entries',
  'audit.when',
  'audit.actor',
  'audit.action',
  'audit.target',
  'audit.detail',
  'audit.noEntries',
  'audit.loadFailed',
  'nav.incidents',
  'nav.safety',
  'nav.digests',
  'nav.affiliate',
  'nav.primary',
  'nav.inbox',
  'nav.calendar',
  'nav.earnings',
  'nav.settings',
  'brand.creatorIntelligence',
  'brand.creatorOs',
  'layout.home',
  'layout.workspace',
  'layout.authPendingTitle',
  'layout.authPendingSignedIn',
  'layout.authPendingContact',
  'layout.privateByDesign',
  'layout.systemHealth',
  'system.workspaceSession',
  'system.signedIn',
  'role.owner',
  'role.manager',
  'role.operator',
  'role.analyst',
  'role.agent',
  'role.chatter',
  'role.contentCreator',
  'role.model',
  'role.member',
  'auth.introduction',
  'auth.privateCreatorOs',
  'auth.runWorld',
  'auth.beautifully',
  'auth.description',
  'auth.privateByDesign',
  'auth.selfHosted',
  'auth.alwaysInControl',
  'auth.welcomeBack',
  'auth.enterStudio',
  'auth.signInContinue',
  'auth.protected',
  'auth.email',
  'auth.password',
  'auth.emailPlaceholder',
  'auth.wait',
  'auth.createAccount',
  'auth.signIn',
  'auth.useExisting',
  'auth.firstTime',
  'auth.passwordHint',
  'auth.accountCreationFailed',
  'auth.signInFailed',
  'auth.accountCreationAccepted',
  'auth.signInAccepted',
  'auth.sessionNotConfirmed',
  'auth.networkError',
  'auth.sessionSignupAdvice',
  'auth.sessionSigninAdvice',
  'action.signOut',
  'ui.skipToContent',
  'settings.language',
  'settings.language.description',
  'settings.appliesTo',
  'settings.myAccount',
  'settings.workspaceDefault',
  'settings.interfaceLanguage',
  'settings.currentResolution',
  'settings.savedAs',
  'settings.saving',
  'settings.retrySameLanguage',
  'settings.saveLanguage',
  'settings.title',
  'settings.workspaceTitle',
  'settings.loadFailed',
  'settings.workspaceAria',
  'settings.viralSharing',
  'settings.viralSharingDescription',
  'settings.weeklyDigest',
  'settings.weeklyDigestDescription',
  'settings.publishingWorkers',
  'settings.publishingWorkersDescription',
  'settings.saved',
  'settings.saveNotConfirmed',
  'settings.retrySameSettings',
  'settings.saveWorkspace',
  'settings.savingWorkspace',
  'analytics.title',
  'analytics.downloadPdf',
  'analytics.views',
  'analytics.likes',
  'analytics.shares',
  'analytics.comments',
  'analytics.lastDays',
  'analytics.perPlatform',
  'analytics.noMetrics',
  'analytics.engagement',
  'analytics.dailyTrend',
  'analytics.day',
  'analytics.noAnalytics',
  'analytics.playbookContext',
  'analytics.playbookContextDescription',
  'analytics.reviewPlaybook',
  'analytics.playbookLoadFailed',
  'analytics.noGuidelines',
  'analytics.cadenceTarget',
  'analytics.suggestedTimes',
  'analytics.noneSaved',
  'analytics.upsellStrategy',
  'analytics.noneConfigured',
  'analytics.viralInsights',
  'analytics.verifiedExemplarDisclaimer',
  'analytics.noVerifiedExemplars',
  'analytics.labels',
  'analytics.byPlatform',
  'analytics.topPerformers',
  'analytics.analyticsAccessUnavailable',
  'analytics.analyticsAccessDenied',
  'analytics.backToWorkspace',
  'analytics.platform',
  'analytics.viralLoadFailed',
  'analytics.playbookAria',
  'incidents.title',
  'incidents.crashReports',
  'incidents.crashReportsDescription',
  'incidents.crashReportStatus',
  'incidents.open',
  'incidents.resolved',
  'incidents.ignored',
  'incidents.noCrashReports',
  'incidents.crashReportsLoadFailed',
  'incidents.occurrences',
  'incidents.lastSeen',
  'incidents.latestReports',
  'incidents.olderReports',
  'incidents.crashReportPages',
  'incidents.jobRecovery',
  'incidents.noFailedJobs',
  'incidents.kind',
  'incidents.state',
  'incidents.attempts',
  'incidents.error',
  'incidents.created',
  'incidents.errorDetails',
  'incidents.noErrorDetail',
  'incidents.reconcileBeforeReplay',
  'incidents.latestFailedJobs',
  'incidents.olderFailedJobs',
  'incidents.recoveryJobPages',
  'incidents.markResolved',
  'incidents.saving',
  'incidents.resolutionNotConfirmed',
  'incidents.resolvedNotice',
  'incidents.retryResolution',
  'incidents.replay',
  'incidents.requeued',
  'incidents.replayFailed',
  'incidents.replayNotConfirmed',
  'safety.title',
  'safety.ownerOnly',
  'safety.ownerOnlyDescription',
  'safety.back',
  'safety.statusUnknown',
  'safety.reload',
  'safety.publishing',
  'safety.halted',
  'safety.notHalted',
  'safety.reason',
  'safety.noReason',
  'safety.started',
  'safety.description',
  'safety.reasonLabel',
  'safety.reasonPlaceholder',
  'safety.restore',
  'safety.engage',
  'safety.restoring',
  'safety.engaging',
  'safety.actionFailed',
  'safety.networkError',
  'safety.checking',
  'safety.unavailable',
  'safety.unavailableDescription',
  'safety.globalEnabled',
  'safety.publishingHalted',
  'action.save',
  'action.cancel',
  'action.retry',
  'action.connect',
  'action.disconnect',
  'status.loading',
  'status.empty',
  'status.error',
  'status.saved',
  'error.generic',
  'error.network',
  'error.unauthorized',
  'integration.patreon.connect',
  'integration.patreon.sync',
  'integration.patreon.manualAssist',
  'mobile.patreon.eyebrow',
  'mobile.patreon.subtitle',
  'mobile.patreon.badge',
  'mobile.patreon.model',
  'mobile.patreon.loadingModels',
  'mobile.patreon.noModels',
  'mobile.patreon.retryModels',
  'mobile.patreon.loadingCommunity',
  'mobile.patreon.notConnected',
  'mobile.patreon.connectDescription',
  'mobile.patreon.providerEncrypted',
  'mobile.patreon.syncControls',
  'mobile.patreon.syncHint',
  'mobile.patreon.roleView',
  'mobile.patreon.webhookReceived',
  'mobile.patreon.noWebhook',
  'mobile.patreon.noRecords',
  'mobile.patreon.manualAssistBoundary',
  'mobile.patreon.deniedActions',
  'mobile.patreon.secureOpened',
  'mobile.patreon.secureOpenFailed',
  'mobile.patreon.syncAlready',
  'mobile.patreon.syncCompleted',
  'mobile.patreon.syncFailed',
  'mobile.patreon.lastSyncFailed',
  'mobile.patreon.lastSyncCompleted',
  'mobile.patreon.notSynced',
  'mobile.patreon.campaigns',
  'mobile.patreon.members',
  'mobile.patreon.posts',
  'mobile.patreon.updated',
  'mobile.patreon.selectModel',
  'mobile.studioOverview',
  'mobile.privateWorkspace',
  'mobile.orgSettings',
  'mobile.viralSharing',
  'mobile.viralSharingHint',
  'mobile.publishingEnabled',
  'mobile.publishingHint',
  'mobile.on',
  'mobile.off',
  'mobile.noOrgSettings',
  'mobile.weeklyDigests',
  'mobile.generate',
  'mobile.digestEmpty',
  'mobile.untitledDigest',
  'mobile.unknownChannel',
  'mobile.crashReports',
  'mobile.noCrashes',
  'mobile.loadingDashboard',
  'mobile.signOut',
  'mobile.languageSaved',
  'mobile.digestEnqueued',
  'mobile.noMessage',
  'mobile.lastSeen',
  'mobile.crashCount',
  'mobile.language',
  'mobile.greeting',
  'mobile.relayLoading',
  'mobile.relayEyebrow',
  'mobile.relayTitle',
  'mobile.relaySubtitle',
  'mobile.incidents',
  'mobile.noIncidents',
  'mobile.digestCards',
  'mobile.noDigestCards',
  'mobile.noReportMessage',
  'mobile.crashStatus',
  'mobile.storedOnly',
  'mobile.dispatchAttempted',
  'mobile.outcomeUnknown',
  'mobile.digestMeta',
  'digest.title',
  'digest.description',
  'digest.viewAuditTrail',
  'digest.requiresRole',
  'digest.loadFailed',
  'digest.empty',
  'digest.untitled',
  'digest.storedOnly',
  'digest.dispatchAttempted',
  'digest.outcomeUnknown',
  'digest.noSummary',
  'digest.created',
  'digest.pages',
  'digest.latest',
  'digest.older',
  'digest.generate.busy',
  'digest.generate.cta',
  'digest.generate.notConfirmed',
  'digest.generate.unconfirmed',
  'digest.generate.unconfirmedRetry',
  'digest.generate.queued',
  'digest.schedule.aria',
  'digest.schedule.heading',
  'digest.schedule.unavailable',
  'digest.schedule.off',
  'digest.schedule.noJob',
  'digest.schedule.queued',
  'digest.schedule.running',
  'digest.schedule.dead',
  'digest.schedule.done',
  'digest.schedule.review',
  'digest.schedule.safetyOff',
  'digest.schedule.eligible',
  'digest.schedule.storageNote',
  'digest.schedule.manage',
  'digest.recover.aria',
  'digest.recover.heading',
  'digest.recover.description',
  'digest.recover.confirm',
  'digest.recover.saving',
  'digest.recover.retry',
  'digest.recover.start',
  'digest.recover.rejected',
  'digest.recover.saved',
  'digest.recover.notConfirmed',
  'relay.title',
  'relay.destinations.heading',
  'relay.destinations.loadFailed',
  'relay.history.heading',
  'relay.history.subtle',
  'relay.history.loadFailed',
  'relay.howItWorks.heading',
  'relay.howItWorks.description',
  'relay.card.empty',
  'relay.card.untitled',
  'relay.card.channelUnassigned',
  'relay.card.dateUnavailable',
  'relay.card.enabled',
  'relay.card.disabled',
  'relay.card.priority',
  'relay.card.openApproval',
  'relay.card.older',
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

/** Values valid for interpolation are strings and numbers only. */
export type InterpolationValues = Record<string, string | number>;

export interface DiagnosticEvent {
  type: 'missing_key' | 'missing_translation';
  key: string;
  locale: SupportedLocale;
}

export type DiagnosticSink = (event: DiagnosticEvent) => void;

/**
 * A validated catalog set. Construction fails loud if any supported locale is
 * missing a key, so a raw key can never reach a user at runtime.
 */
export class LocaleCatalog {
  private readonly catalogs: Record<SupportedLocale, Catalog>;
  private readonly sink?: DiagnosticSink;

  constructor(catalogs: Record<SupportedLocale, Catalog>, sink?: DiagnosticSink) {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = catalogs[locale];
      if (!catalog) {
        throw new Error(`locale catalog missing for '${locale}'`);
      }
      const missing = MESSAGE_KEYS.filter((key) => typeof catalog[key] !== 'string');
      if (missing.length > 0) {
        throw new Error(`locale catalog '${locale}' missing keys: ${missing.join(', ')}`);
      }
    }
    this.catalogs = catalogs;
    this.sink = sink;
  }

  /** True when the locale's catalog covers every typed key. */
  isComplete(locale: SupportedLocale): boolean {
    const catalog = this.catalogs[locale];
    return MESSAGE_KEYS.every((key) => typeof catalog[key] === 'string');
  }

  /**
   * Translate a key, falling back to English, then to a safe literal that is
   * never a raw key. Missing translations emit a test-visible diagnostic.
   */
  t(locale: SupportedLocale, key: string, values?: InterpolationValues): string {
    const localized = this.catalogs[locale]?.[key];
    if (typeof localized === 'string') {
      return interpolate(localized, values);
    }

    const fallback = this.catalogs[FALLBACK_LOCALE]?.[key];
    if (typeof fallback === 'string') {
      if (locale !== FALLBACK_LOCALE) {
        this.emit({ type: 'missing_translation', key, locale });
      }
      return interpolate(fallback, values);
    }

    this.emit({ type: 'missing_key', key, locale });
    return localized ?? fallback ?? '';
  }

  private emit(event: DiagnosticEvent): void {
    if (this.sink) this.sink(event);
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape HTML-significant characters in an interpolated value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Interpolate `{name}` placeholders. Values are escaped before substitution so
 * user text can never inject markup, and unknown placeholders are left intact
 * rather than being replaced with "undefined".
 */
export function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) return match;
    return escapeHtml(String(value));
  });
}

/** Locale used for Intl formatting, kept separate from message catalogs. */
export function intlLocale(locale: SupportedLocale): string {
  return locale;
}

export function formatNumber(value: number, locale: SupportedLocale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function formatCurrency(
  value: number,
  locale: SupportedLocale,
  currency: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency, ...options }).format(value);
}

export function formatDate(
  value: Date | number,
  locale: SupportedLocale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(value);
}

/**
 * Validate that UI locale and content locale are never conflated.
 * Content (captions, persona text, playbooks) is authored, not translated.
 */
export interface LocaleSettings {
  uiLocale: SupportedLocale;
  /** Model/creator content locale — never derived from uiLocale. */
  contentLocale?: string;
}

export function makeLocaleSettings(uiLocale: SupportedLocale, contentLocale?: string): LocaleSettings {
  return contentLocale === undefined ? { uiLocale } : { uiLocale, contentLocale };
}

/** Accessible `lang` attribute metadata for a rendered surface. */
export interface LangMetadata {
  lang: string;
  dir: 'ltr' | 'rtl';
}

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function langMetadata(locale: SupportedLocale): LangMetadata {
  const base = locale.split('-')[0].toLowerCase();
  return { lang: locale, dir: RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr' };
}
