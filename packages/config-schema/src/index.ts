import { z } from 'zod';

export const packageName = '@dongtian/config-schema' as const;

const localEnvironmentDefaults = {
  NODE_ENV: 'development',
  APP_ENV: 'local',
  API_HOST: '127.0.0.1',
  API_PORT: '3000',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://dongtian:dongtian@localhost:5432/dongtian',
  SESSION_SECRET: 'local-development-session-secret',
  CSRF_SECRET: 'local-development-csrf-secret',
  RANDOM_SEED_ENCRYPTION_KEY: 'local-development-random-seed-key',
  ACTIVE_CONFIG_VERSION: '2026.08.16.1',
  CONFIG_STORAGE_MODE: 'filesystem',
  CONFIG_STORAGE_PATH: './config/releases',
  LOG_LEVEL: 'info',
} as const satisfies Record<string, string>;

export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_ENV: z.enum(['local', 'test', 'staging', 'production']),
  API_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  CSRF_SECRET: z.string().min(16),
  RANDOM_SEED_ENCRYPTION_KEY: z.string().min(16),
  ACTIVE_CONFIG_VERSION: z.string().min(1),
  CONFIG_STORAGE_MODE: z.enum(['filesystem', 's3']),
  CONFIG_STORAGE_PATH: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  REDIS_URL: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

const productionRequiredKeys = [
  'SESSION_SECRET',
  'CSRF_SECRET',
  'RANDOM_SEED_ENCRYPTION_KEY',
  'DATABASE_URL',
] as const satisfies ReadonlyArray<keyof Environment>;

export function parseEnvironment(input: Record<string, string | undefined>): Environment {
  const nodeEnvironment = input['NODE_ENV'] ?? localEnvironmentDefaults.NODE_ENV;
  const candidate = nodeEnvironment === 'production' ? input : { ...localEnvironmentDefaults, ...input };
  const parsed = EnvironmentSchema.parse(candidate);

  if (parsed.NODE_ENV === 'production') {
    const missingKeys = productionRequiredKeys.filter((key) => !input[key]);

    if (missingKeys.length > 0) {
      throw new z.ZodError(
        missingKeys.map((key) => ({
          code: 'custom',
          path: [key],
          message: 'This environment variable is required in production.',
        })),
      );
    }
  }

  return parsed;
}

export * from './config.js';
