import type { DatabasePool } from '@dongtian/database';

type Queryable = Pick<DatabasePool, 'query'>;

export const ECONOMY_DOMAINS = ['SETTLEMENT', 'DUNGEON', 'TEMPERING', 'BREAKTHROUGH', 'OTHER'] as const;
export type EconomyDomain = (typeof ECONOMY_DOMAINS)[number];

export const ECONOMY_FLOWS = ['FAUCET', 'SINK'] as const;
export type EconomyFlow = (typeof ECONOMY_FLOWS)[number];

export type EconomyExportFilters = Readonly<{
  readonly fromAt?: Date;
  readonly toAt?: Date;
  readonly configVersion?: string;
  readonly domains?: readonly EconomyDomain[];
}>;

export type EconomyRollupRow = Readonly<{
  readonly day_utc: string;
  readonly domain: EconomyDomain;
  readonly flow: EconomyFlow;
  readonly asset_type: string;
  readonly asset_id: string;
  readonly reason_code: string;
  readonly reference_type: string;
  readonly reference_id: string;
  readonly character_id: string;
  readonly config_version: string;
  readonly entry_count: number;
  readonly transaction_count: number;
  readonly gross_amount: string;
  readonly net_amount: string;
  readonly balance_after: string;
  readonly outbox_event_count: number;
  readonly matching_outbox_event_count: number;
}>;

export type EconomyReconciliationRow = Readonly<{
  readonly transaction_id: string;
  readonly character_id: string;
  readonly operation_type: string;
  readonly reason_code: string;
  readonly reference_type: string;
  readonly reference_id: string;
  readonly config_version: string;
  readonly ledger_entry_count: number;
  readonly ledger_gross_amount: string;
  readonly ledger_net_amount: string;
  readonly outbox_event_count: number;
  readonly matching_outbox_event_count: number;
  readonly mismatch_kind: 'MISSING_LEDGER' | 'MISSING_OUTBOX' | 'MISMATCHED_TRANSACTION_ID';
}>;

export type EconomySummary = Readonly<{
  readonly faucet_total: string;
  readonly sink_total: string;
  readonly net_issuance: string;
  readonly ledger_entry_count: number;
  readonly transaction_count: number;
  readonly mismatch_count: number;
  readonly outbox_match_count: number;
}>;

export type EconomyReport = Readonly<{
  readonly summary: EconomySummary;
  readonly rollupRows: readonly EconomyRollupRow[];
  readonly reconciliationRows: readonly EconomyReconciliationRow[];
}>;

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`ECONOMY_AUDIT_INVALID:${field}`);
  }
}

function domainCaseSql(alias: 'al' | 'at'): string {
  return `
    CASE
      WHEN ${alias}.reference_type = 'SETTLEMENT_RUN' OR ${alias}.reason_code = 'ACTION_CULTIVATION' THEN 'SETTLEMENT'
      WHEN ${alias}.reference_type = 'DUNGEON_RUN' OR ${alias}.reason_code LIKE 'DUNGEON%' THEN 'DUNGEON'
      WHEN ${alias}.reference_type = 'TEMPER_ATTEMPT' OR ${alias}.reason_code LIKE 'TEMPER%' THEN 'TEMPERING'
      WHEN ${alias}.reference_type LIKE 'BREAKTHROUGH%' OR ${alias}.reason_code LIKE 'BREAKTHROUGH%' THEN 'BREAKTHROUGH'
      ELSE 'OTHER'
    END
  `;
}

function domainFilterClause(domains: readonly EconomyDomain[] | undefined, placeholder: string): string {
  if (!domains || domains.length === 0) {
    return 'TRUE';
  }
  return `${domainCaseSql('al')} = ANY(${placeholder}::text[])`;
}

function buildFiltersClause(filters: EconomyExportFilters, parameters: unknown[]): string {
  parameters.push(filters.fromAt ?? null, filters.toAt ?? null, filters.configVersion ?? null, filters.domains ?? null);
  return `
    WHERE ($1::timestamptz IS NULL OR al.created_at >= $1)
      AND ($2::timestamptz IS NULL OR al.created_at < $2)
      AND ($3::text IS NULL OR al.config_version = $3)
      AND (${domainFilterClause(filters.domains, '$4')})
  `;
}

