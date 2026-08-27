import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseCsv, parseParameterValue } from './parameter-table.mjs';

const root = resolve(import.meta.dirname, '..', '..');
export const candidatePath = resolve(root, 'docs/fi04-random-parameter-rows.proposal.csv');
export const centralPath = resolve(root, 'docs/洞天数值参数表.csv');

const REALMS = ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'];
const FULL_FIELDS = ['boss_attack', 'boss_defence', 'boss_accuracy', 'boss_attack_interval_seconds', 'boss_element', 'skills', 'resistances', 'auto_pill'];
const RANDOM_IDS = [
  'random_event.runtime.version',
  'random_event.roll_interval_hours',
  'random_event.max_active',
  'random_event.spirit_tide.chance',
  'random_event.spirit_tide.duration_hours',
  'random_event.spirit_tide.production_multiplier',
  'random_event.beast_raid.chance',
  'random_event.beast_raid.duration_hours',
  'random_event.beast_raid.production_multiplier',
  'random_event.none.chance',
  'random_event.formula.complete_window_expected_factor',
  'random_event.formula.2160h_expected_factor',
];
const HIGH_TIER_IDS = [
  'dungeon.high_tier.combat_mode',
  ...REALMS.flatMap((realm) => FULL_FIELDS.map((field) => `dungeon.high_tier.${realm}.${field}`)),
];
const EXPECTED_IDS = [...HIGH_TIER_IDS, ...RANDOM_IDS];

const readRows = async (path) => parseCsv(await readFile(path, 'utf8'));
const requireFiniteNumber = (row) => {
  const value = parseParameterValue(row.value, row.parameter_id);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${row.parameter_id} must contain a finite numeric candidate`);
};
const requireJsonShape = (row, expected) => {
  let parsed;
  try { parsed = JSON.parse(row.value); } catch { throw new Error(`${row.parameter_id} must contain valid JSON`); }
  if (expected === 'array' && !Array.isArray(parsed)) throw new Error(`${row.parameter_id} must contain a JSON array`);
  if (expected === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error(`${row.parameter_id} must contain a JSON object`);
};

/**
 * Validate only the proposal artifact's shape and isolation. This deliberately
 * does not approve candidate values, resolve formula disagreements, or make
 * proposal IDs consumable by the release/runtime gates.
 */
export const validateFi04Candidate = async (options = {}) => {
  const candidateRows = options.candidateRows ?? await readRows(candidatePath);
  const centralRows = options.centralRows ?? await readRows(centralPath);
  const candidate = new Map(candidateRows.map((row) => [row.parameter_id, row]));
  const centralIds = new Set(centralRows.map((row) => row.parameter_id));
  if (candidateRows.length !== EXPECTED_IDS.length) throw new Error(`FI-04 candidate must contain exactly ${EXPECTED_IDS.length} rows`);
  for (const id of EXPECTED_IDS) {
    const row = candidate.get(id);
    if (!row) throw new Error(`FI-04 candidate is missing ${id}`);
    // The mode selector intentionally shadows the frozen signature-only row:
    // it is the proposed replacement value, and must remain proposal-only.
    if (centralIds.has(id) && id !== 'dungeon.high_tier.combat_mode') throw new Error(`FI-04 candidate overlaps authoritative CSV: ${id}`);
    if (row.status !== 'proposal_v1') throw new Error(`${id} must remain proposal_v1 until formal freeze`);
    if (!row.source.trim() || !row.reference_source.trim()) throw new Error(`${id} requires source and reference_source`);
    if (row.reference_source.startsWith('docs/')) {
      if (!existsSync(resolve(root, row.reference_source))) throw new Error(`${id} references a missing document: ${row.reference_source}`);
    }
    if (id === 'dungeon.high_tier.combat_mode') {
      if (row.value !== 'full_v1') throw new Error(`${id} must retain the explicit full_v1 proposal mode`);
    } else if (id.startsWith('dungeon.high_tier.')) {
      if (id.endsWith('.skills')) requireJsonShape(row, 'array');
      else if (id.endsWith('.resistances') || id.endsWith('.auto_pill')) requireJsonShape(row, 'object');
      else if (!id.endsWith('.boss_element')) requireFiniteNumber(row);
    }
  }
  const unexpected = candidateRows.filter((row) => !EXPECTED_IDS.includes(row.parameter_id));
  if (unexpected.length > 0) throw new Error(`FI-04 candidate contains unexpected parameter IDs: ${unexpected.map((row) => row.parameter_id).join(', ')}`);
  return {
    rows: candidateRows.length,
    highTierRows: HIGH_TIER_IDS.length,
    randomEventRows: RANDOM_IDS.length,
    formulaRows: RANDOM_IDS.filter((id) => id.startsWith('random_event.formula.')).length,
    proposalOnly: candidateRows.every((row) => row.status === 'proposal_v1'),
  };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateFi04Candidate();
  console.log(`fi04_candidate_validated rows=${result.rows} high_tier_rows=${result.highTierRows} random_event_rows=${result.randomEventRows} formula_rows=${result.formulaRows} proposal_only=${result.proposalOnly}`);
}
