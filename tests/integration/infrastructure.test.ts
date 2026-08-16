import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type ComposeService = {
  image?: string;
  environment?: Record<string, string>;
  ports?: string[];
  healthcheck?: {
    test?: string[];
    retries?: number;
  };
};

type ComposeFile = {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, Record<string, never>>;
};

const composePath = resolve(process.cwd(), 'docker-compose.yml');
const compose = parse(readFileSync(composePath, 'utf8')) as ComposeFile;

describe('local PostgreSQL infrastructure', () => {
  it('defines isolated development and test databases with health checks', () => {
    const services = compose.services ?? {};
    const development = services.postgres;
    const test = services['postgres-test'];

    expect(development?.image).toBe('postgres:18-alpine');
    expect(test?.image).toBe('postgres:18-alpine');
    expect(development?.ports).toContain('${POSTGRES_PORT:-5432}:5432');
    expect(test?.ports).toContain('${POSTGRES_TEST_PORT:-5433}:5432');
    expect(development?.healthcheck?.test?.[0]).toBe('CMD-SHELL');
    expect(test?.healthcheck?.test?.[0]).toBe('CMD-SHELL');
    expect(development?.healthcheck?.retries).toBe(10);
    expect(test?.healthcheck?.retries).toBe(10);
    expect(Object.keys(compose.volumes ?? {})).toEqual([
      'dongtian-postgres-data',
      'dongtian-postgres-test-data',
    ]);
  });
});
