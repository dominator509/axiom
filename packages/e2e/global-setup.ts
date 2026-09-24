import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const MIGRATOR_URL =
  process.env.E2E_MIGRATOR_DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL ?? '';

function sh(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  console.log(`[e2e:setup] ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

async function globalSetup(config: FullConfig): Promise<void> {
  const onlyProdSmoke =
    process.env.E2E_PROD_ONLY === '1' ||
    (config.projects.length > 0 && config.projects.every((p) => p.name === 'prod-smoke'));
  if (onlyProdSmoke) {
    console.log('[e2e:setup] prod-smoke only — skipping local database setup');
    return;
  }

  if (!MIGRATOR_URL) {
    throw new Error(
      'global-setup: E2E_MIGRATOR_DATABASE_URL (or MIGRATOR_DATABASE_URL) is required',
    );
  }

  // The Playwright webServer entries run the API from its compiled dist output
  // and the dashboard with `next dev`. Make sure the API dist exists first.
  if (!existsSync(join(repoRoot, 'packages', 'api', 'dist', 'server.js'))) {
    console.log('[e2e:setup] packages/api/dist missing — building API and its workspace deps');
    sh('pnpm', ['build', '--filter', '@axiom/api...']);
  }

  console.log('[e2e:setup] applying migrations');
  sh('bash', ['scripts/migrate.sh'], { MIGRATOR_DATABASE_URL: MIGRATOR_URL });

  console.log('[e2e:setup] seeding ephemeral E2E fixtures');
  sh('bash', ['packages/e2e/scripts/seed.sh'], { E2E_MIGRATOR_DATABASE_URL: MIGRATOR_URL });

  console.log('[e2e:setup] done');
}

export default globalSetup;
