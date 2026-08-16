import { loadConfigRegistry } from './config.js';

const version = process.env['ACTIVE_CONFIG_VERSION'] ?? '2026.08.16.1';
const releasesRoot = process.env['CONFIG_RELEASES_ROOT'] ?? '../../config/releases';
const registry = loadConfigRegistry({ releasesRoot, version });

console.log(
  JSON.stringify({
    config_version: registry.manifest.config_version,
    formula_version: registry.manifest.formula_version,
    status: 'valid',
  }),
);
