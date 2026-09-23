'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';
import { useLocale } from './LocaleProvider';

const NAV_ITEMS = [
  { href: '/', key: 'nav.talent', icon: 'talent' },
  { href: '/shifts', key: 'nav.shifts', icon: 'digest' },
  { href: '/members', key: 'nav.members', icon: 'talent' },
  { href: '/connections/grok', key: 'nav.grokStorage', icon: 'connection' },
  { href: '/audit', key: 'nav.audit', icon: 'audit' },
  { href: '/incidents', key: 'nav.incidents', icon: 'incident' },
  { href: '/health', key: 'nav.health', icon: 'health' },
  { href: '/killswitch', key: 'nav.safety', icon: 'safety' },
  { href: '/settings', key: 'nav.settings', icon: 'settings' },
  { href: '/digests', key: 'nav.digests', icon: 'digest' },
  { href: '/affiliate', key: 'nav.affiliate', icon: 'affiliate' },
] as const;

function NavIcon({ name }: { name: (typeof NAV_ITEMS)[number]['icon'] }) {
  const paths = {
    connection: <path d="M8 12 12 8M7 13l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m0 8a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-1 1" />,
    talent: (
      <path d="M7.5 10.25a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM2.25 18a5.25 5.25 0 0 1 10.5 0M15.5 7.25v7.5M11.75 11h7.5" />
    ),
    audit: (
      <path d="M5 3.25h10a1.75 1.75 0 0 1 1.75 1.75v10A1.75 1.75 0 0 1 15 16.75H5A1.75 1.75 0 0 1 3.25 15V5A1.75 1.75 0 0 1 5 3.25Zm2.25 4h5.5m-5.5 3h5.5m-5.5 3h3.25" />
    ),
    incident: <path d="M10 2.5 18 17H2L10 2.5Zm0 5v4.25m0 2.5v.25" />,
    health: <path d="M10 2.25 17 5v4.25c0 3.75-2.45 6.75-7 8.5-4.55-1.75-7-4.75-7-8.5V5l7-2.75Zm-3.25 7.5 2.1 2.1 4.4-4.6" />,
    safety: (
      <path d="M10 2.25c2.1 1.45 4.08 2.12 6 2.25v4.75c0 4.13-2.38 6.95-6 8.5-3.62-1.55-6-4.37-6-8.5V4.5c1.92-.13 3.9-.8 6-2.25Zm-2.5 7.5 1.7 1.7 3.55-3.7" />
    ),
    settings: <path d="M10 3v2m0 10v2M3 10h2m10 0h2M5.05 5.05l1.4 1.4m7.1 7.1 1.4 1.4m0-9.9-1.4 1.4m-7.1 7.1-1.4 1.4M13.5 10a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" />,
    digest: <path d="M4 4.5h12v11H4zM7 8h6M7 11h4M6 2.5v4M14 2.5v4" />,
    affiliate: <path d="M7.5 13.5 4 17m8.5-11L16 3m-9.5 4.5 6 6m-7.25-8a2.75 2.75 0 1 1-3.9 3.9 2.75 2.75 0 0 1 3.9-3.9Zm7.5 7.5a2.75 2.75 0 1 1 3.9 3.9 2.75 2.75 0 0 1-3.9-3.9Z" />,
  } as const;

  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export default function NavLinks({ role }: { role?: string | null }) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <nav className="nav" aria-label={t('nav.primary')}>
      {NAV_ITEMS.filter(item => workspaceDestinationAllowed(role, item.href)).map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/' || pathname.startsWith('/models/')
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            <NavIcon name={item.icon} />
            <span>{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
