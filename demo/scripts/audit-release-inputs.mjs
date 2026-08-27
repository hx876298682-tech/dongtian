import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCsv, parseParameterValue, sha256, validateParameterRows } from './parameter-table.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const csvPath = resolve(root, 'docs/洞天数值参数表.csv');
const source = await readFile(csvPath, 'utf8');
const rows = parseCsv(source);
validateParameterRows(rows, { requireFrozen: true });
const sourceHash = sha256(source);
const expectedParameters = Object.fromEntries(rows.map((row) => [row.parameter_id, {
  value: parseParameterValue(row.value, row.parameter_id),
  unit: row.unit,
  valueType: row.value_type,
  status: row.status,
  source: row.source,
}]));

const [{ PARAMETER_MANIFEST }, { FROZEN_PARAMETER_SHA256, FROZEN_PARAMETERS }, contentSchema, release, types] = await Promise.all([
  import('../src/game/parameter-manifest.ts'),
  import('../src/game/frozen-parameters.ts'),
  import('../src/content/content-schema.ts'),
  import('../src/server/config-release.ts'),
  import('../src/server/types.ts'),
]);
const { CONTENT_PACKAGE, CONTENT_HASH, diagnoseContentReachability, validateContentPackage } = contentSchema;
const { diagnoseHighTierCombatFormalProvenance } = await import('../src/server/high-tier-contract.ts');
const { CONFIG_VERSION } = types;

assert.equal(PARAMETER_MANIFEST.version, CONFIG_VERSION, 'parameter manifest version must match runtime config version');
assert.equal(PARAMETER_MANIFEST.source, 'docs/洞天数值参数表.csv', 'parameter manifest source must be authoritative CSV');
assert.equal(PARAMETER_MANIFEST.rows, rows.length, 'generated parameter manifest row count drifted');
assert.equal(PARAMETER_MANIFEST.sha256, sourceHash, 'generated parameter manifest hash drifted');
assert.equal(FROZEN_PARAMETER_SHA256, sourceHash, 'generated frozen parameter hash drifted');
assert.ok(isDeepStrictEqual(FROZEN_PARAMETERS, expectedParameters), 'generated frozen parameter payload drifted from authoritative CSV');

validateContentPackage(CONTENT_PACKAGE, CONFIG_VERSION, sourceHash);
assert.equal(CONTENT_PACKAGE.manifest.config_version, CONFIG_VERSION, 'content config version drifted');
assert.equal(CONTENT_PACKAGE.manifest.parameter_sha256, sourceHash, 'content parameter hash drifted');
assert.equal(CONTENT_HASH, CONTENT_PACKAGE.manifest.content_sha256, 'content hash export drifted');
const reachability = diagnoseContentReachability(CONTENT_PACKAGE);
assert.equal(reachability.length, 0, `content package has reachable content_pending objects: ${JSON.stringify(reachability)}`);
const formalProvenance = diagnoseHighTierCombatFormalProvenance(FROZEN_PARAMETERS);
assert.equal(formalProvenance.length, 0, `frozen high-tier combat provenance is invalid: ${JSON.stringify(formalProvenance)}`);
release.validateConfigReleaseSnapshot({
  version: CONTENT_PACKAGE.manifest.config_version,
  parameterSha256: sourceHash,
  contentSha256: CONTENT_PACKAGE.manifest.content_sha256,
  content: CONTENT_PACKAGE,
  parameters: FROZEN_PARAMETERS,
}, { requireFormalHighTier: true });

const pendingCount = [...CONTENT_PACKAGE.maps, ...CONTENT_PACKAGE.equipment, ...CONTENT_PACKAGE.recipes].filter((item) => item.status === 'content_pending').length;
console.log(`release_inputs_audit_passed version=${CONFIG_VERSION} rows=${rows.length} parameter_sha256=${sourceHash} content_sha256=${CONTENT_PACKAGE.manifest.content_sha256} pending_objects=${pendingCount} high_tier_mode=${FROZEN_PARAMETERS['dungeon.high_tier.combat_mode']?.value}`);

