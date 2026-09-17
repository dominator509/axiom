'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { talentDestinationAllowed } from '@/lib/navigation-role';

const TABS = [
  { href: '', label: 'Profile & character' },
  { href: 'generation', label: 'Create content' },
  { href: 'media', label: 'Media library' },
  { href: 'consent', label: 'Consent vault' },
  { href: 'approvals', label: 'Review & approve' },
  { href: 'calendar', label: 'Schedule' },
  { href: 'fans', label: 'Fan contacts' },
  { href: 'linkbio', label: 'Link in bio' },
  { href: 'analytics', label: 'Analytics' },
  { href: 'earnings', label: 'Earnings' },
  { href: 'playbook', label: 'Playbook' },
  { href: 'network', label: 'Network settings' },
  { href: 'relay', label: 'Relay delivery' },
  { href: 'agents', label: 'Agent access' },
  { href: 'cascades', label: 'Cascade schedules' },
  { href: 'triggers', label: 'Automation rules' },
  { href: 'experiments', label: 'Variant experiments' },
  { href: 'scraping', label: 'Trend & competitor radar' },
  { href: 'team', label: 'Team & shifts' },
] as const;

export default function ModelTabs({ modelId, role }: { modelId: string; role?: string | null }) {
  const pathname = usePathname();
  const base = `/models/${modelId}`;

  return (
    <nav className="tabs" aria-label="Talent workspace">
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
            {role === 'content_creator' && tab.href === 'approvals' ? 'Review drafts' : tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