export function buildEconomyRollupQuery(filters: EconomyExportFilters = {}): { readonly sql: string; readonly params: readonly unknown[] } {
  const params: unknown[] = [];
  const whereClause = buildFiltersClause(filters, params);
  return {
    sql: `
      WITH filtered_ledger AS (
        SELECT
          al.transaction_id,
          al.character_id,
          al.asset_type,
          al.asset_id,
          al.reason_code,
          al.reference_type,
          al.reference_id,
          al.config_version,
          al.delta::numeric AS delta,
          al.balance_after::numeric AS balance_after,
          al.created_at,
          date_trunc('day', al.created_at AT TIME ZONE 'UTC')::date AS day_utc,
          ${domainCaseSql('al')} AS domain
        FROM asset_ledger al
        INNER JOIN asset_transactions at ON at.id = al.transaction_id
        ${whereClause}
      ),
      outbox_quality AS (
        SELECT
          oe.transaction_id,
          COUNT(*)::int AS outbox_event_count,
          COUNT(*) FILTER (WHERE (oe.payload ->> 'transaction_id') = oe.transaction_id::text)::int AS matching_outbox_event_count
        FROM outbox_events oe
        WHERE ($3::text IS NULL OR EXISTS (
          SELECT 1
            FROM asset_transactions at
           WHERE at.id = oe.transaction_id
             AND at.config_version = $3
        ))
        GROUP BY oe.transaction_id
      ),
      ledger_rollup AS (
        SELECT
          day_utc::text AS day_utc,
          domain,
          CASE WHEN delta >= 0 THEN 'FAUCET' ELSE 'SINK' END AS flow,
          asset_type,
          asset_id,
          reason_code,
          reference_type,
          reference_id,
          character_id,
          config_version,
          COUNT(*)::int AS entry_count,
          COUNT(DISTINCT transaction_id)::int AS transaction_count,
          SUM(ABS(delta))::text AS gross_amount,
          SUM(delta)::text AS net_amount,
          MAX(balance_after)::text AS balance_after,
          COALESCE(SUM(COALESCE(oq.outbox_event_count, 0)), 0)::int AS outbox_event_count,
          COALESCE(SUM(COALESCE(oq.matching_outbox_event_count, 0)), 0)::int AS matching_outbox_event_count
        FROM filtered_ledger fl
        LEFT JOIN outbox_quality oq ON oq.transaction_id = fl.transaction_id
        GROUP BY day_utc, domain, flow, asset_type, asset_id, reason_code, reference_type, reference_id, character_id, config_version
      )
      SELECT
        day_utc, domain, flow, asset_type, asset_id, reason_code, reference_type, reference_id,
        character_id, config_version, entry_count, transaction_count, gross_amount, net_amount,
        balance_after, outbox_event_count, matching_outbox_event_count
      FROM ledger_rollup
      ORDER BY day_utc ASC, domain ASC, asset_type ASC, asset_id ASC, reason_code ASC, reference_id ASC
    `,
    params,
  };
}

export function buildEconomyReconciliationQuery(filters: EconomyExportFilters = {}): { readonly sql: string; readonly params: readonly unknown[] } {
  const params: unknown[] = [];
  const whereClause = `
    WHERE ($1::timestamptz IS NULL OR at.created_at >= $1)
      AND ($2::timestamptz IS NULL OR at.created_at < $2)
      AND ($3::text IS NULL OR at.config_version = $3)
      AND (${filters.domains && filters.domains.length > 0
        ? `${domainCaseSql('at')} = ANY($4::text[])`
        : 'TRUE'})
  `;
  params.push(filters.fromAt ?? null, filters.toAt ?? null, filters.configVersion ?? null, filters.domains ?? null);
  return {
    sql: `
      SELECT
        at.id AS transaction_id,
        at.character_id,
        at.operation_type,
        at.reason_code,
        at.reference_type,
        at.reference_id,
        at.config_version,
        COUNT(al.entry_id)::int AS ledger_entry_count,
        COALESCE(SUM(ABS(al.delta))::text, '0') AS ledger_gross_amount,
        COALESCE(SUM(al.delta)::text, '0') AS ledger_net_amount,
        COUNT(oe.id)::int AS outbox_event_count,
        COUNT(oe.id) FILTER (WHERE (oe.payload ->> 'transaction_id') = at.id::text)::int AS matching_outbox_event_count,
        CASE
          WHEN COUNT(al.entry_id) = 0 THEN 'MISSING_LEDGER'
          WHEN COUNT(oe.id) FILTER (WHERE (oe.payload ->> 'transaction_id') = at.id::text) = 0 THEN 'MISSING_OUTBOX'
          WHEN COUNT(oe.id) FILTER (WHERE (oe.payload ->> 'transaction_id') = at.id::text) <> COUNT(oe.id) THEN 'MISMATCHED_TRANSACTION_ID'
          ELSE NULL
        END AS mismatch_kind
      FROM asset_transactions at
      LEFT JOIN asset_ledger al ON al.transaction_id = at.id
      LEFT JOIN outbox_events oe ON oe.transaction_id = at.id
      ${whereClause}
      GROUP BY at.id, at.character_id, at.operation_type, at.reason_code, at.reference_type, at.reference_id, at.config_version
      HAVING COUNT(al.entry_id) = 0
         OR COUNT(oe.id) FILTER (WHERE (oe.payload ->> 'transaction_id') = at.id::text) = 0
         OR COUNT(oe.id) FILTER (WHERE (oe.payload ->> 'transaction_id') = at.id::text) <> COUNT(oe.id)
      ORDER BY at.created_at ASC, at.id ASC
    `,
    params,
  };
}

