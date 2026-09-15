'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '', label: 'Profile & character' },
  { href: 'generation', label: 'Create content' },
  { href: 'approvals', label: 'Review & approve' },
  { href: 'calendar', label: 'Schedule' },
  { href: 'fans', label: 'Fan contacts' },
  { href: 'linkbio', label: 'Link in bio' },
  { href: 'analytics', label: 'Analytics' },
  { href: 'playbook', label: 'Playbook' },
  { href: 'network', label: 'Network settings' },
] as const;

export default function ModelTabs({ modelId }: { modelId: string }) {
  const pathname = usePathname();
  const base = `/models/${modelId}`;

  return (
    <nav className="tabs" aria-label="Talent workspace">
      {TABS.map((tab) => {
        const href = tab.href ? `${base}/${tab.href}` : base;
        const active = pathname === href || pathname === `${href}/`;
        return (
          <Link
            key={tab.href}
            href={href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
