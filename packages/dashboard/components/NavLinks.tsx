'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Talent', icon: 'talent' },
  { href: '/audit', label: 'Audit trail', icon: 'audit' },
  { href: '/incidents', label: 'Incidents', icon: 'incident' },
  { href: '/killswitch', label: 'Safety', icon: 'safety' },
] as const;

function NavIcon({ name }: { name: (typeof NAV_ITEMS)[number]['icon'] }) {
  const paths = {
    talent: (
      <path d="M7.5 10.25a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM2.25 18a5.25 5.25 0 0 1 10.5 0M15.5 7.25v7.5M11.75 11h7.5" />
    ),
    audit: (
      <path d="M5 3.25h10a1.75 1.75 0 0 1 1.75 1.75v10A1.75 1.75 0 0 1 15 16.75H5A1.75 1.75 0 0 1 3.25 15V5A1.75 1.75 0 0 1 5 3.25Zm2.25 4h5.5m-5.5 3h5.5m-5.5 3h3.25" />
    ),
    incident: <path d="M10 2.5 18 17H2L10 2.5Zm0 5v4.25m0 2.5v.25" />,
    safety: (
      <path d="M10 2.25c2.1 1.45 4.08 2.12 6 2.25v4.75c0 4.13-2.38 6.95-6 8.5-3.62-1.55-6-4.37-6-8.5V4.5c1.92-.13 3.9-.8 6-2.25Zm-2.5 7.5 1.7 1.7 3.55-3.7" />
    ),
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

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Primary navigation">
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/' || pathname.startsWith('/models/')
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
