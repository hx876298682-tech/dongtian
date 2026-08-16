import { spawnSync } from 'node:child_process';

import {
  buildBackupPlan,
  buildConfigRollbackPlan,
  buildOutboxDedupePlan,
  buildRestoreDrillPlan,
  buildWalCheckPlan,
  parseArgs,
  readBooleanOption,
  readStringOption,
  renderPlan,
} from './lib.js';

function getOption(flags: ReadonlyMap<string, string | boolean>, name: string, envName: string): string {
  const value = readStringOption(flags, name, process.env[envName]);
  if (value === undefined) {
    throw new Error(`OPS_REQUIRED_OPTION:${name}`);
  }
  return value;
}

function executePlan(commands: readonly string[]): void {
  for (const command of commands) {
    const result = spawnSync('/bin/sh', ['-lc', command], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) {
      const code = result.status ?? 1;
      process.exitCode = code;
      throw new Error(`OPS_COMMAND_FAILED:${code}`);
    }
  }
}

function run(): void {
  const parsed = parseArgs(process.argv.slice(2));
  const execute = readBooleanOption(parsed.flags, 'execute');

  switch (parsed.command) {
    case 'backup': {
      const label = readStringOption(parsed.flags, 'label', process.env['BACKUP_LABEL']);
      const backupInput = {
        databaseUrl: getOption(parsed.flags, 'database-url', 'DATABASE_URL'),
        backupDir: getOption(parsed.flags, 'backup-dir', 'BACKUP_DIR'),
        execute,
        ...(label !== undefined ? { label } : {}),
      };
      const plan = buildBackupPlan(backupInput);
      process.stdout.write(renderPlan(plan));
      if (execute) {
        executePlan(plan.steps.map((step) => step.command));
      }
      return;
    }
    case 'restore-drill': {
      const sourceDatabaseUrl = readStringOption(parsed.flags, 'source-database-url', process.env['DATABASE_URL']);
      const expectedConfigVersion = readStringOption(parsed.flags, 'expected-config-version', process.env['ACTIVE_CONFIG_VERSION']);
      const restoreInput = {
        backupFile: getOption(parsed.flags, 'backup-file', 'BACKUP_FILE'),
        restoreDatabaseUrl: getOption(parsed.flags, 'restore-database-url', 'RESTORE_DATABASE_URL'),
        execute,
        ...(sourceDatabaseUrl !== undefined ? { sourceDatabaseUrl } : {}),
        ...(expectedConfigVersion !== undefined ? { expectedConfigVersion } : {}),
      };
      const plan = buildRestoreDrillPlan(restoreInput);
      process.stdout.write(renderPlan(plan));
      if (execute) {
        executePlan(plan.steps.map((step) => step.command));
      }
      return;
    }
    case 'check-wal': {
      const plan = buildWalCheckPlan({
        databaseUrl: getOption(parsed.flags, 'database-url', 'DATABASE_URL'),
      });
      process.stdout.write(renderPlan(plan));
      if (execute) {
        executePlan(plan.steps.map((step) => step.command));
      }
      return;
    }
    case 'outbox-dedupe': {
      const plan = buildOutboxDedupePlan({
        databaseUrl: getOption(parsed.flags, 'database-url', 'DATABASE_URL'),
      });
      process.stdout.write(renderPlan(plan));
      if (execute) {
        executePlan(plan.steps.map((step) => step.command));
      }
      return;
    }
    case 'config-rollback': {
      const plan = buildConfigRollbackPlan({
        currentConfigVersion: getOption(parsed.flags, 'current-config-version', 'CURRENT_CONFIG_VERSION'),
        targetConfigVersion: getOption(parsed.flags, 'target-config-version', 'TARGET_CONFIG_VERSION'),
      });
      process.stdout.write(renderPlan(plan));
      if (execute) {
        executePlan(plan.steps.map((step) => step.command).filter((command) => !command.startsWith('手工')));
      }
      return;
    }
    default: {
      throw new Error(`OPS_UNHANDLED_COMMAND:${parsed.command}`);
    }
  }
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown';
  console.error(message);
  process.exitCode = 1;
}
