import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

export type OpsCommandName = 'backup' | 'restore-drill' | 'check-wal' | 'outbox-dedupe' | 'config-rollback';

export type ParsedArgs = Readonly<{
  readonly command: OpsCommandName;
  readonly flags: ReadonlyMap<string, string | boolean>;
  readonly positionals: readonly string[];
}>;

export type PlanStep = Readonly<{
  readonly title: string;
  readonly command: string;
  readonly purpose: string;
  readonly risk: 'read-only' | 'write' | 'manual';
}>;

export type OpsPlan = Readonly<{
  readonly title: string;
  readonly summary: string;
  readonly prerequisites: readonly string[];
  readonly warnings: readonly string[];
  readonly steps: readonly PlanStep[];
}>;

export type BackupPlanInput = Readonly<{
  readonly databaseUrl: string;
  readonly backupDir: string;
  readonly execute: boolean;
  readonly label?: string;
  readonly now?: Date;
}>;

export type RestoreDrillPlanInput = Readonly<{
  readonly backupFile: string;
  readonly restoreDatabaseUrl: string;
  readonly execute: boolean;
  readonly sourceDatabaseUrl?: string;
  readonly expectedConfigVersion?: string;
  readonly now?: Date;
}>;

export type WalCheckPlanInput = Readonly<{
  readonly databaseUrl: string;
}>;

export type OutboxDedupePlanInput = Readonly<{
  readonly databaseUrl: string;
}>;

export type ConfigRollbackPlanInput = Readonly<{
  readonly currentConfigVersion: string;
  readonly targetConfigVersion: string;
}>;

const DANGEROUS_DIRS = new Set([
  resolve('/'),
  resolve('/tmp'),
  resolve('/var'),
  resolve('/var/tmp'),
  resolve(tmpdir()),
  resolve(homedir()),
]);

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`OPS_INVALID_ARGUMENT:${field}`);
  }
  return trimmed;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) {
    throw new Error('OPS_MISSING_COMMAND');
  }

  const [command, ...rest] = argv;
  if (command !== 'backup' && command !== 'restore-drill' && command !== 'check-wal' && command !== 'outbox-dedupe' && command !== 'config-rollback') {
    throw new Error(`OPS_UNKNOWN_COMMAND:${command}`);
  }

  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined) {
      continue;
    }
    if (token === '--') {
      continue;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    if (token.startsWith('--no-')) {
      flags.set(token.slice(5), false);
      continue;
    }

    const equalsIndex = token.indexOf('=');
    if (equalsIndex >= 0) {
      const name = token.slice(2, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      flags.set(name, value);
      continue;
    }

    const name = token.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
      continue;
    }

    flags.set(name, true);
  }

  return {
    command,
    flags,
    positionals,
  };
}

export function readStringOption(flags: ReadonlyMap<string, string | boolean>, name: string, envValue?: string): string | undefined {
  const flagValue = flags.get(name);
  if (typeof flagValue === 'string') {
    return assertNonEmpty(flagValue, name);
  }
  if (typeof envValue === 'string') {
    return assertNonEmpty(envValue, name);
  }
  return undefined;
}

export function readBooleanOption(flags: ReadonlyMap<string, string | boolean>, name: string): boolean {
  return flags.get(name) === true;
}

function sanitizeFragment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'database';
}

export function assertSafeDirectoryTarget(input: string, field: string): string {
  const raw = assertNonEmpty(input, field);
  if (!isAbsolute(raw)) {
    throw new Error(`OPS_PATH_NOT_ABSOLUTE:${field}`);
  }

  const normalized = resolve(raw);
  const parsed = parse(normalized);

  if (normalized === parsed.root) {
    throw new Error(`OPS_PATH_TOO_BROAD:${field}`);
  }
  if (DANGEROUS_DIRS.has(normalized)) {
    throw new Error(`OPS_PATH_TOO_BROAD:${field}`);
  }
  return normalized;
}

