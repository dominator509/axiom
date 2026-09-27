import type { Metadata } from 'next';
import { headers } from 'next/headers';
import LoginForm from '@/components/LoginForm';
import LocaleProvider from '@/components/LocaleProvider';
import BrandMark, { BrandWordmark } from '@/components/BrandMark';
import { CATALOGS, LocaleCatalog, resolveLocale } from '@axiom/core';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const rawReferral = query?.affiliate_ref;
  const affiliateRef = typeof rawReferral === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(rawReferral)
    ? rawReferral
    : undefined;
  const requestHeaders = await headers();
  const locale = resolveLocale({ acceptLanguage: requestHeaders.get('accept-language') }).locale;
  const copy = new LocaleCatalog(CATALOGS);
  const t = (key: string, values?: Record<string, string | number>) => copy.t(locale, key, values);

  return (
    <LocaleProvider initialLocale={locale}>
    <div className="login-page">
      <section className="login-story" aria-label={t('auth.introduction')}>
        <div className="brand login-brand">
          <BrandMark />
          <span className="brand-copy">
            <BrandWordmark />
            <small>{t('brand.creatorIntelligence')}</small>
          </span>
        </div>
        <div className="login-story-copy">
          <p className="eyebrow">{t('auth.privateCreatorOs')}</p>
          <h1>
            {t('auth.runWorld')}
            <br />
            <em>{t('auth.beautifully')}</em>
          </h1>
          <p>{t('auth.description')}</p>
        </div>
        <div className="trust-row">
          <span>{t('auth.privateByDesign')}</span>
          <span>{t('auth.selfHosted')}</span>
          <span>{t('auth.alwaysInControl')}</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">{t('auth.welcomeBack')}</p>
          <h2>{t('auth.enterStudio')}</h2>
          <p className="subtle">{t('auth.signInContinue')}</p>
          <LoginForm allowSignup={process.env.AXIOM_ENABLE_LOCAL_SIGNUP === '1'} affiliateRef={affiliateRef} />
          <p className="login-footnote">{t('auth.protected')}</p>
        </div>
      </section>
    </div>
    </LocaleProvider>
  );
}
