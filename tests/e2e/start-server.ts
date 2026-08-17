import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { loadE2EEnvironment } from './e2e-env.js';
import {
  applyPg16Uuidv7Shim,
  buildE2EDatabaseResetMessage,
  assertE2EDatabaseCompatibility,
  inspectE2EDatabaseVersion,
  resetE2EDatabase,
  validateE2ETestDatabaseUrl,
} from './e2e-database.js';

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

  return child;
}

async function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, timeoutMs);
    timeout.unref();
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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

  if (environment.databaseMode === 'docker') {
    assertDockerComposeAvailable();
    runStep('pnpm', ['infra:up'], baseEnv);
  }

  const target = validateE2ETestDatabaseUrl(
    environment.testDatabaseUrl,
    environment.databaseMode,
    environment.databaseWipeAllowlist,
  );
  const versionNum = await inspectE2EDatabaseVersion(environment.testDatabaseUrl);
  const compatibility = assertE2EDatabaseCompatibility(
    versionNum,
    environment.allowPg16Uuidv7Shim,
    target.hostname,
  );

  const database = await resetE2EDatabase(
    environment.testDatabaseUrl,
    environment.databaseMode,
    environment.databaseWipeAllowlist,
  );
  console.log(buildE2EDatabaseResetMessage(database));

  if (compatibility === 'postgres16-shim') {
    await applyPg16Uuidv7Shim(environment.testDatabaseUrl);
  }

  console.log(`E2E database version ${versionNum} is ready.`);

  runStep('pnpm', ['db:migrate'], baseEnv);
  runStep('pnpm', ['db:seed'], baseEnv);

  const children = new Set<ChildProcess>();
  const trackChild = (child: ChildProcess): ChildProcess => {
    children.add(child);
    child.once('exit', () => {
      children.delete(child);
    });
    return child;
  };

  const stopChildren = async (signal: NodeJS.Signals | 'SIGKILL' = 'SIGTERM'): Promise<void> => {
    for (const child of children) {
      child.kill(signal);
    }

    await Promise.all(Array.from(children, async (child) => {
      await waitForProcessExit(child, 5_000);
    }));
  };

  let shuttingDown = false;
  const shutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await stopChildren();
    process.exit(exitCode);
  };

  const api = trackChild(spawnService('pnpm', ['--filter', '@dongtian/api', 'dev'], baseEnv, 'API'));
  api.once('exit', (code, signal) => {
    if (!shuttingDown && (code !== 0 || signal !== null)) {
      console.error(`API exited unexpectedly with code ${code ?? 'unknown'}${signal ? ` and signal ${signal}` : ''}.`);
      void shutdown(1);
    }
  });
  await waitForUrl(`${environment.apiOrigin}/api/v1/health/live`, 'API health');

  const web = trackChild(
    spawnService(
      'pnpm',
      ['--filter', '@dongtian/web', 'dev', '--', '--host', environment.apiHost, '--port', String(environment.webPort), '--strictPort'],
      baseEnv,
      'Web',
    ),
  );
  web.once('exit', (code, signal) => {
    if (!shuttingDown && (code !== 0 || signal !== null)) {
      console.error(`Web exited unexpectedly with code ${code ?? 'unknown'}${signal ? ` and signal ${signal}` : ''}.`);
      void shutdown(1);
    }
  });
  await waitForUrl(environment.webOrigin, 'web app');

  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });
  process.on('exit', () => {
    for (const child of children) {
      child.kill('SIGTERM');
    }
  });

  await new Promise<void>(() => {
    // Keep the process alive until Playwright tears the webServer down.
  });
}

void main().catch((error: unknown) => {
  console.error('E2E server bootstrap failed.', error);
  process.exit(1);
});
