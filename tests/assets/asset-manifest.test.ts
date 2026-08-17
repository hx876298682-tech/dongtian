import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { validateAssetManifest } from '../../tooling/asset-validate/src/validator.js';

const assetsRoot = fileURLToPath(new URL('../../assets', import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyAssets(): string {
  const root = mkdtempSync(join(tmpdir(), 'dongtian-assets-'));
  temporaryRoots.push(root);
  cpSync(assetsRoot, join(root, 'assets'), { recursive: true });
  return join(root, 'assets');
}

function readManifest(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
}

function writeManifest(root: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('asset manifest validation', () => {
  it('accepts placeholder assets in dev mode and marks the run as degraded', () => {
    const report = validateAssetManifest({
      assetsRoot,
      mode: 'dev',
    });

    expect(report.ok).toBe(true);
    expect(report.degraded).toBe(true);
    expect(report.placeholder_entry_ids).toContain('region.t1.qingyun_foothill');
    expect(report.warning_count).toBeGreaterThan(0);
  });

  it('blocks release mode when P0 entries are still placeholders', () => {
    const report = validateAssetManifest({
      assetsRoot,
      mode: 'release',
    });

    expect(report.ok).toBe(false);
    expect(report.release_blocker_entry_ids.length).toBeGreaterThan(0);
    expect(report.errors.some((issue) => issue.code === 'ASSET_PLACEHOLDER_BLOCKS_RELEASE')).toBe(true);
  });

  it('rejects directory traversal in a resource path', () => {
    const root = copyAssets();
    const manifest = readManifest(root);
    const entries = manifest['entries'];
    expect(Array.isArray(entries)).toBe(true);
    if (!Array.isArray(entries)) {
      return;
    }

    const firstEntry = entries[0];
    expect(typeof firstEntry).toBe('object');
    if (typeof firstEntry !== 'object' || firstEntry === null) {
      return;
    }
    const resource = (firstEntry as Record<string, unknown>)['resource'];
    expect(typeof resource).toBe('object');
    if (typeof resource !== 'object' || resource === null) {
      return;
    }
    (resource as Record<string, unknown>)['relative_path'] = '../escape.svg';
    writeManifest(root, manifest);

    const report = validateAssetManifest({
      assetsRoot: root,
      mode: 'dev',
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'ASSET_INVALID_PATH')).toBe(true);
  });

  it('rejects a missing localization key', () => {
    const root = copyAssets();
    const localizationPath = join(root, 'localization', 'zh-CN.json');
    const localization = JSON.parse(readFileSync(localizationPath, 'utf8')) as Record<string, unknown>;
    delete localization['buff.body_pill.desc'];
    writeFileSync(localizationPath, `${JSON.stringify(localization, null, 2)}\n`);

    const report = validateAssetManifest({
      assetsRoot: root,
      mode: 'dev',
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'ASSET_MISSING_LOCALIZATION')).toBe(true);
  });
});
