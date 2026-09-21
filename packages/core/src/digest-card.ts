// ─── Operator-visible weekly digest card rendering (F-89 / F-28) ───
//
// The digest executor writes a durable relay_card that an operator reads. This
// module owns the locale-correct rendering of that card: the organization's
// persisted UI locale is resolved through the existing typed locale contract,
// message text comes from the shared six-locale catalog and every number/date
// is formatted with the locale-aware helpers under an explicit UTC policy.
//
// UI locale and content (creator/model) locale stay separate. Provider-authored
// platform names are data: they are never translated or reinterpreted.

import {
  FALLBACK_LOCALE,
  formatDate,
  formatNumber,
  normalizeLocale,
  type SupportedLocale,
} from './locale.js';
import { CATALOGS } from './catalogs.js';
import { LocaleCatalog } from './locale.js';
import type { UiLocalePreferenceRow } from './locale-settings.js';

/** Shared, validated catalog set used for the digest card surface. */
const digestCatalog = new LocaleCatalog(CATALOGS);

/**
 * Resolve the UI locale for an unattended, organization-scoped card.
 *
 * An automatic weekly digest has no visiting user, so only the organization
 * preference applies. An absent, unrecognized or malformed stored value falls
 * back to English rather than being coerced to an arbitrary locale.
 */
export function resolveOrgDigestLocale(rows: UiLocalePreferenceRow[] | undefined): {
  locale: SupportedLocale;
  source: 'org' | 'default';
} {
  const orgRow = rows?.find((row) => row?.scope === 'org');
  const orgLocale = normalizeLocale(orgRow?.locale);
  if (orgLocale) return { locale: orgLocale, source: 'org' };
  return { locale: FALLBACK_LOCALE, source: 'default' };
}

/** Inputs the digest executor has already computed for the card. */
export interface DigestCardInput {
  /** Window start (inclusive) as an ISO-8601 UTC instant. */
  weekStart: string;
  posts: number;
  views: number;
  avgEngagement: number;
  topPlatform: string;
  viralPosts: number;
  strongPosts: number;
}

/** The rendered, locale-correct fields of a digest relay card. */
export interface DigestCardText {
  locale: SupportedLocale;
  localeSource: 'org' | 'default';
  title: string;
  description: string;
}

/**
 * Render the operator-visible digest card in the resolved organization locale.
 *
 * Formatting policy: numbers and the window date are rendered with the locale's
 * Intl conventions, while the window date is pinned to UTC (`timeZone: 'UTC'`)
 * so the calendar day is stable regardless of worker host time zone.
 */
export function renderDigestCard(
  locale: SupportedLocale,
  input: DigestCardInput,
): DigestCardText {
  const t = (key: string, values?: Record<string, string | number>): string =>
    digestCatalog.t(locale, key, values);

  const engagement = formatNumber(input.avgEngagement * 100, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const views = formatNumber(input.views, locale);
  const posts = formatNumber(input.posts, locale);
  const viral = formatNumber(input.viralPosts, locale);
  const strong = formatNumber(input.strongPosts, locale);

  const weekStartDate = new Date(input.weekStart);
  const dateLabel = Number.isNaN(weekStartDate.getTime())
    ? ''
    : formatDate(weekStartDate, locale, { timeZone: 'UTC', dateStyle: 'medium' });

  // Top platform is provider-authored data. It is substituted as a value, never
  // translated; a missing platform renders the localized "unavailable" literal.
  const platform =
    input.topPlatform && input.topPlatform !== 'n/a'
      ? input.topPlatform
      : t('digest.card.topPlatformUnavailable');

  const engagementLabel = t('digest.card.avgEngagement', { percent: engagement });

  const description =
    `${t('digest.card.description', {
      posts,
      views,
      engagement: engagementLabel,
      platform,
    })} ${t('digest.card.notWeeklyGain')} ${t('digest.card.exemplars', { viral, strong })}`;

  return {
    locale,
    localeSource: 'org',
    title: t('digest.card.title', { date: dateLabel }),
    description,
  };
}

export interface ViralInsightGroup {
  platform: string;
  learningArm: string;
  learningContext: string;
  sampleSize: number;
  meanScore: number;
  publishedHourUtc: number | null;
}

export interface ViralInsightCardInput {
  groups: ViralInsightGroup[];
  totalSamples: number;
}

/**
 * Render a bounded, evidence-only viral insight card. Provider names and
 * learning-arm values remain data; the catalog supplies the surrounding UI
 * language. This intentionally makes no recommendation or conversion claim.
 */
export function renderViralInsightCard(
  locale: SupportedLocale,
  input: ViralInsightCardInput,
): DigestCardText {
  const t = (key: string, values?: Record<string, string | number>): string =>
    digestCatalog.t(locale, key, values);
  const top = input.groups[0];
  const platform = top?.platform || t('digest.card.topPlatformUnavailable');
  const samples = formatNumber(input.totalSamples, locale);
  const score = top
    ? formatNumber(top.meanScore, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : formatNumber(0, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const timing = top?.publishedHourUtc == null
    ? t('dashboard.performance.scheduledTimeUnknown')
    : `${String(top.publishedHourUtc).padStart(2, '0')}:00 UTC`;
  const arm = top?.learningArm || 'unknown';

  return {
    locale,
    localeSource: 'org',
    title: t('dashboard.performance.title'),
    description: [
      t('dashboard.performance.description'),
      t('dashboard.performance.labeledExemplars', { count: samples }),
      `${platform} · ${arm} · ${timing}`,
      t('dashboard.performance.meanRelativeScore', { score }),
      t('dashboard.performance.showingTopGroups'),
    ].join(' '),
  };
}
