// Quick smoke test: verify LLM Gateway can call all configured providers
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { LLMGateway } from './gateway.js';

async function main() {
  const gateway = new LLMGateway();

  const providers = [
    { name: 'OpenAI', provider: 'openai', model: 'gpt-4o-mini' },
    { name: 'Anthropic', provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { name: 'Grok', provider: 'grok', model: 'grok-2-latest' },
    { name: 'Venice', provider: 'venice', model: 'llama-3.1-70b' },
  ];

  for (const p of providers) {
    console.log(`Testing ${p.name}...`);
    try {
      const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant. Reply in one short sentence.' },
        { role: 'user' as const, content: 'Say hello and tell me your model name.' }
      ];
      const result = await gateway.chat(messages, { provider: p.provider as any, model: p.model });
      console.log(`  ✅ ${p.name}: "${result.content.slice(0, 100)}..."`);
      console.log(`     Model: ${result.model}, Cost: $${result.cost.toFixed(6)}, Latency: ${result.latency}ms`);
    } catch (e) {
      console.log(`  ❌ ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Check env vars loaded
  console.log('\nEnv check:');
  const vars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROK_API_KEY', 'VENICE_API_KEY', 'TELEGRAM_BOT_TOKEN'];
  for (const v of vars) {
    const val = process.env[v];
    console.log(`  ${v}: ${val ? `${val.slice(0, 8)}...${val.slice(-4)}` : 'NOT SET'}`);
  }

  console.log('\n=== LLM Gateway Smoke Test Complete ===');
}

main().catch(console.error);
