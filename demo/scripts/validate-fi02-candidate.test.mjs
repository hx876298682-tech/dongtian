import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFi02Candidate } from './validate-fi02-candidate.mjs';

test('FI-02 Qing Feng candidate is complete, isolated, and remains proposal-only', async () => {
  const result = await validateFi02Candidate();
  assert.equal(result.rows, 7);
  assert.equal(result.qualityTotal, 100);
  assert.equal(result.expectedQualityMultiplier, 1.227);
  assert.equal(result.thirtyDayClears, 4320);
  assert.equal(result.expectedThirtyDayDrops, 216);
});

test('FI-02 candidate validator rejects accidental overlap with the central table', async () => {
  await assert.rejects(
    validateFi02Candidate({ centralRows: [{ parameter_id: 'dungeon.qing_feng.equipment_drop_chance' }] }),
    /overlaps authoritative CSV/,
  );
});
