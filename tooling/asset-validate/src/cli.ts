import { resolve } from 'node:path';

import { validateAssetManifest, type AssetValidationMode } from './validator.js';

function readFlagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = argv[index + 1];
  return value === undefined ? null : value;
}

function parseMode(rawValue: string | null): AssetValidationMode {
  return rawValue === 'dev' ? 'dev' : 'release';
}

const argv = process.argv.slice(2);
const mode = parseMode(readFlagValue(argv, '--mode') ?? process.env['ASSET_VALIDATE_MODE'] ?? null);
const assetsRoot = resolve(readFlagValue(argv, '--assets-root') ?? process.env['ASSETS_ROOT'] ?? 'assets');
const manifestPath = readFlagValue(argv, '--manifest') ?? process.env['ASSET_MANIFEST_PATH'] ?? resolve(assetsRoot, 'manifest.json');

const report = validateAssetManifest({
  assetsRoot,
  manifestPath,
  mode,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (!report.ok || (mode === 'dev' && report.degraded)) {
  process.exitCode = report.ok ? 0 : 1;
}
