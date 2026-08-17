import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, normalize, resolve } from 'node:path';

export type AssetValidationMode = 'dev' | 'release';

export type AssetValidationIssueCode =
  | 'ASSET_MANIFEST_PARSE_ERROR'
  | 'ASSET_MANIFEST_INVALID'
  | 'ASSET_MANIFEST_VERSION_MISMATCH'
  | 'ASSET_MANIFEST_EMPTY'
  | 'ASSET_MANIFEST_DUPLICATE_ID'
  | 'ASSET_MANIFEST_DUPLICATE_PATH'
  | 'ASSET_INVALID_CONTENT_ID'
  | 'ASSET_INVALID_KEY'
  | 'ASSET_INVALID_SCOPE'
  | 'ASSET_INVALID_KIND'
  | 'ASSET_INVALID_RESOURCE'
  | 'ASSET_INVALID_PATH'
  | 'ASSET_INVALID_FILE_NAME'
  | 'ASSET_INVALID_EXTENSION'
  | 'ASSET_INVALID_METADATA'
  | 'ASSET_INVALID_COPYRIGHT'
  | 'ASSET_MISSING_LOCALIZATION'
  | 'ASSET_PLACEHOLDER'
  | 'ASSET_PLACEHOLDER_BLOCKS_RELEASE'
  | 'ASSET_MISSING_FILE';

export type AssetValidationIssue = Readonly<{
  code: AssetValidationIssueCode;
  severity: 'error' | 'warning';
  message: string;
  entry_id?: string;
  resource_path?: string;
}>;

export type AssetValidationReport = Readonly<{
  ok: boolean;
  degraded: boolean;
  mode: AssetValidationMode;
  manifest_version: string;
  config_version: string;
  locale: string;
  localization_path: string;
  entry_count: number;
  placeholder_entry_ids: readonly string[];
  release_blocker_entry_ids: readonly string[];
  error_count: number;
  warning_count: number;
  errors: readonly AssetValidationIssue[];
  warnings: readonly AssetValidationIssue[];
}>;

export type ValidateAssetManifestOptions = Readonly<{
  assetsRoot: string;
  mode: AssetValidationMode;
  manifestPath?: string;
}>;

type AssetKind = 'region_background' | 'equipment_icon' | 'material_icon' | 'status_icon' | 'base_audio';
type MediaType = 'image' | 'audio';
type AssetScope = 'P0' | 'ANCHOR';

type AssetResource = Readonly<{
  relative_path: string;
  file_name: string;
  media_type: MediaType;
  format: 'svg' | 'png' | 'webp' | 'wav' | 'ogg' | 'mp3';
  width?: number;
  height?: number;
  duration_ms?: number;
  placeholder: boolean;
  placeholder_reason: string;
  copyright_source: string;
}>;

type AssetEntry = Readonly<{
  content_id: string;
  kind: AssetKind;
  scope: AssetScope;
  name_key: string;
  description_key: string;
  resource: AssetResource;
}>;

type AssetManifest = Readonly<{
  manifest_version: string;
  config_version: string;
  locale: string;
  localization_path: string;
  entries: readonly AssetEntry[];
}>;

type ValidationState = Readonly<{
  errors: AssetValidationIssue[];
  warnings: AssetValidationIssue[];
  placeholderEntryIds: string[];
  releaseBlockerEntryIds: string[];
}>;

