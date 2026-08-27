import { createHash } from 'node:crypto';

export const PARAMETER_HEADERS = [
  'parameter_id',
  'domain',
  'parameter_name',
  'value',
  'unit',
  'value_type',
  'status',
  'source',
  'reference_source',
  'formula_or_rule',
  'rounding',
  'notes',
];

export const ALLOWED_DOMAINS = new Set(['core', 'growth', 'breakthrough', 'building', 'recipe', 'economy', 'combat', 'map', 'dungeon', 'loot', 'offline', 'schedule']);
export const ALLOWED_VALUE_TYPES = new Set(['constant', 'target', 'scalar', 'cost', 'probability', 'policy', 'derived']);
export const ALLOWED_STATUSES = new Set(['confirmed', 'pending_design', 'proposal_v1', 'frozen_v1', 'derived', 'validated', 'unknown']);
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse RFC4180-style CSV without normalizing the source bytes used for hashing. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  let justClosedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          justClosedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (justClosedQuote && char !== ',' && char !== '\n' && char !== '\r') throw new Error(`unexpected character after closing quote at offset ${index}`);
    if (char === '"') {
      if (field.length !== 0 || fieldStarted) throw new Error(`invalid quote at offset ${index}`);
      quoted = true;
      fieldStarted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
      justClosedQuote = false;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      fieldStarted = false;
      justClosedQuote = false;
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
    fieldStarted = true;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (field.length > 0 || fieldStarted || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  if (rows.length === 0) throw new Error('parameter table is empty');
  const [header, ...data] = rows;
  if (header.length !== PARAMETER_HEADERS.length || header.some((value, index) => value !== PARAMETER_HEADERS[index])) {
    throw new Error(`parameter table headers must be exactly ${PARAMETER_HEADERS.join(',')}`);
  }
  for (const [index, values] of data.entries()) {
    if (values.length !== PARAMETER_HEADERS.length) throw new Error(`parameter row ${index + 2} must have ${PARAMETER_HEADERS.length} columns, got ${values.length}`);
  }
  return data.map((values, index) => Object.fromEntries(PARAMETER_HEADERS.map((key, fieldIndex) => [key, values[fieldIndex] ?? (() => { throw new Error(`parameter row ${index + 2} is missing ${key}`); })()])));
}

export function parseParameterValue(value, parameterId) {
  if (value === '') throw new Error(`parameter ${parameterId} has an empty value`);
  if (NUMBER_PATTERN.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`parameter ${parameterId} numeric value is not finite`);
    return numeric;
  }
  return value;
}

export function validateParameterRows(rows, { requireFrozen = false } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('parameter table has no data rows');
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    if (!row.parameter_id) throw new Error(`parameter row ${line} has an empty parameter_id`);
    if (ids.has(row.parameter_id)) throw new Error(`duplicate parameter_id at row ${line}: ${row.parameter_id}`);
    ids.add(row.parameter_id);
    if (!ALLOWED_DOMAINS.has(row.domain)) throw new Error(`row ${line} has unsupported domain: ${row.domain}`);
    if (!ALLOWED_VALUE_TYPES.has(row.value_type)) throw new Error(`row ${line} has unsupported value_type: ${row.value_type}`);
    if (!ALLOWED_STATUSES.has(row.status)) throw new Error(`row ${line} has unsupported status: ${row.status}`);
    if (!row.parameter_name) throw new Error(`row ${line} has an empty parameter_name`);
    if (!row.value && row.status !== 'pending_design') throw new Error(`row ${line} has an empty value for fixed status`);
    if (row.value_type === 'derived' && !['derived', 'proposal_v1', 'frozen_v1'].includes(row.status)) throw new Error(`row ${line} derived type has incompatible status`);
    if (requireFrozen && !['confirmed', 'frozen_v1'].includes(row.status)) throw new Error(`row ${line} is not frozen: ${row.parameter_id} (${row.status})`);
  }
  return rows;
}

export const sha256 = (source) => createHash('sha256').update(source).digest('hex');