export function assertSafeFileTarget(input: string, field: string): string {
  const raw = assertNonEmpty(input, field);
  if (!isAbsolute(raw)) {
    throw new Error(`OPS_PATH_NOT_ABSOLUTE:${field}`);
  }
  const normalized = resolve(raw);
  if (DANGEROUS_DIRS.has(normalized)) {
    throw new Error(`OPS_PATH_TOO_BROAD:${field}`);
  }
  return normalized;
}

function quoteShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandLine(executable: string, args: readonly string[]): string {
  return [quoteShellArg(executable), ...args.map(quoteShellArg)].join(' ');
}

function postgresDbName(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const pathName = url.pathname.replace(/^\/+/, '');
    return sanitizeFragment(pathName.length > 0 ? pathName : 'database');
  } catch {
    return 'database';
  }
}

function timestampLabel(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '');
}

function makeBackupPath(backupDir: string, databaseUrl: string, now: Date, explicitLabel?: string): string {
  const label = explicitLabel !== undefined ? sanitizeFragment(explicitLabel) : timestampLabel(now);
  const dbName = postgresDbName(databaseUrl);
  return join(backupDir, 'postgres', dbName, `${label}.dump`);
}

function ensureSameDatabaseGuard(sourceUrl: string | undefined, targetUrl: string): void {
  if (sourceUrl !== undefined && sourceUrl.trim() === targetUrl.trim()) {
    throw new Error('OPS_RESTORE_TARGET_MATCHES_SOURCE');
  }
}

function buildPsqlCommand(databaseUrl: string, sql: string): string {
  return commandLine('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-d', databaseUrl, '-c', sql]);
}

export function buildBackupPlan(input: BackupPlanInput): OpsPlan {
  const databaseUrl = assertNonEmpty(input.databaseUrl, 'database-url');
  const backupDir = assertSafeDirectoryTarget(input.backupDir, 'backup-dir');
  const backupFile = makeBackupPath(backupDir, databaseUrl, input.now ?? new Date(), input.label);
  const plan: OpsPlan = {
    title: 'PostgreSQL 全量备份演练',
    summary: '默认 dry-run。只生成 pg_dump 命令，不会删除目录，也不会覆盖宽泛路径。',
    prerequisites: [
      'DATABASE_URL 必须指向明确的源库。',
      'BACKUP_DIR 必须是显式绝对路径，且不能是 /、home 根目录或临时根目录。',
      '演练目录下不做广泛删除，备份只写入唯一时间戳文件。',
    ],
    warnings: [
      '未传 --execute 时仅输出命令，不实际连接数据库。',
      '执行模式下仍不进行任何 rm / rmdir 操作。',
    ],
    steps: [
      {
        title: '创建备份目录',
        command: commandLine('mkdir', ['-p', dirname(backupFile)]),
        purpose: '准备唯一备份落点，避免写入危险默认路径。',
        risk: 'write',
      },
      {
        title: '生成 custom-format 备份',
        command: `umask 077 && ${commandLine('pg_dump', ['--format=custom', '--compress=9', '--no-owner', '--no-acl', '--file', backupFile, databaseUrl])}`,
        purpose: '产出可用于 pg_restore 的全量备份文件。',
        risk: 'read-only',
      },
    ],
  };
  return plan;
}

