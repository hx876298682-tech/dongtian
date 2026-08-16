import 'reflect-metadata';

import { parseEnvironment } from '@dongtian/config-schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from './app.factory.js';

export async function bootstrap(): Promise<NestFastifyApplication> {
  const environment = parseEnvironment(process.env);
  const app = await createApp();
  await app.listen({ host: environment.API_HOST, port: environment.API_PORT });

  return app;
}

void bootstrap().catch((error: unknown) => {
  console.error('API bootstrap failed.', error);
  process.exitCode = 1;
});
