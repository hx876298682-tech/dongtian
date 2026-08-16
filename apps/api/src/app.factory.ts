import 'reflect-metadata';

import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './http/error.filter.js';
import { SuccessEnvelopeInterceptor } from './http/envelope.interceptor.js';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(cookie as unknown as Parameters<typeof fastify.register>[0]);
  await fastify.register(helmet as unknown as Parameters<typeof fastify.register>[0]);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalInterceptors(app.get(SuccessEnvelopeInterceptor));
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  return app;
}
