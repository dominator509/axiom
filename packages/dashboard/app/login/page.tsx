import type { Metadata } from 'next';
import LoginForm from '@/components/LoginForm';

export const metadata: Metadata = { title: 'Sign in — AXIOM' };

export default function LoginPage() {
  return (
    <div style={{ maxWidth: 380, margin: '80px auto' }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>AXIOM</h1>
        <p style={{ color: 'var(--muted)' }}>Sign in to the operator dashboard.</p>
        <LoginForm />
      </div>
    </div>
  );
}
