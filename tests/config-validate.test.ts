import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { validateReleaseDirectory } from '../tooling/config-validate/src/validator.js';

const version = '2026.08.16.1';
const releasePath = fileURLToPath(new URL(`../config/releases/${version}`, import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyRelease(): string {
  const root = mkdtempSync(join(tmpdir(), 'dongtian-config-validate-'));
  temporaryRoots.push(root);
  cpSync(releasePath, join(root, version), { recursive: true });
  return root;
}

describe('config validation', () => {
  it('accepts the active release', () => {
    const report = validateReleaseDirectory({
      releasesRoot: fileURLToPath(new URL('../config/releases', import.meta.url)),
      version,
    });

    expect(report.ok).toBe(true);
    expect(report.failure_count).toBe(0);
  });

  it('flags when a unique source is removed', () => {
    const root = copyRelease();
    const actionsPath = join(root, version, 'actions.json');
    const actions = JSON.parse(readFileSync(actionsPath, 'utf8')) as Array<Record<string, unknown>>;
    const sourceAction = actions.find((action) => action['id'] === 'action.t1.herb_baicao_valley');
    expect(sourceAction).toBeDefined();
    if (sourceAction !== undefined) {
      sourceAction['outputs'] = [];
    }
    writeFileSync(actionsPath, `${JSON.stringify(actions, null, 2)}\n`);

    const report = validateReleaseDirectory({ releasesRoot: root, version });

    expect(report.ok).toBe(false);
    expect(report.failures.some((failure) => failure.code === 'CONFIG_REACHABILITY_MISSING_SOURCE')).toBe(true);
  });
});
