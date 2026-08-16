import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupCopiedReleases,
  configReleasesRoot,
  configVersion,
  copyCurrentRelease,
  readReleaseJson,
  refreshManifestHash,
  writeReleaseJson,
} from './fixtures/config-release.js';

import { validateReleaseDirectory } from '../tooling/config-validate/src/validator.js';

afterEach(() => {
  cleanupCopiedReleases();
});

function removeAction(root: string, actionId: string): void {
  const actions = readReleaseJson<Array<Record<string, unknown>>>(root, 'actions.json');
  const filtered = actions.filter((action) => action['id'] !== actionId);
  writeReleaseJson(root, 'actions.json', filtered);
  refreshManifestHash(root);
}

function mutateAction(root: string, actionId: string, patch: Record<string, unknown>): void {
  const actions = readReleaseJson<Array<Record<string, unknown>>>(root, 'actions.json');
  const index = actions.findIndex((action) => action['id'] === actionId);
  expect(index).toBeGreaterThanOrEqual(0);
  actions[index] = {
    ...actions[index],
    ...patch,
  };
  writeReleaseJson(root, 'actions.json', actions);
  refreshManifestHash(root);
}

describe('config reachability validator', () => {
  it('accepts the current release', () => {
    const report = validateReleaseDirectory({ releasesRoot: configReleasesRoot, version: configVersion });

    expect(report.ok).toBe(true);
    expect(report.failure_count).toBe(0);
    expect(report.failures).toEqual([]);
  });

  it('rejects a release that loses the only non-market source', () => {
    const root = copyCurrentRelease();
    removeAction(root, 'action.t1.herb_baicao_valley');

    const report = validateReleaseDirectory({ releasesRoot: root, version: configVersion });

    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONFIG_REACHABILITY_MISSING_SOURCE',
          item_id: 'item.t1.qingling_herb',
        }),
      ]),
    );
  });

  it('rejects a release whose only source is market tagged', () => {
    const root = copyCurrentRelease();
    mutateAction(root, 'action.t1.herb_baicao_valley', {
      tags: ['market', 'gathering'],
      source_note: 'future market only',
    });

    const report = validateReleaseDirectory({ releasesRoot: root, version: configVersion });

    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONFIG_REACHABILITY_MARKET_ONLY',
          item_id: 'item.t1.qingling_herb',
        }),
      ]),
    );
  });

  it('rejects a release with a cycle and no root source', () => {
    const root = copyCurrentRelease();
    mutateAction(root, 'action.t1.herb_baicao_valley', {
      inputs: [{ item_id: 'item.t1.ninglu_hua', quantity: '1' }],
      tags: ['gathering'],
      source_note: 'cycle alpha',
    });
    mutateAction(root, 'action.t1.herb_wuyin_slope', {
      inputs: [{ item_id: 'item.t1.qingling_herb', quantity: '1' }],
      tags: ['gathering'],
      source_note: 'cycle beta',
    });

    const report = validateReleaseDirectory({ releasesRoot: root, version: configVersion });

    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONFIG_REACHABILITY_CYCLE',
          item_id: 'item.t1.qingling_herb',
        }),
      ]),
    );
  });
});