export function buildRestoreDrillPlan(input: RestoreDrillPlanInput): OpsPlan {
  const backupFile = assertSafeFileTarget(input.backupFile, 'backup-file');
  const restoreDatabaseUrl = assertNonEmpty(input.restoreDatabaseUrl, 'restore-database-url');
  ensureSameDatabaseGuard(input.sourceDatabaseUrl, restoreDatabaseUrl);

  const configVersion = input.expectedConfigVersion?.trim();
  const configCheckCommand = configVersion
    ? `ACTIVE_CONFIG_VERSION=${quoteShellArg(configVersion)} pnpm config:validate`
    : 'pnpm config:validate';

  const steps: PlanStep[] = [
    {
      title: '隔离目标恢复',
      command: commandLine('pg_restore', ['--verbose', '--no-owner', '--no-acl', '--dbname', restoreDatabaseUrl, backupFile]),
      purpose: '只恢复到显式的隔离目标，不做同库覆盖。',
      risk: 'write',
    },
    {
      title: '执行数据库迁移',
      command: 'pnpm db:migrate',
      purpose: '将恢复后的数据库推进到当前迁移版本。',
      risk: 'write',
    },
    {
      title: '校验配置版本',
      command: configCheckCommand,
      purpose: '确认恢复后使用的配置包版本和预期一致。',
      risk: 'read-only',
    },
    {
      title: '账本与 outbox 审计',
      command: 'pnpm db:audit',
      purpose: '检查账本核对、交易完整性和 outbox 关联。',
      risk: 'read-only',
    },
    {
      title: 'outbox 去重核对',
      command: commandLine('pnpm', ['ops:outbox-dedupe', '--', '--database-url', restoreDatabaseUrl]),
      purpose: '确认按 transaction_id 去重后没有重复投递风险。',
      risk: 'read-only',
    },
  ];

  if (input.execute) {
    steps.unshift({
      title: '恢复前检查备份文件',
      command: commandLine('test', ['-s', backupFile]),
      purpose: '确认备份文件存在且非空。',
      risk: 'read-only',
    });
  }

  return {
    title: '隔离恢复演练',
    summary: '默认 dry-run。恢复目标必须是显式隔离数据库 URL，随后依次做迁移、配置校验、账本审计和 outbox 去重核对。',
    prerequisites: [
      'BACKUP_FILE 必须是明确的单个备份文件，不接受目录扫描。',
      'RESTORE_DATABASE_URL 必须不同于源库 DATABASE_URL。',
      '恢复演练只允许在隔离环境进行。',
    ],
    warnings: [
      'pg_restore 不包含 --clean，避免误删目标库中的宽泛对象。',
      '若配置版本校验失败，必须先回滚配置再重试，不得直接修改历史账本。',
    ],
    steps,
  };
}

export function buildWalCheckPlan(input: WalCheckPlanInput): OpsPlan {
  const databaseUrl = assertNonEmpty(input.databaseUrl, 'database-url');
  const sql = `
    SELECT name, setting, unit, source
      FROM pg_settings
     WHERE name IN (
       'archive_mode',
       'archive_command',
       'archive_timeout',
       'checkpoint_timeout',
       'max_wal_size',
       'wal_compression',
       'wal_level',
       'max_wal_senders'
     )
     ORDER BY name;
  `.trim();

  return {
    title: 'WAL / RPO / RTO 配置检查',
    summary: '只读检查 PostgreSQL 归档、WAL 和 checkpoint 相关配置，用来核对 RPO <= 15m 与 RTO <= 2h 的前置条件。',
    prerequisites: [
      '数据库必须允许只读连接。',
      '检查命令不修改任何参数。',
    ],
    warnings: [
      '如果 archive_mode=off 或 archive_command 为空，则无法满足 15 分钟 RPO。',
      '如果没有定期恢复演练，RTO 只能算假设值，不能当成已验证事实。',
    ],
    steps: [
      {
        title: '读取 PostgreSQL WAL 相关参数',
        command: buildPsqlCommand(databaseUrl, sql),
        purpose: '确认 WAL 归档、保留和 checkpoint 策略是否满足恢复窗口。',
        risk: 'read-only',
      },
    ],
  };
}