const MANIFEST_VERSION_PATTERN = /^\d{4}\.\d{2}\.\d+\.\d+$/;
const STABLE_ID_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/;
const LOCALE_PATTERN = /^[a-z]{2}-[A-Z]{2}$/;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9_.\-\/]+$/;
const SAFE_FILE_NAME_PATTERN = /^[a-z0-9_]+(?:_[a-z0-9]+)*\.(svg|png|webp|wav|ogg|mp3)$/;
const ALLOWED_IMAGE_FORMATS = new Set<string>(['svg', 'png', 'webp']);
const ALLOWED_AUDIO_FORMATS = new Set<string>(['wav', 'ogg', 'mp3']);
const KIND_TO_PREFIX: Record<AssetKind, string> = {
  region_background: 'p0/regions/',
  equipment_icon: 'p0/items/',
  material_icon: 'p0/items/',
  status_icon: 'p0/status/',
  base_audio: 'p0/audio/',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  severity: 'error' | 'warning',
  code: AssetValidationIssueCode,
  message: string,
  entryId?: string,
  resourcePath?: string,
): AssetValidationIssue {
  return {
    code,
    severity,
    message,
    ...(entryId !== undefined ? { entry_id: entryId } : {}),
    ...(resourcePath !== undefined ? { resource_path: resourcePath } : {}),
  };
}

function pushError(state: ValidationState, code: AssetValidationIssueCode, message: string, entryId?: string, resourcePath?: string): void {
  state.errors.push(issue('error', code, message, entryId, resourcePath));
}

