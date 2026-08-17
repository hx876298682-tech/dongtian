import { createDatabasePool } from '@dongtian/database';

import type { E2EDatabaseMode, E2EEnvironment } from './e2e-env.js';

export type E2EDatabaseTarget = {
  readonly databaseName: string;
  readonly hostname: string;
  readonly rawUrl: string;
  readonly username: string;
  readonly versionNum: number;
};

const TEST_LIKE_PATTERNS = [/test/i, /e2e/i];
const BLOCKED_PATTERNS = [/prod/i, /production/i, /main/i, /default/i, /primary/i];

function isTestLike(value: string): boolean {
  return TEST_LIKE_PATTERNS.some((pattern) => pattern.test(value));
}

function isBlocked(value: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(value));
}

function parseDatabaseName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`E2E_DATABASE_MODE=external requires a PostgreSQL URL, received ${url.protocol}.`);
  }

  if (!databaseName) {
    throw new Error('TEST_DATABASE_URL must include an explicit database name.');
  }

  if (isBlocked(databaseName) || isBlocked(url.username)) {
    throw new Error(
      `TEST_DATABASE_URL points at a blocked database target (${databaseName}). Use an explicit test database.`,
    );
  }

  if (!isTestLike(databaseName) && !isTestLike(url.username)) {
    throw new Error(
      'TEST_DATABASE_URL must point at an explicit test database name or user (for example *_test or e2e_*).',
    );
  }

  return databaseName;
}

function describeDatabaseTarget(target: Pick<E2EDatabaseTarget, 'databaseName' | 'hostname' | 'username'>): string {
  return `${target.username}@${target.hostname}/${target.databaseName}`;
}

export function validateE2ETestDatabaseUrl(
  databaseUrl: string,
  mode: E2EDatabaseMode,
  allowlist: readonly string[],
): E2EDatabaseTarget {
  const url = new URL(databaseUrl);
  const databaseName = parseDatabaseName(databaseUrl);
  const username = decodeURIComponent(url.username);
  const versionNum = Number.NaN;
  const target = { databaseName, hostname: url.hostname, rawUrl: databaseUrl, username, versionNum };

  if (mode === 'external' && allowlist.length === 0) {
    throw new Error(
      `E2E_DATABASE_WIPE_ALLOWLIST must explicitly list the external test database target ${describeDatabaseTarget(target)}.`,
    );
  }

  if (
    allowlist.length > 0 &&
    !allowlist.some((entry) => entry === target.rawUrl || entry === target.databaseName || entry === target.username)
  ) {
    throw new Error(
      `E2E_DATABASE_WIPE_ALLOWLIST does not include ${describeDatabaseTarget(target)}.`,
    );
  }

  return {
    databaseName,
    hostname: url.hostname,
    rawUrl: databaseUrl,
    username,
    versionNum,
  };
}

export async function inspectE2EDatabaseVersion(databaseUrl: string): Promise<number> {
  const pool = createDatabasePool(databaseUrl);
  try {
    const result = await pool.query<{ readonly server_version_num: string }>('SHOW server_version_num');
    const versionText = result.rows[0]?.server_version_num;
    if (!versionText) {
      throw new Error('Failed to inspect PostgreSQL version for the E2E database.');
    }

    const versionNum = Number(versionText);
    if (!Number.isSafeInteger(versionNum) || versionNum <= 0) {
      throw new Error(`Invalid PostgreSQL version number: ${versionText}`);
    }

    return versionNum;
  } finally {
    await pool.end();
  }
}

export async function resetE2EDatabase(
  databaseUrl: string,
  mode: E2EDatabaseMode,
  allowlist: readonly string[],
): Promise<E2EDatabaseTarget> {
  const target = validateE2ETestDatabaseUrl(databaseUrl, mode, allowlist);
  const pool = createDatabasePool(databaseUrl);
  const client = await pool.connect();

  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
    await client.query('GRANT ALL ON SCHEMA public TO PUBLIC');
    return target;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function applyPg16Uuidv7Shim(databaseUrl: string): Promise<void> {
  const pool = createDatabasePool(databaseUrl);
  const client = await pool.connect();

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query(`
      CREATE OR REPLACE FUNCTION public.uuidv7()
      RETURNS uuid
      LANGUAGE sql
      VOLATILE
      AS $$
        SELECT gen_random_uuid()
      $$;
    `);
  } finally {
    client.release();
    await pool.end();
  }
}

export function assertE2EDatabaseCompatibility(
  versionNum: number,
  allowPg16Uuidv7Shim: boolean,
  hostname: string,
): 'postgres18' | 'postgres16-shim' {
  if (versionNum >= 180000) {
    return 'postgres18';
  }

  if (versionNum >= 160000 && versionNum < 170000) {
    if (!allowPg16Uuidv7Shim) {
      throw new Error(
        `PostgreSQL 18 is required for E2E runs. Detected PostgreSQL ${Math.trunc(versionNum / 10000)}; set E2E_ALLOW_PG16_UUIDV7_SHIM=true only for isolated local developer databases if you need the compatibility shim.`,
      );
    }

    if (!['127.0.0.1', '::1', 'localhost'].includes(hostname.toLowerCase())) {
      throw new Error('The PostgreSQL 16 uuidv7 shim may only be installed on local isolated databases.');
    }

    return 'postgres16-shim';
  }

  throw new Error(
    `PostgreSQL 18 is required for E2E runs. Detected unsupported server_version_num=${versionNum}.`,
  );
}

export async function ensureE2EDatabaseIsReady(environment: E2EEnvironment): Promise<E2EDatabaseTarget> {
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

  if (compatibility === 'postgres16-shim') {
    await applyPg16Uuidv7Shim(environment.testDatabaseUrl);
  }

  return { ...target, versionNum };
}

export function buildE2EDatabaseResetMessage(target: E2EDatabaseTarget): string {
  return `Resetting isolated test database ${target.username}@${target.hostname}/${target.databaseName}.`;
}
