import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeReleaseContentHash } from '../../packages/config-schema/src/index.js';

export const configVersion = '2026.08.16.1';
export const configReleasesRoot = fileURLToPath(new URL('../../config/releases', import.meta.url));
export const configReleasePath = fileURLToPath(new URL(`../../config/releases/${configVersion}`, import.meta.url));

const temporaryRoots: string[] = [];

export function copyCurrentRelease(): string {
  const root = mkdtempSync(join(tmpdir(), 'dongtian-config-'));
  temporaryRoots.push(root);
  cpSync(configReleasePath, join(root, configVersion), { recursive: true });
  return root;
}

export function cleanupCopiedReleases(): void {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

export function readReleaseJson<T>(root: string, fileName: string): T {
  return JSON.parse(readFileSync(join(root, configVersion, fileName), 'utf8')) as T;
}

export function writeReleaseJson(root: string, fileName: string, value: unknown): void {
  writeFileSync(join(root, configVersion, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

export function refreshManifestHash(root: string): void {
  const manifest = readReleaseJson<Record<string, unknown>>(root, 'manifest.json');
  manifest['content_hash'] = computeReleaseContentHash(join(root, configVersion));
  writeReleaseJson(root, 'manifest.json', manifest);
}
