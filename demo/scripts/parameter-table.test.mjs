import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsv, parseParameterValue, validateParameterRows } from './parameter-table.mjs';

const header = 'parameter_id,domain,parameter_name,value,unit,value_type,status,source,reference_source,formula_or_rule,rounding,notes';

test('strict parameter parser rejects malformed headers, rows and quotes', () => {
  assert.throws(() => parseCsv('bad,header\n1,2\n'), /headers/);
  assert.throws(() => parseCsv(`${header}\na,b,c,1,u,scalar,frozen_v1,s,,,\n`), /columns/);
  assert.throws(() => parseCsv(`${header}\n"x"oops,core,name,1,u,scalar,frozen_v1,s,,,,\n`), /closing quote/);
});

test('strict parameter parser preserves empty values as an error for generated frozen output', () => {
  assert.throws(() => parseParameterValue('', 'test.parameter'), /empty/);
  assert.equal(parseParameterValue('1e3', 'test.parameter'), 1000);
  assert.throws(() => validateParameterRows([{
    parameter_id: 'test.parameter', domain: 'core', parameter_name: 'test', value: '1', unit: 'u', value_type: 'scalar', status: 'proposal_v1', source: '', reference_source: '', formula_or_rule: '', rounding: '', notes: '',
  }], { requireFrozen: true }), /not frozen/);
});