export function buildOutboxDedupePlan(input: OutboxDedupePlanInput): OpsPlan {
  const databaseUrl = assertNonEmpty(input.databaseUrl, 'database-url');
  const sql = `
    WITH duplicate_transaction_ids AS (
      SELECT
        transaction_id,
        COUNT(*)::int AS row_count,
        COUNT(*) FILTER (WHERE payload ->> 'transaction_id' = transaction_id::text)::int AS matching_payload_rows
      FROM outbox_events
      GROUP BY transaction_id
      HAVING COUNT(*) > 1
         OR COUNT(*) FILTER (WHERE payload ->> 'transaction_id' = transaction_id::text) <> COUNT(*)
    )
    SELECT *
      FROM duplicate_transaction_ids
     ORDER BY row_count DESC, transaction_id ASC;
  `.trim();

  return {
    title: 'Outbox 去重核对',
    summary: '只读核对 outbox_events 是否存在按 transaction_id 去重后的重复行或 payload 不一致。',
    prerequisites: [
      '数据库必须只读可连。',
      '该检查只判断重复风险，不自动删除 outbox 行。',
    ],
    warnings: [
      '发现重复不代表可以手工删行，必须先确认消费者幂等和补偿策略。',
    ],
    steps: [
      {
        title: '扫描重复 transaction_id',
        command: buildPsqlCommand(databaseUrl, sql),
        purpose: '找出需要去重或补偿的 outbox 记录。',
        risk: 'read-only',
      },
    ],
  };
}

export function buildConfigRollbackPlan(input: ConfigRollbackPlanInput): OpsPlan {
  const currentConfigVersion = assertNonEmpty(input.currentConfigVersion, 'current-config-version');
  const targetConfigVersion = assertNonEmpty(input.targetConfigVersion, 'target-config-version');

  return {
    title: '配置回滚流程',
    summary: `从 ${currentConfigVersion} 回滚到 ${targetConfigVersion}，只允许切换不可变配置版本，不允许覆盖历史包。`,
    prerequisites: [
      '必须有已验证通过的上一版本配置包。',
      '切换前确认当前运行快照没有依赖需要强制停写。',
    ],
    warnings: [
      '不要直接修改历史 manifest 或覆盖同名 release 文件。',
      '配置回滚失败时先恢复到已知可用版本，再做问题定位。',
    ],
    steps: [
      {
        title: '确认当前与目标版本',
        command: `printf '%s\\n' ${quoteShellArg(`current=${currentConfigVersion}`)} ${quoteShellArg(`target=${targetConfigVersion}`)}`,
        purpose: '记录回滚前后的版本边界。',
        risk: 'manual',
      },
      {
        title: '重新导出 / 切换配置包引用',
        command: `ACTIVE_CONFIG_VERSION=${quoteShellArg(targetConfigVersion)} pnpm config:validate`,
        purpose: '在切换前先做目标版本校验，避免回滚到坏包。',
        risk: 'read-only',
      },
      {
        title: '刷新服务配置并重启 worker / API',
        command: '手工切换运行配置后，重启 worker 与 API，随后复查健康检查与 config_version。',
        purpose: '确保所有进程读取同一版本。',
        risk: 'manual',
      },
    ],
  };
}

export function renderPlan(plan: OpsPlan): string {
  const lines: string[] = [];
  lines.push(plan.title);
  lines.push(plan.summary);
  if (plan.prerequisites.length > 0) {
    lines.push('');
    lines.push('Preflight:');
    for (const prerequisite of plan.prerequisites) {
      lines.push(`- ${prerequisite}`);
    }
  }
  if (plan.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of plan.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push('');
  lines.push('Steps:');
  plan.steps.forEach((step, index) => {
    lines.push(`${index + 1}. [${step.risk}] ${step.title}`);
    lines.push(`   ${step.purpose}`);
    lines.push(`   ${step.command.replace(/\b(postgres(?:ql)?:\/\/)([^@\s'"]+)@/gu, '$1***@')}`);
  });
  return `${lines.join('\n')}\n`;
}

export function toShellScript(plan: OpsPlan): string {
  return plan.steps.map((step) => step.command).join('\n');
}
