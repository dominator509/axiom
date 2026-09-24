import type { Catalog, SupportedLocale } from './locale.js';

/** Feature-owned labels for persisted affiliate hold reason codes. */
export const PLATFORM_AFFILIATE_HOLD_REASON_KEYS = [
  'affiliate.holdReason.fraud_suspected',
  'affiliate.holdReason.chargeback',
  'affiliate.holdReason.self_referral',
  'affiliate.holdReason.terms_violation',
] as const;

export type PlatformAffiliateHoldReasonKey = (typeof PLATFORM_AFFILIATE_HOLD_REASON_KEYS)[number];

export const PLATFORM_AFFILIATE_CATALOGS: Record<SupportedLocale, Catalog> = {
  en: {
    'affiliate.holdReason.fraud_suspected': 'Suspected fraud',
    'affiliate.holdReason.chargeback': 'Chargeback',
    'affiliate.holdReason.self_referral': 'Self-referral',
    'affiliate.holdReason.terms_violation': 'Terms violation',
  },
  es: {
    'affiliate.holdReason.fraud_suspected': 'Posible fraude',
    'affiliate.holdReason.chargeback': 'Contracargo',
    'affiliate.holdReason.self_referral': 'Autorreferencia',
    'affiliate.holdReason.terms_violation': 'Incumplimiento de términos',
  },
  ja: {
    'affiliate.holdReason.fraud_suspected': '不正の疑い',
    'affiliate.holdReason.chargeback': 'チャージバック',
    'affiliate.holdReason.self_referral': '自己紹介による紹介',
    'affiliate.holdReason.terms_violation': '規約違反',
  },
  it: {
    'affiliate.holdReason.fraud_suspected': 'Frode sospetta',
    'affiliate.holdReason.chargeback': 'Chargeback',
    'affiliate.holdReason.self_referral': 'Autoreferenza',
    'affiliate.holdReason.terms_violation': 'Violazione dei termini',
  },
  'pt-BR': {
    'affiliate.holdReason.fraud_suspected': 'Suspeita de fraude',
    'affiliate.holdReason.chargeback': 'Chargeback',
    'affiliate.holdReason.self_referral': 'Autorreferência',
    'affiliate.holdReason.terms_violation': 'Violação dos termos',
  },
  de: {
    'affiliate.holdReason.fraud_suspected': 'Betrugsverdacht',
    'affiliate.holdReason.chargeback': 'Rückbuchung',
    'affiliate.holdReason.self_referral': 'Selbstempfehlung',
    'affiliate.holdReason.terms_violation': 'Verstoß gegen Bedingungen',
  },
};
