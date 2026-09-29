'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatNumber } from '@axiom/core';
import type { SupportedLocale } from '@axiom/core';
import type { ModelProfile } from '@/lib/api';
import {
  mergeTalentRosterProfiles,
  parseTalentRosterProfile,
  TALENT_PROFILE_CREATED_EVENT,
  type TalentRosterProfile,
} from '@/lib/talent-roster';
import { useLocale } from './LocaleProvider';

export default function TalentRoster({ models, totalCount, nextCursor, cursor, error, serverLocale }: {
  models: ModelProfile[];
  totalCount: number | null;
  nextCursor: string | null;
  cursor?: string;
  error: boolean;
  serverLocale: SupportedLocale;
}) {
  // The server render and the first client render must format with the same locale
  // or React hydration mismatches (#418). This never changes after mount.
  const { t, locale: clientLocale } = useLocale();
  const locale = serverLocale ?? clientLocale;
  const [createdProfiles, setCreatedProfiles] = useState<TalentRosterProfile[]>([]);

  useEffect(() => {
    const onCreated = (event: Event) => {
      const profile = parseTalentRosterProfile((event as CustomEvent<unknown>).detail);
      if (!profile) return;
      setCreatedProfiles(current => current.some(existing => existing.id === profile.id)
        ? current
        : [profile, ...current]);
    };
    window.addEventListener(TALENT_PROFILE_CREATED_EVENT, onCreated);
    return () => window.removeEventListener(TALENT_PROFILE_CREATED_EVENT, onCreated);
  }, []);

  const scopedCreated = cursor ? [] : createdProfiles;
  const roster = useMemo(
    () => mergeTalentRosterProfiles(models, cursor ? [] : createdProfiles),
    [models, createdProfiles, cursor],
  );
  const serverIds = useMemo(() => new Set(models.map(model => model.id)), [models]);
  // A creation receipt is scoped to the first page: on a later cursor the
  // page-1 row must not leak in and the organization total already counts it.
  const newlyCounted = scopedCreated.filter(profile => !serverIds.has(profile.id)).length;
  const visibleTotal = totalCount === null ? null : totalCount + newlyCounted;
  const activeCount = roster.filter(model => model.isActive).length;

  return <>
    <section className="stat-grid" aria-label={t('home.portfolioSummary')}>
      <div className="stat-card">
        <span>{t('home.totalTalent')}</span>
        <strong>{visibleTotal === null ? t('home.unavailable') : formatNumber(visibleTotal, locale)}</strong>
        <small>{visibleTotal === null ? t('home.countUnavailable') : t('home.profilesInStudio')}</small>
      </div>
      <div className="stat-card">
        <span>{t('home.activeOnPage')}</span>
        <strong>{formatNumber(activeCount, locale)}</strong>
        <small>{t('home.profilesMarkedActive')}</small>
      </div>
      <div className="stat-card accent">
        <span>{t('home.profileList')}</span>
        <strong>{error ? t('home.unavailable') : t('home.loaded')}</strong>
        <small>{error ? t('home.profileRequestFailed') : t('home.profilesShown', { count: formatNumber(roster.length, locale) })}</small>
      </div>
    </section>

    {error && <div className="notice error" role="alert"><strong>{t('home.workspaceUnreachable')}</strong></div>}

    {roster.length === 0 && !error && <div className="empty-state card">
      <span className="empty-mark">A</span>
      <h2>{cursor ? t('home.noMoreProfiles') : t('home.noProfilesYet')}</h2>
      <p>{cursor ? t('home.returnFirstPage') : t('home.createFirstProfile')}</p>
    </div>}

    {roster.length > 0 && <div className="section-heading">
      <div>
        <p className="eyebrow">{t('home.roster')}</p>
        <h2>{t('home.talentProfiles')}</h2>
      </div>
      <span>{t('home.shown', { count: formatNumber(roster.length, locale) })}</span>
    </div>}
    <div id="talent-profiles" className="grid talent-grid" tabIndex={-1}>
      {roster.map(model => <div key={model.id}>
        <Link href={`/models/${model.id}`} className="model-link">
          <article className="card model-card">
            <div className="model-card-top">
              <span className="talent-avatar small">{model.displayName.slice(0, 1).toUpperCase()}</span>
              {model.isActive
                ? <span className="badge good"><i /> {t('home.active')}</span>
                : <span className="badge mute"><i /> {t('home.inactive')}</span>}
            </div>
            <div className="model-card-copy">
              <h2>{model.displayName}</h2>
              <p className="handle">@{model.handle}</p>
            </div>
            <p className="model-bio">{model.bio || t('home.freshProfile')}</p>
            <span className="card-link">{t('home.openWorkspace')} <span aria-hidden="true">→</span></span>
          </article>
        </Link>
        <div className="row" style={{ flexWrap: 'wrap', marginTop: 12 }}>
          <Link href={`/models/${model.id}/generation`} className="btn">{t('home.generateMedia')}</Link>
          <Link href={`/models/${model.id}/approvals`} className="btn secondary">{t('home.reviewContent')}</Link>
        </div>
      </div>)}
    </div>
    {(cursor || nextCursor) && <nav aria-label={t('home.talentPagination')} className="section-heading">
      {cursor && <Link href="/">{t('home.firstPage')}</Link>}
      {!error && nextCursor && <Link href={`/?${new URLSearchParams({ cursor: nextCursor })}`}>{t('home.nextPage')}</Link>}
    </nav>}
  </>;
}
