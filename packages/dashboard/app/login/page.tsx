import type { Metadata } from 'next';
import LoginForm from '@/components/LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="login-page">
      <section className="login-story" aria-label="AXIOM introduction">
        <div className="brand login-brand">
          <span className="brand-mark">A</span>
          <span className="brand-copy">
            <strong>AXIOM</strong>
            <small>Creator intelligence</small>
          </span>
        </div>
        <div className="login-story-copy">
          <p className="eyebrow">Your private creator OS</p>
          <h1>
            Run your world.
            <br />
            <em>Beautifully.</em>
          </h1>
          <p>
            One elegant command center for content, community, growth, and the business behind your
            brand.
          </p>
        </div>
        <div className="trust-row">
          <span>Private by design</span>
          <span>Self-hosted</span>
          <span>Always in control</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">Welcome back</p>
          <h2>Enter your studio</h2>
          <p className="subtle">Sign in to continue to your private workspace.</p>
          <LoginForm />
          <p className="login-footnote">Protected by encrypted, tenant-isolated access.</p>
        </div>
      </section>
    </div>
  );
}
