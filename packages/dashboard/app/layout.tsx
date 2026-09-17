import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { getSession } from '@/lib/api';
import KillSwitchBanner from '@/components/KillSwitchBanner';
import NavLinks from '@/components/NavLinks';
import SignOutButton from '@/components/SignOutButton';
import { roleLabel as displayRole } from '@/lib/navigation-role';

export const metadata: Metadata = {
  title: { default: 'FanThynks — Creator OS', template: '%s · FanThynks' },
  description: 'Private creator intelligence and operations.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const email = session?.user?.email ?? 'operator';
  const role = session?.user?.role;
  const roleLabel = displayRole(role);

  return (
    <html lang="en">
      <body>
        {!session ? (
          <main className="auth-shell">{children}</main>
        ) : !session.user?.orgId ? (
          <main className="auth-shell">
            <section className="login-card" aria-labelledby="access-heading">
              <h1 id="access-heading">Workspace access pending</h1>
              <p>You are signed in as {email}, but your account has no assigned organization.</p>
              <p>Contact your workspace administrator to arrange access, or sign out to use another account.</p>
              <SignOutButton />
            </section>
          </main>
        ) : (
          <div className="app-shell">
            <a href="#main-content" className="skip-link">Skip to page content</a>
            <aside className="sidebar">
              <Link href="/" className="brand" aria-label="FanThynks home">
                <span className="brand-mark">F</span>
                <span className="brand-copy">
                  <strong>FanThynks</strong>
                  <small>Creator intelligence</small>
                </span>
              </Link>
              <p className="nav-kicker">Workspace</p>
              <NavLinks role={role} />
              <div className="sidebar-spacer" />
              <div className="system-card">
                <div>
                  <strong>Workspace session</strong>
                  <span>Signed in</span>
                </div>
              </div>
              <div className="user-card">
                <span className="user-avatar">{email.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{email.split('@')[0]}</strong>
                  <span>{roleLabel}</span>
                </div>
                <SignOutButton />
              </div>
            </aside>
            <div className="workspace">
              <header className="mobile-bar">
                <Link href="/" className="brand compact">
                  <span className="brand-mark">F</span>
                  <strong>FanThynks</strong>
                </Link>
                <div className="mobile-actions">
                  <span className="eyebrow">Creator OS</span>
                  <SignOutButton />
                </div>
              </header>
              <div className="mobile-nav">
                <NavLinks role={role} />
              </div>
              {role === 'owner' && <KillSwitchBanner />}
              <main id="main-content" tabIndex={-1} className="main">{children}</main>
              <footer className="footer">
                <span>Private by design · self-hosted</span>
                <Link href="/api/v1/health">
                  System health
                </Link>
              </footer>
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
