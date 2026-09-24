'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import { useLocale } from './LocaleProvider';

const TABS = [
  { href: '', labelKey: 'model.profile' },
  { href: 'generation', labelKey: 'model.createContent' },
  { href: 'media', labelKey: 'media.title' },
  { href: 'consent', labelKey: 'model.toolConsent' },
  { href: 'approvals', labelKey: 'model.reviewContent' },
  { href: 'calendar', labelKey: 'model.viewSchedule' },
  { href: 'fans', labelKey: 'model.viewFanContacts' },
  { href: 'inbox', labelKey: 'nav.inbox' },
  { href: 'linkbio', labelKey: 'model.toolLinkBio' },
  { href: 'analytics', labelKey: 'analytics.title' },
  { href: 'earnings', labelKey: 'nav.earnings' },
  { href: 'playbook', labelKey: 'analytics.reviewPlaybook' },
  { href: 'network', labelKey: 'model.networkSecurity' },
  { href: 'patreon', labelKey: 'network.patreonCommunity' },
  { href: 'relay', labelKey: 'dashboard.tabs.relayDelivery' },
  { href: 'agents', labelKey: 'dashboard.tabs.agentAccess' },
  { href: 'cascades', labelKey: 'dashboard.tabs.cascadeSchedules' },
  { href: 'triggers', labelKey: 'dashboard.tabs.automationRules' },
  { href: 'experiments', labelKey: 'dashboard.tabs.variantExperiments' },
  { href: 'scraping', labelKey: 'scrape.title' },
  { href: 'team', labelKey: 'dashboard.tabs.teamShifts' },
  { href: 'roleplay', labelKey: 'dashboard.tabs.chatterRoleplay' },
] as const;

export default function ModelTabs({ modelId, role }: { modelId: string; role?: string | null }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const base = `/models/${modelId}`;

  return (
    <nav className="tabs" aria-label={t('dashboard.tabs.talentWorkspace')}>
      {TABS.filter(tab => talentDestinationAllowed(role, tab.href)).map((tab) => {
        const href = tab.href ? `${base}/${tab.href}` : base;
        const active = pathname === href || pathname === `${href}/`;
        return (
          <Link
            key={tab.href}
            href={href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {role === 'content_creator' && tab.href === 'approvals' ? t('calendar.reviewDrafts') : t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
