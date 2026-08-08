import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { getSession } from '@/lib/api';
import KillSwitchBanner from '@/components/KillSwitchBanner';
import NavLinks from '@/components/NavLinks';
import SignOutButton from '@/components/SignOutButton';

export const metadata: Metadata = {
  title: { default: 'AXIOM — Creator OS', template: '%s · AXIOM' },
  description: 'Private creator intelligence and operations.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const email = (session as { user?: { email?: string } } | null)?.user?.email ?? 'operator';

  return (
    <html lang="en">
      <body>
        {!session ? (
          <main className="auth-shell">{children}</main>
        ) : (
          <div className="app-shell">
            <aside className="sidebar">
              <Link href="/" className="brand" aria-label="AXIOM home">
                <span className="brand-mark">A</span>
                <span className="brand-copy">
                  <strong>AXIOM</strong>
                  <small>Creator intelligence</small>
                </span>
              </Link>
              <p className="nav-kicker">Workspace</p>
              <NavLinks />
              <div className="sidebar-spacer" />
              <div className="system-card">
                <span className="status-dot" />
                <div>
                  <strong>Private cloud</strong>
                  <span>All systems connected</span>
                </div>
              </div>
              <div className="user-card">
                <span className="user-avatar">{email.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{email.split('@')[0]}</strong>
                  <span>Studio owner</span>
                </div>
                <SignOutButton />
              </div>
            </aside>
            <div className="workspace">
              <header className="mobile-bar">
                <Link href="/" className="brand compact">
                  <span className="brand-mark">A</span>
                  <strong>AXIOM</strong>
                </Link>
                <div className="mobile-actions">
                  <span className="eyebrow">Creator OS</span>
                  <SignOutButton />
                </div>
              </header>
              <div className="mobile-nav">
                <NavLinks />
              </div>
              <KillSwitchBanner />
              <main className="main">{children}</main>
              <footer className="footer">
                <span>Private by design · self-hosted</span>
                <Link href="/api/v1/health">
                  <span className="status-dot" /> System health
                </Link>
              </footer>
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
