import GrokConnection from '@/components/GrokConnection';
import GrokR2Storage from '@/components/GrokR2Storage';

export default function GrokConnectionPage() {
  return <section className="stack">
    <h1>Connect your Grok account</h1>
    <p>This only connects your account. It does not generate or publish media.</p>
    <GrokConnection />
    <GrokR2Storage />
  </section>;
}
