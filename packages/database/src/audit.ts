import { createAssetRepository, createDatabasePool } from './index.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is required for the asset audit.');
  process.exitCode = 1;
} else {
  const pool = createDatabasePool(databaseUrl);
  try {
    const report = await createAssetRepository(pool).audit();
    console.log(JSON.stringify(report));
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Asset audit failed.', error instanceof Error ? error.message : 'unknown');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
