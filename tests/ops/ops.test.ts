import { describe, expect, it } from 'vitest';

import {
  assertSafeDirectoryTarget,
  buildBackupPlan,
  buildConfigRollbackPlan,
  buildOutboxDedupePlan,
  buildRestoreDrillPlan,
  buildWalCheckPlan,
  parseArgs,
  renderPlan,
} from '../../tooling/ops/src/lib.js';

describe('ops backup and restore planning', () => {
  it('parses command line flags without relying on unsafe defaults', () => {
    const parsed = parseArgs([
      'backup',
      '--database-url',
      'postgres://user:pass@localhost:5432/dongtian',
      '--backup-dir=/Users/hx/backups/dongtian',
      '--execute',
    ]);

    expect(parsed.command).toBe('backup');
    expect(parsed.flags.get('database-url')).toBe('postgres://user:pass@localhost:5432/dongtian');
    expect(parsed.flags.get('backup-dir')).toBe('/Users/hx/backups/dongtian');
    expect(parsed.flags.get('execute')).toBe(true);
  });

  it('ignores shell-style argument separators', () => {
    const parsed = parseArgs([
      'outbox-dedupe',
      '--',
      '--database-url',
      'postgres://user:pass@localhost:5432/dongtian',
    ]);

    expect(parsed.command).toBe('outbox-dedupe');
    expect(parsed.flags.get('database-url')).toBe('postgres://user:pass@localhost:5432/dongtian');
    expect(parsed.positionals).toHaveLength(0);
  });

  it('rejects broad backup directories', () => {
    expect(() => assertSafeDirectoryTarget('/', 'backup-dir')).toThrow('OPS_PATH_TOO_BROAD:backup-dir');
    expect(() => assertSafeDirectoryTarget('relative/path', 'backup-dir')).toThrow('OPS_PATH_NOT_ABSOLUTE:backup-dir');
  });

  it('builds a safe backup plan with a timestamped backup file', () => {
    const plan = buildBackupPlan({
      databaseUrl: 'postgres://user:pass@localhost:5432/dongtian',
      backupDir: '/Users/hx/backups/dongtian',
      now: new Date('2026-08-16T10:00:00.000Z'),
      execute: false,
    });

    expect(renderPlan(plan)).toContain('PostgreSQL 全量备份演练');
    expect(plan.steps[0]?.command).toContain('mkdir');
    expect(plan.steps[1]?.command).toContain('pg_dump');
    expect(plan.steps[1]?.command).toContain('/Users/hx/backups/dongtian/postgres/dongtian/2026-08-16T100000000Z.dump');
    expect(plan.steps[1]?.command).not.toContain('rm -rf');
  });

  it('builds a restore drill that chains restore, migration, config validation, audit, and dedupe', () => {
    const plan = buildRestoreDrillPlan({
      backupFile: '/Users/hx/backups/dongtian/postgres/dongtian/2026-08-16T100000000Z.dump',
      restoreDatabaseUrl: 'postgres://user:pass@localhost:5432/dongtian_restore',
      sourceDatabaseUrl: 'postgres://user:pass@localhost:5432/dongtian',
      expectedConfigVersion: '2026.08.16.1',
      execute: false,
    });

    const rendered = renderPlan(plan);
    expect(rendered).toContain('隔离恢复演练');
    expect(rendered).toContain('pg_restore');
    expect(rendered).toContain('pnpm db:migrate');
    expect(rendered).toContain('ACTIVE_CONFIG_VERSION');
    expect(rendered).toContain('pnpm db:audit');
    expect(rendered).toContain('ops:outbox-dedupe');
  });

  it('builds read-only WAL and outbox checks', () => {
    const wal = buildWalCheckPlan({ databaseUrl: 'postgres://user:pass@localhost:5432/dongtian' });
    const dedupe = buildOutboxDedupePlan({ databaseUrl: 'postgres://user:pass@localhost:5432/dongtian' });
    const rollback = buildConfigRollbackPlan({
      currentConfigVersion: '2026.08.16.1',
      targetConfigVersion: '2026.08.09.1',
    });

    expect(wal.steps[0]?.command).toContain('pg_settings');
    expect(dedupe.steps[0]?.command).toContain('outbox_events');
    expect(rollback.steps[0]?.command).toContain('current=2026.08.16.1');
  });
});
