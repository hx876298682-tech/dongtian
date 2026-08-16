import { join } from 'node:path';

import { validateReleaseDirectory } from './validator.js';

const version = process.env['ACTIVE_CONFIG_VERSION'] ?? '2026.08.16.1';
const releasesRoot = process.env['CONFIG_RELEASES_ROOT'] ?? join(process.cwd(), 'config/releases');

const report = validateReleaseDirectory({ releasesRoot, version });

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) {
  process.exitCode = 1;
}