function pushWarning(
  state: ValidationState,
  code: AssetValidationIssueCode,
  message: string,
  entryId?: string,
  resourcePath?: string,
): void {
  state.warnings.push(issue('warning', code, message, entryId, resourcePath));
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function readStringField(
  object: Record<string, unknown>,
  field: string,
  state: ValidationState,
  code: AssetValidationIssueCode,
  entryId?: string,
): string | null {
  const value = object[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    pushError(state, code, `Missing or empty ${field}.`, entryId);
    return null;
  }
  return value;
}

function readOptionalStringField(object: Record<string, unknown>, field: string): string | null {
  const value = object[field];
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'string' ? value : null;
}

function readBooleanField(
  object: Record<string, unknown>,
  field: string,
  state: ValidationState,
  code: AssetValidationIssueCode,
  entryId?: string,
): boolean | null {
  const value = object[field];
  if (typeof value !== 'boolean') {
    pushError(state, code, `Missing or invalid ${field}.`, entryId);
    return null;
  }
  return value;
}

function readPositiveIntegerField(
  object: Record<string, unknown>,
  field: string,
  state: ValidationState,
  code: AssetValidationIssueCode,
  entryId?: string,
): number | null {
  const value = object[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    pushError(state, code, `Missing or invalid ${field}.`, entryId);
    return null;
  }
  return value;
}

function validateLocaleKey(key: string): boolean {
  return STABLE_ID_PATTERN.test(key);
}

function validatePathSafety(relativePath: string): boolean {
  if (!SAFE_PATH_PATTERN.test(relativePath)) {
    return false;
  }
  if (relativePath.startsWith('/') || relativePath.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    return false;
  }
  const normalized = normalize(relativePath).replaceAll('\\', '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('\\')) {
    return false;
  }
  return normalized === relativePath;
}

function validateResource(
  entry: AssetEntry,
  assetsRoot: string,
  mode: AssetValidationMode,
  state: ValidationState,
): void {
  const resource = entry.resource;
  const relativePath = resource.relative_path;
  const expectedPrefix = KIND_TO_PREFIX[entry.kind];
  const resolvedPath = resolve(assetsRoot, relativePath);
  const fileName = basename(relativePath);
  const extension = extname(fileName).slice(1);

  if (!validatePathSafety(relativePath)) {
    pushError(state, 'ASSET_INVALID_PATH', `Unsafe resource path "${relativePath}".`, entry.content_id, relativePath);
  }
  if (!relativePath.startsWith(expectedPrefix)) {
    pushError(
      state,
      'ASSET_INVALID_PATH',
      `Resource path "${relativePath}" does not match ${entry.kind} prefix "${expectedPrefix}".`,
      entry.content_id,
      relativePath,
    );
  }
  if (resource.file_name !== fileName) {
    pushError(
      state,
      'ASSET_INVALID_FILE_NAME',
      `File name "${resource.file_name}" does not match path basename "${fileName}".`,
      entry.content_id,
      relativePath,
    );
  }
  if (!SAFE_FILE_NAME_PATTERN.test(resource.file_name)) {
    pushError(
      state,
      'ASSET_INVALID_FILE_NAME',
      `Invalid file name "${resource.file_name}".`,
      entry.content_id,
      relativePath,
    );
  }
  if (resource.file_name.endsWith('.')) {
    pushError(state, 'ASSET_INVALID_FILE_NAME', `File name "${resource.file_name}" must include an extension.`, entry.content_id, relativePath);
  }
  if (resource.format !== extension) {
    pushError(
      state,
      'ASSET_INVALID_EXTENSION',
      `Declared format "${resource.format}" does not match file extension ".${extension}".`,
      entry.content_id,
      relativePath,
    );
  }
  if (resource.media_type === 'image' && !ALLOWED_IMAGE_FORMATS.has(resource.format)) {
    pushError(
      state,
      'ASSET_INVALID_EXTENSION',
      `Image resource "${relativePath}" must use svg, png, or webp.`,
      entry.content_id,
      relativePath,
    );
  }
  if (resource.media_type === 'audio' && !ALLOWED_AUDIO_FORMATS.has(resource.format)) {
    pushError(
      state,
      'ASSET_INVALID_EXTENSION',
      `Audio resource "${relativePath}" must use wav, ogg, or mp3.`,
      entry.content_id,
      relativePath,
    );
  }
  if (entry.kind === 'base_audio' && resource.media_type !== 'audio') {
    pushError(
      state,
      'ASSET_INVALID_RESOURCE',
      `Audio entry "${entry.content_id}" must declare media_type="audio".`,
      entry.content_id,
      relativePath,
    );
  }
  if (entry.kind !== 'base_audio' && resource.media_type !== 'image') {
    pushError(
      state,
      'ASSET_INVALID_RESOURCE',
      `Visual entry "${entry.content_id}" must declare media_type="image".`,
      entry.content_id,
      relativePath,
    );
  }
  if (resource.media_type === 'image') {
    if (typeof resource.width !== 'number' || !Number.isInteger(resource.width) || resource.width <= 0) {
      pushError(state, 'ASSET_INVALID_METADATA', `Image resource "${relativePath}" needs a positive width.`, entry.content_id, relativePath);
    }
    if (typeof resource.height !== 'number' || !Number.isInteger(resource.height) || resource.height <= 0) {
      pushError(state, 'ASSET_INVALID_METADATA', `Image resource "${relativePath}" needs a positive height.`, entry.content_id, relativePath);
    }
  } else if (typeof resource.duration_ms !== 'number' || !Number.isInteger(resource.duration_ms) || resource.duration_ms <= 0) {
    pushError(state, 'ASSET_INVALID_METADATA', `Audio resource "${relativePath}" needs a positive duration_ms.`, entry.content_id, relativePath);
  }
  if (resource.copyright_source.trim().length === 0) {
    pushError(state, 'ASSET_INVALID_COPYRIGHT', `Resource "${relativePath}" needs a copyright source.`, entry.content_id, relativePath);
  }
  if (resource.placeholder) {
    state.placeholderEntryIds.push(entry.content_id);
    if (mode === 'release') {
      state.releaseBlockerEntryIds.push(entry.content_id);
      pushError(
        state,
        'ASSET_PLACEHOLDER_BLOCKS_RELEASE',
        `Placeholder asset "${entry.content_id}" blocks release.`,
        entry.content_id,
        relativePath,
      );
      return;
    } else {
      pushWarning(
        state,
        'ASSET_PLACEHOLDER',
        `Placeholder asset "${entry.content_id}" is allowed in dev mode but will block release.`,
        entry.content_id,
        relativePath,
      );
    }
  }

  if (existsSync(resolvedPath)) {
    return;
  }

  if (resource.placeholder) {
    const severity = mode === 'release' ? 'error' : 'warning';
    if (mode === 'release') {
      state.releaseBlockerEntryIds.push(entry.content_id);
    }
    const reporter = severity === 'error' ? pushError : pushWarning;
    reporter(
      state,
      'ASSET_MISSING_FILE',
      `Resource file "${relativePath}" does not exist yet.`,
      entry.content_id,
      relativePath,
    );
    return;
  }

  state.releaseBlockerEntryIds.push(entry.content_id);
  pushError(state, 'ASSET_MISSING_FILE', `Resource file "${relativePath}" does not exist.`, entry.content_id, relativePath);
}

function validateEntry(
  rawEntry: unknown,
  index: number,
  assetsRoot: string,
  mode: AssetValidationMode,
  state: ValidationState,
  entryIds: Set<string>,
  resourcePaths: Set<string>,
): AssetEntry | null {
  if (!isRecord(rawEntry)) {
    pushError(state, 'ASSET_MANIFEST_INVALID', `Entry ${index} is not an object.`);
    return null;
  }

  const contentId = readStringField(rawEntry, 'content_id', state, 'ASSET_INVALID_CONTENT_ID');
  const kind = readStringField(rawEntry, 'kind', state, 'ASSET_INVALID_KIND', contentId ?? undefined);
  const scope = readStringField(rawEntry, 'scope', state, 'ASSET_INVALID_SCOPE', contentId ?? undefined);
  const nameKey = readStringField(rawEntry, 'name_key', state, 'ASSET_INVALID_KEY', contentId ?? undefined);
  const descriptionKey = readStringField(rawEntry, 'description_key', state, 'ASSET_INVALID_KEY', contentId ?? undefined);
  const resourceRaw = rawEntry['resource'];

  if (contentId === null || kind === null || scope === null || nameKey === null || descriptionKey === null) {
    return null;
  }

  if (!STABLE_ID_PATTERN.test(contentId)) {
    pushError(state, 'ASSET_INVALID_CONTENT_ID', `Invalid content_id "${contentId}".`, contentId);
  }
  if (!validateLocaleKey(nameKey)) {
    pushError(state, 'ASSET_INVALID_KEY', `Invalid name_key "${nameKey}".`, contentId);
  }
  if (!validateLocaleKey(descriptionKey)) {
    pushError(state, 'ASSET_INVALID_KEY', `Invalid description_key "${descriptionKey}".`, contentId);
  }
  if (scope !== 'P0' && scope !== 'ANCHOR') {
    pushError(state, 'ASSET_INVALID_SCOPE', `Unsupported scope "${scope}".`, contentId);
  }
  if (kind !== 'region_background' && kind !== 'equipment_icon' && kind !== 'material_icon' && kind !== 'status_icon' && kind !== 'base_audio') {
    pushError(state, 'ASSET_INVALID_KIND', `Unsupported kind "${kind}".`, contentId);
  }
  if (!isRecord(resourceRaw)) {
    pushError(state, 'ASSET_INVALID_RESOURCE', `Missing resource block for "${contentId}".`, contentId);
    return null;
  }

  const resourceRelativePath = readStringField(resourceRaw, 'relative_path', state, 'ASSET_INVALID_PATH', contentId);
  const resourceFileName = readStringField(resourceRaw, 'file_name', state, 'ASSET_INVALID_FILE_NAME', contentId);
  const mediaType = readStringField(resourceRaw, 'media_type', state, 'ASSET_INVALID_RESOURCE', contentId);
  const format = readStringField(resourceRaw, 'format', state, 'ASSET_INVALID_EXTENSION', contentId);
  const placeholder = readBooleanField(resourceRaw, 'placeholder', state, 'ASSET_INVALID_METADATA', contentId);
  const placeholderReason = readOptionalStringField(resourceRaw, 'placeholder_reason');
  const copyrightSource = readStringField(resourceRaw, 'copyright_source', state, 'ASSET_INVALID_COPYRIGHT', contentId);

  if (
    resourceRelativePath === null
    || resourceFileName === null
    || mediaType === null
    || format === null
    || placeholder === null
    || copyrightSource === null
  ) {
    return null;
  }

  const isImage = mediaType === 'image';
  const width = isImage ? readPositiveIntegerField(resourceRaw, 'width', state, 'ASSET_INVALID_METADATA', contentId) : null;
  const height = isImage ? readPositiveIntegerField(resourceRaw, 'height', state, 'ASSET_INVALID_METADATA', contentId) : null;
  const durationMs = mediaType === 'audio' ? readPositiveIntegerField(resourceRaw, 'duration_ms', state, 'ASSET_INVALID_METADATA', contentId) : null;
  const resource: AssetResource = {
    relative_path: resourceRelativePath,
    file_name: resourceFileName,
    media_type: mediaType as MediaType,
    format: format as AssetResource['format'],
    placeholder,
    placeholder_reason: placeholderReason ?? '',
    copyright_source: copyrightSource,
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height } : {}),
    ...(durationMs !== null ? { duration_ms: durationMs } : {}),
  };

  if (resource.placeholder && resource.placeholder_reason.trim().length === 0) {
    pushError(state, 'ASSET_INVALID_METADATA', `Placeholder asset "${contentId}" needs placeholder_reason.`, contentId, resource.relative_path);
  }

  const entry: AssetEntry = {
    content_id: contentId,
    kind: kind as AssetKind,
    scope: scope as AssetScope,
    name_key: nameKey,
    description_key: descriptionKey,
    resource,
  };

  if (entryIds.has(entry.content_id)) {
    pushError(state, 'ASSET_MANIFEST_DUPLICATE_ID', `Duplicate content_id "${entry.content_id}".`, entry.content_id);
  } else {
    entryIds.add(entry.content_id);
  }
  if (resourcePaths.has(resource.relative_path)) {
    pushError(state, 'ASSET_MANIFEST_DUPLICATE_PATH', `Duplicate resource path "${resource.relative_path}".`, entry.content_id, resource.relative_path);
  } else {
    resourcePaths.add(resource.relative_path);
  }

  validateResource(entry, assetsRoot, mode, state);
  return entry;
}

