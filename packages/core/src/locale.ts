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
  'nav.members',
  'nav.grokStorage',
  'nav.audit',
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
