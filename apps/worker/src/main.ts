import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { parseEnvironment } from '@dongtian/config-schema';
import { createLogger, initializeObservability } from '@dongtian/observability';

import { WorkerModule } from './worker.module.js';

const observability = initializeObservability('@dongtian/worker');
const logger = createLogger(observability.serviceName);

export async function startWorker(): Promise<void> {
  const environment = parseEnvironment(process.env);
  const app = await NestFactory.createApplicationContext(
    WorkerModule.register({
      environment,
      logger,
    }),
    {
      bufferLogs: true,
    },
  );
  app.enableShutdownHooks();

  logger.info(
    {
      config_version: environment.ACTIVE_CONFIG_VERSION,
      tracing_enabled: observability.tracingEnabled,
    },
    'Worker application shell started.',
  );
}

void startWorker().catch((error: unknown) => {
  logger.error({ error: error instanceof Error ? error.name : 'unknown' }, 'Worker bootstrap failed.');
  process.exitCode = 1;
});
