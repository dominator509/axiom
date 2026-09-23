import GrokConnection from '@/components/GrokConnection';
import GrokR2Storage from '@/components/GrokR2Storage';
import SubscriptionConnections from '@/components/SubscriptionConnections';
import Link from 'next/link';
import { api, getSession, type LlmProviderCapability } from '@/lib/api';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  grok: 'Grok',
  vllm: 'vLLM',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  mistral: 'Mistral',
  venice: 'Venice',
};

type ServerTranslate = Awaited<ReturnType<typeof getServerLocale>>['t'];

function transportLabel(capability: LlmProviderCapability, t: ServerTranslate): string {
  if (capability.transport === 'local') return t('connection.transportLocal');
  if (capability.transport === 'user-subscription') return t('connection.transportSubscription');
  return t('connection.transportUnsupported');
}

export default async function GrokConnectionPage() {
  const role = (await getSession())?.user?.role;
  const { t } = await getServerLocale();
  if (!workspaceDestinationAllowed(role, '/connections/grok')) return <section className="card stack">
    <h1>{t('connection.accessTitle')}</h1><p>{t('connection.accessDescription')}</p>
    <Link href="/" className="btn secondary">{t('connection.backToWorkspace')}</Link>
  </section>;
  let capabilities: LlmProviderCapability[] | null = null;
  try {
    capabilities = (await api.llm.providers()).capabilities;
  } catch {
    // Leave provider transport state explicitly unavailable if the gateway cannot be read.
  }
  return <section className="stack">
    <h1>{t('connection.grokTitle')}</h1>
    <p>{t('connection.grokDescription')}</p>
    <GrokConnection />
    <SubscriptionConnections />
    <section className="card stack" aria-labelledby="provider-capabilities-title">
      <h2 id="provider-capabilities-title">{t('connection.capabilitiesTitle')}</h2>
      <p className="subtle">{t('connection.capabilitiesDescription')}</p>
      {!capabilities ? <p role="status">{t('connection.capabilitiesUnavailable')}</p> : (
        <ul>
          {capabilities.map(capability => (
            <li key={capability.provider}>
              <strong>{PROVIDER_LABELS[capability.provider] ?? capability.provider}</strong>
              {' — '}{capability.available ? t('connection.policyAvailable') : t('connection.policyUnavailable')}
              {' · '}{transportLabel(capability, t)}
              {!capability.available && <p>{t('connection.capabilitiesReason')}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
    <p>{t('connection.storagePrivacyNote')}</p>
    <GrokR2Storage />
  </section>;
}