export function buildEconomySummaryQuery(filters: EconomyExportFilters = {}): { readonly sql: string; readonly params: readonly unknown[] } {
  const params: unknown[] = [];
  const whereClause = buildFiltersClause(filters, params);
  return {
    sql: `
      WITH filtered_ledger AS (
        SELECT
          al.delta::numeric AS delta,
          al.transaction_id,
          ${domainCaseSql('al')} AS domain
        FROM asset_ledger al
        INNER JOIN asset_transactions at ON at.id = al.transaction_id
        ${whereClause}
      )
      SELECT
        COALESCE(SUM(CASE WHEN delta >= 0 THEN delta ELSE 0 END), 0)::text AS faucet_total,
        COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0)::text AS sink_total,
        COALESCE(SUM(delta), 0)::text AS net_issuance,
        COUNT(*)::int AS ledger_entry_count,
        COUNT(DISTINCT transaction_id)::int AS transaction_count,
        0::int AS mismatch_count,
        0::int AS outbox_match_count
      FROM filtered_ledger
    `,
    params,
  };
}

export async function loadEconomyReport(pool: Queryable, filters: EconomyExportFilters = {}): Promise<EconomyReport> {
  const summaryQuery = buildEconomySummaryQuery(filters);
  const rollupQuery = buildEconomyRollupQuery(filters);
  const reconciliationQuery = buildEconomyReconciliationQuery(filters);
  const [summaryResult, rollupResult, reconciliationResult] = await Promise.all([
    pool.query<EconomySummary>(summaryQuery.sql, summaryQuery.params),
    pool.query<EconomyRollupRow>(rollupQuery.sql, rollupQuery.params),
    pool.query<Omit<EconomyReconciliationRow, 'mismatch_kind'> & { readonly mismatch_kind: EconomyReconciliationRow['mismatch_kind'] | null }>(
      reconciliationQuery.sql,
      reconciliationQuery.params,
    ),
  ]);

  const summaryRow = summaryResult.rows[0] ?? {
    faucet_total: '0',
    sink_total: '0',
    net_issuance: '0',
    ledger_entry_count: 0,
    transaction_count: 0,
    mismatch_count: 0,
    outbox_match_count: 0,
  };
  const mismatchCount = reconciliationResult.rows.length;
  const outboxMatchCount = rollupResult.rows.reduce(
    (total, row) => total + row.matching_outbox_event_count,
    0,
  );

  return {
    summary: {
      ...summaryRow,
      mismatch_count: mismatchCount,
      outbox_match_count: outboxMatchCount,
    },
    rollupRows: rollupResult.rows,
    reconciliationRows: reconciliationResult.rows.filter((row): row is EconomyReconciliationRow => row.mismatch_kind !== null),
  };
}

export function serializeReportAsJson(report: EconomyReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function escapeCsv(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function rowsToCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return '\n';
  }
  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(String(row[header] ?? ''))).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function serializeReportAsCsv(report: EconomyReport): string {
  return rowsToCsv(report.rollupRows);
}

export function assertEconomyFilters(filters: EconomyExportFilters): void {
  if (filters.configVersion !== undefined) {
    assertNonEmpty(filters.configVersion, 'configVersion');
  }
}
