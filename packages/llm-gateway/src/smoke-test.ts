// Quick smoke test for the zero-API-cost provider surface.
import { LLMGateway } from './gateway.js';

async function main() {
  const gateway = new LLMGateway();
  const capabilities = gateway.getProviderCapabilities();
  const chargeable = capabilities.filter(
    (provider) => provider.available && provider.operatorApiCost,
  );
  if (chargeable.length > 0) throw new Error('Operator-funded provider exposed');
  console.log(`subscription gateway: ok (${gateway.getAvailableProviders().join(', ')})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Smoke test failed');
  process.exitCode = 1;
});
