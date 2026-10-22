import type { Metadata } from 'next';
import Link from 'next/link';

const CONTACT_EMAIL = 'dswmarketingllc+fanthynks@gmail.com';
const UPDATED = 'October 21, 2026';

export const metadata: Metadata = {
  title: { absolute: 'Privacy Policy · FanThynks' },
  description: 'How FanThynks handles account data and connected social accounts, including Reddit.',
};

export default function PrivacyPage() {
  return (
    <article className="card stack" style={{ maxWidth: 760, margin: '0 auto' }}>
      <header className="stack">
        <p className="eyebrow">Legal</p>
        <h1>FanThynks Privacy Policy</h1>
        <p className="subtle">Last updated {UPDATED}</p>
      </header>

      <section className="stack">
        <h2>What FanThynks is</h2>
        <p>
          FanThynks is a content planning and publishing tool for professional creators and the teams that
          manage them. It is currently invite-only. Each customer connects their own social accounts and
          publishes only their own content.
        </p>
      </section>

      <section className="stack">
        <h2>Information we store</h2>
        <ul>
          <li>Account details for people who sign in: email address, name, role, and session data.</li>
          <li>Content you create or upload in FanThynks: creator profiles, captions, media, and schedules.</li>
          <li>
            For each social account you connect: the platform account ID and username, the permissions you
            granted, and the access credentials the platform issues to us.
          </li>
          <li>A record of key actions, such as connecting or disconnecting an account.</li>
        </ul>
        <p>
          Access credentials are encrypted before they are saved. They are not shown in the interface or in
          logs.
        </p>
      </section>

      <section className="stack">
        <h2>Reddit</h2>
        <p>
          If you choose to connect Reddit, you sign in on Reddit&apos;s own authorization page and approve the
          permissions listed there. FanThynks requests only these permissions:
        </p>
        <ul>
          <li><strong>identity</strong>: to confirm which Reddit account you connected and show its username.</li>
          <li><strong>submit</strong>: to publish posts that you create and schedule, to subreddits you choose.</li>
        </ul>
        <p>
          FanThynks does not request permission to read your messages, read or reply to comments, moderate
          posts or communities, vote, or manage subreddits. We do not collect Reddit content from other users.
          Posts that include adult material are marked NSFW when published and are sent only to communities you
          select. You are responsible for following each community&apos;s rules and Reddit&apos;s policies.
        </p>
        <p>
          We use Reddit data only to operate the connection you set up. We do not sell it, share it for
          advertising, or use it to train machine learning models.
        </p>
      </section>

      <section className="stack">
        <h2>How we use information</h2>
        <p>
          To run the service you use: sign you in, store and schedule your content, publish to the accounts
          you connected, and keep the service secure. We do not sell personal information.
        </p>
      </section>

      <section className="stack">
        <h2>Service providers and sharing</h2>
        <p>
          When you publish, your content is sent to the platform you chose. If you use AI-assisted features,
          the text or prompts you submit are sent to the AI provider you have configured in FanThynks. We
          otherwise share information only when the law requires it or to protect the service from abuse.
        </p>
      </section>

      <section className="stack">
        <h2>Disconnecting and deleting</h2>
        <p>
          You can disconnect a social account at any time from the connections screen. When you do,
          FanThynks asks the platform to revoke its access token and then deletes the stored credentials. If
          the platform cannot be reached, the credentials are kept so the revoke can be retried, and the
          account stays connected until it succeeds. A short audit entry (platform name, action, time) is
          kept. You can also remove FanThynks from your Reddit account at
          {' '}<a href="https://www.reddit.com/prefs/apps">reddit.com/prefs/apps</a>.
        </p>
        <p>
          To ask us to delete your account data, email {CONTACT_EMAIL}. We will respond to verified requests.
        </p>
      </section>

      <section className="stack">
        <h2>Children</h2>
        <p>FanThynks is for adults only. We do not knowingly collect information from anyone under 18.</p>
      </section>

      <section className="stack">
        <h2>Changes and contact</h2>
        <p>
          We will update this page and its date when this policy changes. Questions: {CONTACT_EMAIL}. See
          also our <Link href="/terms">Terms of Service</Link>.
        </p>
      </section>
    </article>
  );
}
