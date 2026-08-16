import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { loadE2EEnvironment } from './e2e-env.js';

function runStep(command: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status ?? result.signal ?? 'unknown')}.`);
  }
}

function assertDockerComposeAvailable(): void {
  const result = spawnSync('docker', ['compose', 'version'], {
    stdio: 'ignore',
  });

  if (result.status !== 0 || result.error !== undefined) {
    throw new Error('E2E bootstrap requires Docker Compose and PostgreSQL 18. Install Docker or point the test harness at a reachable test database before running pnpm test:e2e.');
  }
}

async function waitForUrl(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the service is ready.
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label} at ${url}.`);
    }

    await delay(1000);
  }
}

function spawnService(command: string, args: readonly string[], env: NodeJS.ProcessEnv, name: string) {
  const child = spawn(command, args, {
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal !== null) {
      console.error(`${name} exited unexpectedly with signal ${signal}.`);
      process.exit(1);
    }

    if (code !== null && code !== 0) {
      console.error(`${name} exited unexpectedly with code ${code}.`);
      process.exit(code);
    }
  });

  return child;
}

async function main(): Promise<void> {
  const environment = loadE2EEnvironment();
  const baseEnv = {
    ...process.env,
    APP_ENV: 'test',
    API_HOST: environment.apiHost,
    API_PORT: String(environment.apiPort),
    CSRF_SECRET: environment.csrfSecret,
    DATABASE_URL: environment.testDatabaseUrl,
    LOG_LEVEL: 'warn',
    NODE_ENV: 'test',
    RANDOM_SEED_ENCRYPTION_KEY: environment.randomSeedEncryptionKey,
    SESSION_SECRET: environment.sessionSecret,
    VITE_API_PROXY_TARGET: environment.apiOrigin,
    WEB_ORIGIN: environment.webOrigin,
  };

  assertDockerComposeAvailable();
  runStep('pnpm', ['infra:up'], baseEnv);
  runStep('pnpm', ['db:migrate'], baseEnv);
  runStep('pnpm', ['db:seed'], baseEnv);

  const api = spawnService('pnpm', ['--filter', '@dongtian/api', 'dev'], baseEnv, 'API');
  await waitForUrl(`${environment.apiOrigin}/api/v1/health/live`, 'API health');

  const web = spawnService(
    'pnpm',
    ['--filter', '@dongtian/web', 'dev', '--', '--host', environment.apiHost, '--port', String(environment.webPort), '--strictPort'],
    baseEnv,
    'Web',
  );
  await waitForUrl(environment.webOrigin, 'web app');

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    api.kill('SIGTERM');
    web.kill('SIGTERM');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise<void>(() => {
    // Keep the process alive until Playwright tears the webServer down.
  });
}

void main().catch((error: unknown) => {
  console.error('E2E server bootstrap failed.', error);
  process.exit(1);
});