function loadLocalizationKeys(localizationPath: string): ReadonlySet<string> | null {
  try {
    const raw = readJson(localizationPath);
    if (!isRecord(raw)) {
      return null;
    }
    return new Set(Object.keys(raw));
  } catch {
    return null;
  }
}

function parseManifest(manifestPath: string): { manifest: AssetManifest | null; parseError?: string } {
  try {
    const raw = readJson(manifestPath);
    if (!isRecord(raw)) {
      return { manifest: null, parseError: 'Manifest root is not an object.' };
    }

    const manifestVersion = readStringField(raw, 'manifest_version', { errors: [], warnings: [], placeholderEntryIds: [], releaseBlockerEntryIds: [] }, 'ASSET_MANIFEST_INVALID');
    const configVersion = readStringField(raw, 'config_version', { errors: [], warnings: [], placeholderEntryIds: [], releaseBlockerEntryIds: [] }, 'ASSET_MANIFEST_INVALID');
    const locale = readStringField(raw, 'locale', { errors: [], warnings: [], placeholderEntryIds: [], releaseBlockerEntryIds: [] }, 'ASSET_MANIFEST_INVALID');
    const localizationPath = readStringField(raw, 'localization_path', { errors: [], warnings: [], placeholderEntryIds: [], releaseBlockerEntryIds: [] }, 'ASSET_MANIFEST_INVALID');
    const entries = raw['entries'];

    if (
      manifestVersion === null
      || configVersion === null
      || locale === null
      || localizationPath === null
      || !Array.isArray(entries)
    ) {
      return { manifest: null, parseError: 'Manifest missing required fields.' };
    }

    return {
      manifest: {
        manifest_version: manifestVersion,
        config_version: configVersion,
        locale,
        localization_path: localizationPath,
        entries: entries as readonly AssetEntry[],
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown manifest parse error.';
    return { manifest: null, parseError: message };
  }
}

export function validateAssetManifest(options: ValidateAssetManifestOptions): AssetValidationReport {
  const manifestPath = options.manifestPath ?? resolve(options.assetsRoot, 'manifest.json');
  const state: ValidationState = {
    errors: [],
    warnings: [],
    placeholderEntryIds: [],
    releaseBlockerEntryIds: [],
  };

  const { manifest, parseError } = parseManifest(manifestPath);
  if (parseError !== undefined || manifest === null) {
    pushError(state, 'ASSET_MANIFEST_PARSE_ERROR', parseError ?? 'Unable to read manifest.', undefined, manifestPath);
    return {
      ok: false,
      degraded: false,
      mode: options.mode,
      manifest_version: 'unknown',
      config_version: 'unknown',
      locale: 'unknown',
      localization_path: 'unknown',
      entry_count: 0,
      placeholder_entry_ids: [],
      release_blocker_entry_ids: [],
      error_count: state.errors.length,
      warning_count: state.warnings.length,
      errors: state.errors,
      warnings: state.warnings,
    };
  }

  if (manifest.entries.length === 0) {
    pushError(state, 'ASSET_MANIFEST_EMPTY', 'Manifest has no asset entries.');
  }
  if (!MANIFEST_VERSION_PATTERN.test(manifest.manifest_version)) {
    pushError(state, 'ASSET_MANIFEST_INVALID', `Invalid manifest_version "${manifest.manifest_version}".`);
  }
  if (!MANIFEST_VERSION_PATTERN.test(manifest.config_version)) {
    pushError(state, 'ASSET_MANIFEST_INVALID', `Invalid config_version "${manifest.config_version}".`);
  }
  if (manifest.manifest_version !== manifest.config_version) {
    pushError(
      state,
      'ASSET_MANIFEST_VERSION_MISMATCH',
      `Manifest version "${manifest.manifest_version}" does not match config version "${manifest.config_version}".`,
    );
  }
  if (!LOCALE_PATTERN.test(manifest.locale)) {
    pushError(state, 'ASSET_MANIFEST_INVALID', `Invalid locale "${manifest.locale}".`);
  }
  if (!validatePathSafety(manifest.localization_path) || !manifest.localization_path.endsWith('.json')) {
    pushError(state, 'ASSET_INVALID_PATH', `Unsafe localization path "${manifest.localization_path}".`, undefined, manifest.localization_path);
  }

  const entryIds = new Set<string>();
  const resourcePaths = new Set<string>();
  for (const [index, rawEntry] of manifest.entries.entries()) {
    validateEntry(rawEntry, index, options.assetsRoot, options.mode, state, entryIds, resourcePaths);
  }

  const localizationFullPath = resolve(options.assetsRoot, manifest.localization_path);
  const localizationKeys = loadLocalizationKeys(localizationFullPath);
  if (localizationKeys === null) {
    pushError(state, 'ASSET_MISSING_LOCALIZATION', `Unable to read localization file "${manifest.localization_path}".`, undefined, manifest.localization_path);
  } else {
    for (const entry of manifest.entries) {
      if (!localizationKeys.has(entry.name_key)) {
        pushError(
          state,
          'ASSET_MISSING_LOCALIZATION',
          `Missing localization key "${entry.name_key}" for "${entry.content_id}".`,
          entry.content_id,
        );
      }
      if (!localizationKeys.has(entry.description_key)) {
        pushError(
          state,
          'ASSET_MISSING_LOCALIZATION',
          `Missing localization key "${entry.description_key}" for "${entry.content_id}".`,
          entry.content_id,
        );
      }
    }
  }

  return {
    ok: state.errors.length === 0,
    degraded: state.warnings.length > 0,
    mode: options.mode,
    manifest_version: manifest.manifest_version,
    config_version: manifest.config_version,
    locale: manifest.locale,
    localization_path: manifest.localization_path,
    entry_count: manifest.entries.length,
    placeholder_entry_ids: state.placeholderEntryIds,
    release_blocker_entry_ids: state.releaseBlockerEntryIds,
    error_count: state.errors.length,
    warning_count: state.warnings.length,
    errors: state.errors,
    warnings: state.warnings,
  };
}
