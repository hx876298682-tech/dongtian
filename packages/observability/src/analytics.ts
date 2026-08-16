export const SERVER_ANALYTICS_EVENT_TYPES = [
  'session_started',
  'session_ended',
  'dashboard_viewed',
  'offline_settlement_completed',
  'offline_summary_viewed',
  'queue_editor_opened',
  'queue_previewed',
  'queue_saved',
  'queue_save_failed',
  'queue_action_transitioned',
  'queue_blocked',
  'fallback_started',
  'skill_level_up',
  'recipe_first_completed',
  'tool_equipped',
  'equipment_temper_attempted',
  'buff_used',
  'cave_build_started',
  'cave_build_completed',
  'dungeon_previewed',
  'dungeon_entered',
  'dungeon_choice_presented',
  'dungeon_choice_made',
  'dungeon_run_finalized',
  'dungeon_result_action',
  'equipment_compared',
  'item_usage_viewed',
  'equipment_equipped_from_result',
  'breakthrough_goal_viewed',
  'breakthrough_source_clicked',
  'breakthrough_started',
  'breakthrough_completed',
] as const;

export const CLIENT_EXPOSURE_EVENT_TYPES = [
  'dashboard_viewed',
  'offline_summary_viewed',
  'queue_editor_opened',
  'queue_previewed',
  'queue_blocked',
  'dungeon_previewed',
  'dungeon_choice_presented',
  'dungeon_result_action',
  'equipment_compared',
  'item_usage_viewed',
  'breakthrough_goal_viewed',
  'breakthrough_source_clicked',
] as const;

export const ANALYTICS_SENSITIVE_FIELD_BLACKLIST = [
  'password',
  'password_hash',
  'session_token',
  'session_token_hash',
  'csrf_token',
  'csrf_token_hash',
  'authorization',
  'cookie',
  'token',
  'access_token',
  'refresh_token',
  'email',
  'email_normalized',
  'ip',
  'ip_address',
  'client_ip',
  'remote_ip',
] as const;

export type AnalyticsJsonPrimitive = string | number | boolean | null;
export type AnalyticsJsonValue =
  | AnalyticsJsonPrimitive
  | readonly AnalyticsJsonValue[]
  | { readonly [key: string]: AnalyticsJsonValue };

export type ServerAnalyticsEventType = (typeof SERVER_ANALYTICS_EVENT_TYPES)[number];
export type ClientExposureEventType = (typeof CLIENT_EXPOSURE_EVENT_TYPES)[number];

export type ServerAnalyticsEvent = Readonly<{
  readonly event_id: string;
  readonly event_type: ServerAnalyticsEventType;
  readonly occurred_at: string;
  readonly transaction_id: string;
  readonly character_id: string;
  readonly config_version: string;
  readonly formula_version: number;
  readonly idempotency_key: string;
  readonly dedupe_key: string;
  readonly payload: AnalyticsJsonValue;
}>;

export type ClientExposureEvent = Readonly<{
  readonly event_id: string;
  readonly event_type: ClientExposureEventType;
  readonly occurred_at: string;
  readonly session_id: string;
  readonly character_id: string;
  readonly config_version: string;
  readonly formula_version: number;
  readonly dedupe_key: string;
  readonly payload: AnalyticsJsonValue;
  readonly transaction_id?: string;
  readonly idempotency_key?: string;
}>;

export type AnalyticsEvent = ServerAnalyticsEvent | ClientExposureEvent;

type AnalyticsRecord = Record<string, unknown>;

const SENSITIVE_PATHS = new Set(ANALYTICS_SENSITIVE_FIELD_BLACKLIST.map((field) => field.toLowerCase()));

function isRecord(value: unknown): value is AnalyticsRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`ANALYTICS_VALIDATION_FAILED:${field}`);
  }
  return value;
}

function assertEventType<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`ANALYTICS_VALIDATION_FAILED:${field}`);
  }
  return value as T;
}

function assertPositiveInteger(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`ANALYTICS_VALIDATION_FAILED:${field}`);
}

function assertIsoTimestamp(value: unknown, field: string): string {
  const text = assertNonEmptyString(value, field);
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    throw new Error(`ANALYTICS_VALIDATION_FAILED:${field}`);
  }
  return new Date(parsed).toISOString();
}

