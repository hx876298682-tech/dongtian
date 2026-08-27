import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseCsv, parseParameterValue, validateParameterRows } from './parameter-table.mjs';

const root = resolve(import.meta.dirname, '..', '..');
export const candidatePath = resolve(root, 'docs/fi01-fi02-parameter-rows.proposal.csv');
export const centralPath = resolve(root, 'docs/洞天数值参数表.csv');

const QUALITY_ORDER = ['normal', 'fine', 'rare', 'epic', 'legendary', 'immortal'];
const EXPECTED = {
  'dungeon.qing_feng.equipment_drop_chance': 5,
  'dungeon.qing_feng.equipment_quality_normal_chance': 50,
  'dungeon.qing_feng.equipment_quality_fine_chance': 30,
  'dungeon.qing_feng.equipment_quality_rare_chance': 15,
  'dungeon.qing_feng.equipment_quality_epic_chance': 4,
  'dungeon.qing_feng.equipment_quality_legendary_chance': 1,
  'dungeon.qing_feng.equipment_quality_immortal_chance': 0,
};

const readRows = async (path) => parseCsv(await readFile(path, 'utf8'));

export const validateFi02Candidate = async (options = {}) => {
  const candidateRows = options.candidateRows ?? await readRows(candidatePath);
  const centralRows = options.centralRows ?? await readRows(centralPath);
  validateParameterRows(candidateRows);
  const candidate = new Map(candidateRows.map((row) => [row.parameter_id, row]));
  const centralIds = new Set(centralRows.map((row) => row.parameter_id));
  const expectedIds = Object.keys(EXPECTED);
  if (candidateRows.length !== expectedIds.length) throw new Error(`FI-02 candidate must contain exactly ${expectedIds.length} rows`);
  for (const id of expectedIds) {
    const row = candidate.get(id);
    if (!row) throw new Error(`FI-02 candidate is missing ${id}`);
    if (centralIds.has(id)) throw new Error(`FI-02 candidate overlaps authoritative CSV: ${id}`);
    if (row.status !== 'proposal_v1') throw new Error(`${id} must remain proposal_v1 until formal freeze`);
    if (!row.source.trim() || !row.reference_source.trim()) throw new Error(`${id} requires source and reference_source`);
    if (parseParameterValue(row.value, id) !== EXPECTED[id]) throw new Error(`${id} has unexpected candidate value ${row.value}`);
    if (row.unit !== 'percent' || row.value_type !== 'probability') throw new Error(`${id} must be a percentage probability`);
  }
  const qualityTotal = QUALITY_ORDER.reduce((sum, quality) => sum + EXPECTED[`dungeon.qing_feng.equipment_quality_${quality}_chance`], 0);
  if (qualityTotal !== 100) throw new Error(`FI-02 quality pool must total 100, got ${qualityTotal}`);
  const multipliers = { normal: 1, fine: 1.25, rare: 1.6, epic: 2.1, legendary: 2.8, immortal: 3.8 };
  const expectedQualityMultiplier = QUALITY_ORDER.reduce((sum, quality) => sum + (EXPECTED[`dungeon.qing_feng.equipment_quality_${quality}_chance`] / 100) * multipliers[quality], 0);
  const thirtyDayClears = Math.floor((30 * 24 * 60 * 60) / 600);
  const expectedThirtyDayDrops = thirtyDayClears * EXPECTED['dungeon.qing_feng.equipment_drop_chance'] / 100;
  return { rows: candidateRows.length, qualityTotal, expectedQualityMultiplier, thirtyDayClears, expectedThirtyDayDrops, ids: expectedIds };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateFi02Candidate();
  console.log(`fi02_candidate_validated rows=${result.rows} quality_total=${result.qualityTotal} expected_quality_multiplier=${result.expectedQualityMultiplier} thirty_day_clears=${result.thirtyDayClears} expected_equipment_drops=${result.expectedThirtyDayDrops}`);
}
