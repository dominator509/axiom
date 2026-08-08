import Link from 'next/link';
import { api } from '@/lib/api';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const TABS = [
  { href: '', label: 'Overview' },
  { href: 'network', label: 'Network' },
  { href: 'calendar', label: 'Calendar' },
  { href: 'generation', label: 'Generation' },
  { href: 'approvals', label: 'Approvals' },
  { href: 'fans', label: 'Fan CRM' },
  { href: 'linkbio', label: 'Link-in-bio' },
  { href: 'analytics', label: 'Analytics' },
  { href: 'playbook', label: 'Playbook' },
];

export default async function ModelLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  let model;
  try {
    model = (await api.models.get(id)).data;
  } catch {
    notFound();
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <Link href="/" style={{ color: 'var(--muted)', textDecoration: 'none', fontSize: 13 }}>
            ← Models
          </Link>
          <h1 style={{ margin: '4px 0 0' }}>{model.displayName}</h1>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>@{model.handle}</p>
        </div>
        {model.isActive ? (
          <span className="badge good">active</span>
        ) : (
          <span className="badge mute">inactive</span>
        )}
      </div>

      <nav className="tabs" style={{ marginTop: 16 }}>
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={`/models/${id}/${t.href}`}
            className={t.href === '' ? 'active' : ''}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