function assertJsonValue(value: unknown, path: readonly string[] = []): asserts value is AnalyticsJsonValue {
  if (value === null) {
    return;
  }
  const kind = typeof value;
  if (kind === 'string') {
    return;
  }
  if (kind === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`ANALYTICS_VALIDATION_FAILED:${path.join('.') || 'payload'}`);
    }
    return;
  }
  if (kind === 'boolean') {
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertJsonValue(value[index], [...path, String(index)]);
    }
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`ANALYTICS_VALIDATION_FAILED:${path.join('.') || 'payload'}`);
  }
  for (const [key, entry] of Object.entries(value)) {
    assertJsonValue(entry, [...path, key]);
  }
}

function assertNoSensitiveFields(value: unknown, path: readonly string[] = []): void {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'string') {
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertNoSensitiveFields(value[index], [...path, String(index)]);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const nextPath = [...path, key];
    if (SENSITIVE_PATHS.has(normalizedKey)) {
      throw new Error(`ANALYTICS_VALIDATION_FAILED:${nextPath.join('.')}`);
    }
    assertNoSensitiveFields(entry, nextPath);
  }
}

function validatePayload(input: unknown): AnalyticsJsonValue {
  assertJsonValue(input);
  assertNoSensitiveFields(input);
  return input;
}

function validateBaseEvent(input: unknown): AnalyticsRecord {
  if (!isRecord(input)) {
    throw new Error('ANALYTICS_VALIDATION_FAILED:body');
  }
  assertNoSensitiveFields(input);
  return input;
}

export function isServerAnalyticsEventType(value: string): value is ServerAnalyticsEventType {
  return (SERVER_ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

export function isClientExposureEventType(value: string): value is ClientExposureEventType {
  return (CLIENT_EXPOSURE_EVENT_TYPES as readonly string[]).includes(value);
}

export function parseServerAnalyticsEvent(input: unknown): ServerAnalyticsEvent {
  const record = validateBaseEvent(input);
  const eventType = assertEventType(assertNonEmptyString(record['event_type'], 'event_type'), SERVER_ANALYTICS_EVENT_TYPES, 'event_type');
  return {
    event_id: assertNonEmptyString(record['event_id'], 'event_id'),
    event_type: eventType,
    occurred_at: assertIsoTimestamp(record['occurred_at'], 'occurred_at'),
    transaction_id: assertNonEmptyString(record['transaction_id'], 'transaction_id'),
    character_id: assertNonEmptyString(record['character_id'], 'character_id'),
    config_version: assertNonEmptyString(record['config_version'], 'config_version'),
    formula_version: assertPositiveInteger(record['formula_version'], 'formula_version'),
    idempotency_key: assertNonEmptyString(record['idempotency_key'], 'idempotency_key'),
    dedupe_key: assertNonEmptyString(record['dedupe_key'], 'dedupe_key'),
    payload: validatePayload(record['payload']),
  };
}

export function parseClientExposureEvent(input: unknown): ClientExposureEvent {
  const record = validateBaseEvent(input);
  const eventType = assertEventType(assertNonEmptyString(record['event_type'], 'event_type'), CLIENT_EXPOSURE_EVENT_TYPES, 'event_type');
  const transactionId = record['transaction_id'];
  const idempotencyKey = record['idempotency_key'];
  const exposure: ClientExposureEvent = {
    event_id: assertNonEmptyString(record['event_id'], 'event_id'),
    event_type: eventType,
    occurred_at: assertIsoTimestamp(record['occurred_at'], 'occurred_at'),
    session_id: assertNonEmptyString(record['session_id'], 'session_id'),
    character_id: assertNonEmptyString(record['character_id'], 'character_id'),
    config_version: assertNonEmptyString(record['config_version'], 'config_version'),
    formula_version: assertPositiveInteger(record['formula_version'], 'formula_version'),
    dedupe_key: assertNonEmptyString(record['dedupe_key'], 'dedupe_key'),
    payload: validatePayload(record['payload']),
  };
  return {
    ...exposure,
    ...(typeof transactionId === 'string' && transactionId.trim().length > 0 ? { transaction_id: transactionId } : {}),
    ...(typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0 ? { idempotency_key: idempotencyKey } : {}),
  };
}

export function parseAnalyticsEvent(input: unknown): AnalyticsEvent {
  const record = validateBaseEvent(input);
  const eventType = assertNonEmptyString(record['event_type'], 'event_type');
  if (isServerAnalyticsEventType(eventType)) {
    return parseServerAnalyticsEvent(input);
  }
  if (isClientExposureEventType(eventType)) {
    return parseClientExposureEvent(input);
  }
  throw new Error('ANALYTICS_VALIDATION_FAILED:event_type');
}
