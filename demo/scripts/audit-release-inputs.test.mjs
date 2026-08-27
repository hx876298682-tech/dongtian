import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('release input audit is part of the config-tool regression suite', () => {
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types',
    resolve(import.meta.dirname, 'audit-release-inputs.mjs'),
  ], {
    cwd: resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });

  assert.match(output, /^release_inputs_audit_passed version=\S+ rows=\d+ parameter_sha256=[0-9a-f]{64} content_sha256=[0-9a-f]{64} pending_objects=\d+ high_tier_mode=\S+$/m);
});
