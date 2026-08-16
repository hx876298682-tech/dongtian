import { createDatabasePool } from '@dongtian/database';

import { loadEconomyReport, serializeReportAsCsv, serializeReportAsJson } from './economy.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is required for the economy audit.');
  process.exitCode = 1;
} else {
  const pool = createDatabasePool(databaseUrl);
  const csv = process.argv.includes('--csv');
  try {
    const report = await loadEconomyReport(pool, {
      configVersion: process.env['CONFIG_VERSION'] ?? undefined,
    });
    process.stdout.write(csv ? serializeReportAsCsv(report) : serializeReportAsJson(report));
    if (report.reconciliationRows.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Economy audit failed.', error instanceof Error ? error.message : 'unknown');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
