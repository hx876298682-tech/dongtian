import { describe, expect, it, vi } from 'vitest';

import { buildEconomyReconciliationQuery, buildEconomyRollupQuery, buildEconomySummaryQuery, loadEconomyReport, serializeReportAsCsv } from './economy.js';

describe('economy audit helpers', () => {
  it('builds parameterized rollup, summary, and reconciliation queries', () => {
    const rollup = buildEconomyRollupQuery({
      fromAt: new Date('2026-08-16T00:00:00.000Z'),
      toAt: new Date('2026-08-17T00:00:00.000Z'),
      configVersion: '2026.08.16.1',
      domains: ['SETTLEMENT', 'DUNGEON'],
    });
    const summary = buildEconomySummaryQuery({});
    const reconciliation = buildEconomyReconciliationQuery({});

    expect(rollup.sql).toContain('FROM asset_ledger al');
    expect(rollup.sql).toContain('CASE WHEN delta >= 0 THEN \'FAUCET\' ELSE \'SINK\' END');
    expect(rollup.sql).toContain('COUNT(DISTINCT transaction_id)::int AS transaction_count');
    expect(rollup.params).toHaveLength(4);
    expect(summary.sql).toContain('net_issuance');
    expect(reconciliation.sql).toContain('mismatch_kind');
  });

  it('loads a report from the database and renders csv rows', async () => {
    const queries: string[] = [];
    const pool = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        if (sql.includes('ledger_entry_count') && sql.includes('transaction_count') && sql.includes('mismatch_count')) {
          return { rows: [{
            faucet_total: '12.5',
            sink_total: '2.5',
            net_issuance: '10.0',
            ledger_entry_count: 2,
            transaction_count: 1,
            mismatch_count: 0,
            outbox_match_count: 1,
          }] as T[] };
        }
        if (sql.includes('mismatch_kind')) {
          return { rows: [] as T[] };
        }
        return { rows: [{
          day_utc: '2026-08-16',
          domain: 'SETTLEMENT',
          flow: 'FAUCET',
          asset_type: 'ITEM',
          asset_id: 'item.t1.qingling_herb',
          reason_code: 'ACTION_CULTIVATION',
          reference_type: 'SETTLEMENT_RUN',
          reference_id: 'run-1',
          character_id: 'character-1',
          config_version: '2026.08.16.1',
          entry_count: 1,
          transaction_count: 1,
          gross_amount: '12.5',
          net_amount: '12.5',
          balance_after: '12.5',
          outbox_event_count: 1,
          matching_outbox_event_count: 1,
        }] as T[] };
      },
    };

    const report = await loadEconomyReport(pool as never, {});
    expect(report.summary.faucet_total).toBe('12.5');
    expect(report.rollupRows).toHaveLength(1);
    expect(serializeReportAsCsv(report)).toContain('day_utc,domain,flow');
    expect(queries).toHaveLength(3);
  });
});
