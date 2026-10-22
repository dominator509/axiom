import type { Metadata } from 'next';
import Link from 'next/link';

const CONTACT_EMAIL = 'dswmarketingllc+fanthynks@gmail.com';
const UPDATED = 'October 21, 2026';

export const metadata: Metadata = {
  title: { absolute: 'Terms of Service · FanThynks' },
  description: 'Terms for using FanThynks.',
};

export default function TermsPage() {
  return (
    <article className="card stack" style={{ maxWidth: 760, margin: '0 auto' }}>
      <header className="stack">
        <p className="eyebrow">Legal</p>
        <h1>FanThynks Terms of Service</h1>
        <p className="subtle">Last updated {UPDATED}</p>
      </header>

      <section className="stack">
        <h2>The service</h2>
        <p>
          FanThynks is a content planning and publishing tool for professional creators and their teams.
          Access is by invitation. By signing in you agree to these terms.
        </p>
      </section>

      <section className="stack">
        <h2>Your account</h2>
        <p>
          Keep your sign-in details private and tell us if you think your account was accessed without
          permission. You are responsible for activity under your account and for the people you invite.
        </p>
      </section>

      <section className="stack">
        <h2>Adults only</h2>
        <p>You must be at least 18. Content must depict only consenting adults and must not involve minors.</p>
      </section>

      <section className="stack">
        <h2>Your content and connected accounts</h2>
        <p>
          You keep ownership of your content. You confirm you have the rights to publish it and that you are
          authorized to connect each social account you add. FanThynks publishes only what you or your team
          create or schedule, and only to accounts you connected.
        </p>
      </section>

      <section className="stack">
        <h2>Third-party platforms</h2>
        <p>
          Connected platforms, including Reddit, have their own terms, API terms, and community rules. You
          agree to follow them. Do not use FanThynks to spam, evade a ban, manipulate votes, impersonate
          others, or post content that a platform or community prohibits. Mark age-restricted content as such
          where the platform requires it. A platform may limit or revoke access at any time, and FanThynks
          is not responsible for that.
        </p>
      </section>

      <section className="stack">
        <h2>Acceptable use</h2>
        <p>
          No unlawful use, no harassment, no attempts to break or probe the service, and no sharing of
          credentials. We may suspend access that violates these terms.
        </p>
      </section>

      <section className="stack">
        <h2>Availability and liability</h2>
        <p>
          The service is provided as is, without warranties. To the extent the law allows, FanThynks is not
          liable for indirect or consequential losses, or for loss caused by a third-party platform.
        </p>
      </section>

      <section className="stack">
        <h2>Ending use</h2>
        <p>
          You can stop using FanThynks and disconnect your accounts at any time. We may end access for
          violations of these terms.
        </p>
      </section>

      <section className="stack">
        <h2>Contact</h2>
        <p>
          {CONTACT_EMAIL}. See our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </article>
  );
}
