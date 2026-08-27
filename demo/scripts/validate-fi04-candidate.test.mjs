import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv } from './parameter-table.mjs';
import { candidatePath, validateFi04Candidate } from './validate-fi04-candidate.mjs';

test('FI-04/random-event candidate is complete, traceable, isolated, and proposal-only', async () => {
  const result = await validateFi04Candidate();
  assert.equal(result.rows, 61);
  assert.equal(result.highTierRows, 49);
  assert.equal(result.randomEventRows, 12);
  assert.equal(result.formulaRows, 2);
  assert.equal(result.proposalOnly, true);
});

test('FI-04 candidate validator rejects accidental central-table overlap', async () => {
  await assert.rejects(
    validateFi04Candidate({ centralRows: [{ parameter_id: 'dungeon.high_tier.nascent_soul.boss_attack' }] }),
    /overlaps authoritative CSV/,
  );
});

test('FI-04 candidate validator rejects a proposal row promoted without a formal release', async () => {
  const rows = parseCsv(await readFile(candidatePath, 'utf8'));
  rows.find((row) => row.parameter_id === 'dungeon.high_tier.combat_mode').status = 'frozen_v1';
  await assert.rejects(validateFi04Candidate({ candidateRows: rows }), /must remain proposal_v1/);
});

test('FI-04 candidate validator rejects malformed structured contract values', async () => {
  const rows = parseCsv(await readFile(candidatePath, 'utf8'));
  rows.find((row) => row.parameter_id === 'dungeon.high_tier.nascent_soul.skills').value = '{not-json';
  await assert.rejects(validateFi04Candidate({ candidateRows: rows }), /must contain valid JSON/);
});
