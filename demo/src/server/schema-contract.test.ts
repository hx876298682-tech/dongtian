import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeInitialPlayer } from './repository.ts';
import type { ResourceId } from './types.ts';
import { FROZEN_PARAMETERS } from '../game/frozen-parameters.ts';
import { validateHighTierCombatContract } from './high-tier-contract.ts';
import { migrationFiles } from './migrations.ts';

const resourceIds = [
  'spirit_stone', 'spirit_herb', 'spirit_ore', 'spirit_wood', 'pill',
  'ancient_scroll', 'millennium_herb', 'meteor_iron', 'demon_core',
  'herb_zi_yun_hua', 'herb_ning_lu_cao', 'herb_jin_huan_she_xin', 'herb_chi_yan_zhi',
  'pill_zi_yun', 'pill_ning_lu', 'pill_huang_long', 'pill_chi_yan',
] as const satisfies readonly ResourceId[];

const schema = await readFile(new URL('./migrations/V1_001_core.sql', import.meta.url), 'utf8');
const observabilitySchema = await readFile(new URL('./migrations/V1_003_observability.sql', import.meta.url), 'utf8');
const databaseContract = await readFile(new URL('../../../docs/洞天_Web版API与数据库详细契约V1.0.md', import.meta.url), 'utf8');
const httpAdapter = await readFile(new URL('./http.ts', import.meta.url), 'utf8');

const documentedImplementedRoutes = [
  '/healthz', '/readyz', '/metrics', '/v1/bootstrap', '/v1/action-catalog', '/v1/actions/start', '/v1/actions/stop', '/v1/actions/switch',
  '/v1/settlements/offline', '/v1/buildings/spirit_farm/plant', '/v1/buildings/spirit_farm/plots/{plotId}/plant', '/v1/buildings/{buildingId}/jobs', '/v1/buildings/{buildingId}/upgrade',
  '/v1/progression/breakthrough', '/v1/combat/preview', '/v1/combat/start', '/v1/equipment/{instanceId}/actions',
  '/v1/dungeons/{dungeonId}/preview', '/v1/dungeons/start', '/v1/dungeons/settle', '/v1/high-tier/{realm}/preview',
  '/v1/high-tier/start', '/v1/high-tier/settle', '/v1/collection/actions', '/v1/collection/events',
  '/v1/collection/exchanges',
  '/v1/equipment/auto-promotion/policy', '/v1/equipment/auto-promotion/cycles',
  '/v1/replays/{settlementId}', '/v1/leaderboards/{type}', '/v1/economy/long-term',
  '/v1/economy/long-term/equipment-consumption', '/v1/economy/long-term/confidence', '/v1/admin/config/refresh',
  '/v1/admin/config/canary', '/v1/admin/config/activate', '/v1/admin/config/rollback',
] as const;

test('observability migration persists idempotent cross-instance metrics events', () => {
  assert.deepEqual(migrationFiles, ['V1_001_core.sql', 'V1_002_config_release.sql', 'V1_003_observability.sql']);
  assert.match(databaseContract, /迁移按 `V1_001`、`V1_002`、`V1_003` 顺序执行/);
  assert.match(observabilitySchema, /create table if not exists metrics_event/);
  assert.match(observabilitySchema, /event_id uuid primary key/);
  assert.match(observabilitySchema, /instance_id text not null/);
  assert.match(observabilitySchema, /metrics_event_at_idx/);
});

test('API contract documents every implemented HTTP route family', () => {
  const normalizedContract = databaseContract.replaceAll(/[{}]/g, '');
  for (const route of documentedImplementedRoutes) {
    const routePattern = route.replaceAll(/[{}]/g, '');
    assert.match(normalizedContract, new RegExp(routePattern.replaceAll('/', '\\/')));
  }
  assert.match(httpAdapter, /pathname === '\/v1\/actions\/stop'/);
  assert.match(httpAdapter, /pathname === '\/v1\/actions\/switch'/);
  assert.match(httpAdapter, /pathname === '\/v1\/action-catalog'/);
  assert.match(httpAdapter, /pathname === '\/v1\/admin\/config\/refresh'/);
});

test('frozen parameter schema keeps high-tier combat explicitly signature-only until full contract is supplied', () => {
  const contract = validateHighTierCombatContract(FROZEN_PARAMETERS);
  assert.equal(contract.mode, 'signature_only_v1');
  assert.deepEqual(contract.realms, {});
});

test('PostgreSQL migration keeps runtime resource IDs and UUID boundaries aligned', () => {
  const enumBody = schema.match(/create type dongtian_resource_id as enum \(([^]*?)\);/i)?.[1] ?? '';
  const schemaResourceIds = [...enumBody.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(schemaResourceIds, [...resourceIds].sort());
  assert.match(schema, /player_id uuid primary key/);
  assert.match(schema, /resource_id dongtian_resource_id not null/);
  assert.match(schema, /amount numeric not null check \(amount >= 0\)/);
  assert.match(schema, /capacity numeric not null check \(capacity >= 0\)/);
  assert.match(schema, /reserved_amount numeric not null default 0 check \(reserved_amount >= 0\)/);
  assert.match(schema, /overflow_amount numeric not null default 0 check \(overflow_amount >= 0\)/);
  assert.match(schema, /state_revision bigint not null default 0 check \(state_revision >= 0\)/);
  assert.match(schema, /alter table inventory_resource alter column amount type numeric using amount::numeric/);
  assert.match(schema, /alter table inventory_resource alter column capacity type numeric using capacity::numeric/);
  assert.match(schema, /alter table inventory_resource alter column reserved_amount type numeric using reserved_amount::numeric/);
  assert.match(schema, /inventory_resource_amount_reserved_capacity/);
  assert.match(schema, /check \(amount \+ reserved_amount <= capacity\)/);
  assert.match(schema, /equipment_count bigint not null default 0 check \(equipment_count >= 0\)/);
  assert.match(schema, /instance_id text not null/);
  assert.match(schema, /primary key \(player_id, instance_id\)/);
  assert.match(schema, /settlement_id uuid primary key/);
  assert.match(schema, /expected_revision bigint not null check \(expected_revision >= 0\)/);
  assert.match(schema, /committed_revision bigint check \(committed_revision >= 0\)/);
  assert.match(schema, /settlement_id uuid references settlement_record\(settlement_id\)/);
  assert.match(schema, /settlement_record_pending_created_idx on settlement_record\(created_at, settlement_id\) where status = 'pending'/i);
  assert.match(schema, /claim_token text/);
  assert.match(schema, /claim_until timestamptz/);
  assert.match(schema, /settlement_record_pending_claim_idx on settlement_record\(claim_until, created_at, settlement_id\) where status = 'pending'/i);
});

test('database contract documents the migrated numeric and player-scoped identity boundaries', () => {
  // These declarations are compatibility boundaries, not product tuning. Keep
  // the human-facing contract tied to the executable migration so a stale
  // UUID/bigint description cannot silently become an integration contract.
  for (const declaration of [
    /resource_id\s+dongtian_resource_id not null/,
    /amount\s+numeric not null check \(amount >= 0\)/,
    /capacity\s+numeric not null check \(capacity >= 0\)/,
    /reserved_amount\s+numeric not null default 0 check \(reserved_amount >= 0\)/,
    /overflow_amount\s+numeric not null default 0 check \(overflow_amount >= 0\)/,
    /carry_seconds\s+numeric not null default 0 check \(carry_seconds >= 0\)/,
    /carry_quantity\s+numeric not null default 0 check \(carry_quantity >= 0\)/,
    /carry_seconds\s+numeric not null default 0/,
    /instance_id\s+text not null/,
    /primary key \(player_id, instance_id\)/,
    /building_state[\s\S]*player_id\s+uuid not null references player_state\(player_id\)/,
    /collection_state[\s\S]*player_id\s+uuid primary key references player_state\(player_id\)/,
    /progress_state[\s\S]*player_id\s+uuid primary key references player_state\(player_id\)/,
    /settlement_id\s+uuid primary key[\s\S]*player_id\s+uuid not null references player_state\(player_id\)/,
    /expected_revision\s+bigint not null check \(expected_revision >= 0\)/,
    /committed_revision\s+bigint null check \(committed_revision >= 0\)/,
    /audit_event[\s\S]*settlement_id\s+uuid null references settlement_record\(settlement_id\)/,
  ]) assert.match(databaseContract, declaration);
  assert.doesNotMatch(databaseContract, /resource_id\s+text not null/);
  assert.doesNotMatch(databaseContract, /amount\s+bigint not null/);
  assert.doesNotMatch(databaseContract, /capacity\s+bigint not null/);
  assert.doesNotMatch(databaseContract, /reserved_amount\s+bigint not null/);
  assert.doesNotMatch(databaseContract, /^carry_seconds\s+bigint not null/m);
  assert.doesNotMatch(databaseContract, /instance_id\s+uuid primary key/);
});

test('migration persists the fields needed to restore dungeon state', () => {
  for (const field of [
    'active_dungeon_id', 'dungeon_status', 'dungeon_phase', 'dungeon_boss_hp',
    'dungeon_started_at', 'dungeon_carry_seconds', 'dungeon_failure_cooldown_until',
  ]) assert.match(schema, new RegExp(`\\b${field}\\b`));
  assert.match(schema, /dungeon_status text not null default 'idle' check \(dungeon_status in \('idle', 'fighting', 'success', 'failed', 'cooldown'\)\)/);
  assert.match(schema, /alter table progress_state alter column dungeon_boss_hp type numeric/);
});

test('building state preserves fractional passive-production carry', () => {
  assert.match(schema, /carry_seconds numeric not null default 0 check \(carry_seconds >= 0\)/);
  assert.match(schema, /carry_quantity numeric not null default 0 check \(carry_quantity >= 0\)/);
  assert.match(schema, /building_state_carry_seconds_nonnegative/);
  assert.match(schema, /building_state_carry_quantity_nonnegative/);
  assert.match(schema, /alter table building_state add column if not exists carry_quantity numeric not null default 0/);
  assert.match(schema, /alter table building_state alter column carry_seconds type numeric using carry_seconds::numeric/);
});

test('building state persists explicit spirit farm planting timestamps and plot count', () => {
  assert.match(schema, /planted_plots numeric/);
  assert.match(schema, /planted_at timestamptz/);
  assert.match(schema, /mature_at timestamptz/);
  assert.match(schema, /building_state_planted_plots_nonnegative/);
  assert.match(schema, /building_state_planting_consistent/);
  assert.match(schema, /alter table building_state add column if not exists planted_plots numeric/);
  assert.match(schema, /create table if not exists spirit_farm_plot_state/);
  assert.match(schema, /plot_id text not null/);
  assert.match(schema, /plant_id text not null/);
  assert.match(schema, /primary key \(player_id, plot_id\)/);
});

test('progress state preserves opaque random-event and support-route payloads', () => {
  assert.match(schema, /random_event_state jsonb not null default '\{\}'::jsonb/);
  assert.match(schema, /support_route_state jsonb not null default '\{\}'::jsonb/);
  assert.match(schema, /alter table progress_state add column if not exists random_event_state jsonb not null default '\{\}'::jsonb/);
  assert.match(schema, /alter table progress_state add column if not exists support_route_state jsonb not null default '\{\}'::jsonb/);
});

test('dungeon attempt persistence covers seed, boss audit and settle idempotency', () => {
  assert.match(schema, /create table if not exists dungeon_attempt/);
  assert.match(schema, /attempt_id uuid primary key/);
  assert.match(schema, /player_id uuid not null references player_state\(player_id\)/);
  assert.match(schema, /seed bigint not null/);
  assert.match(schema, /status text not null check \(status in \('active', 'succeeded', 'failed'\)\)/);
  for (const field of ['config_version', 'config_snapshot', 'boss_hp', 'boss_max_hp', 'barrier', 'phase', 'elapsed_seconds', 'stun_seconds', 'spirit_burn_seconds', 'spirit_burn_damage', 'boss_damage_taken', 'boss_damage_multiplier', 'combat_snapshot', 'combat_events', 'response_payload', 'settled_at']) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }
  assert.match(schema, /state_revision bigint not null default 0 check \(state_revision >= 0\)/);
  assert.match(schema, /dungeon_attempt_revision_nonnegative/);
});

test('migration persists collection growth state and duplicate balances', () => {
  assert.match(schema, /create table if not exists collection_state/);
  for (const field of ['technique_layers', 'technique_research_xp', 'treasure_stars', 'collection_marks', 'duplicate_balances']) assert.match(schema, new RegExp(`\\b${field}\\b`));
  assert.match(schema, /collection_marks bigint not null default 0 check \(collection_marks >= 0\)/);
  assert.match(schema, /collection_state_collection_marks_nonnegative/);
  assert.match(schema, /collection_state_revision_nonnegative/);
});

test('FI-05 collection exchange contract keeps pools isolated and migrates legacy marks once', () => {
  assert.match(schema, /mark_balances jsonb not null default '\{\}'::jsonb/);
  assert.match(schema, /alter table collection_state add column if not exists mark_balances/);
  assert.match(schema, /jsonb_build_object\('starter', collection_marks\)/);
  assert.match(httpAdapter, /pathname === '\/v1\/collection\/exchanges'/);
  assert.match(databaseContract, /`POST \/v1\/collection\/exchanges`/);
});

test('migration persists an independent append-only collection event stream', () => {
  assert.match(schema, /create table if not exists collection_event/);
  for (const field of ['event_id', 'event_type', 'before_revision', 'after_revision', 'config_version', 'payload_hash', 'payload', 'created_at']) assert.match(schema, new RegExp(`\\b${field}\\b`));
  assert.match(schema, /collection_event_player_created_idx on collection_event\(player_id, created_at, event_id\)/);
});

test('audit migration retains a readable payload alongside its integrity hash', () => {
  assert.match(schema, /payload_hash text not null/);
  assert.match(schema, /payload jsonb/);
  assert.match(schema, /alter table audit_event add column if not exists payload jsonb/);
});

test('migration persists high-tier gate state as one authoritative progress payload', () => {
  assert.match(schema, /high_tier_gate_state jsonb not null default '\{\}'::jsonb/);
  assert.match(schema, /create table if not exists progress_state/);
  assert.match(schema, /progress_state[\s\S]*high_tier_gate_state/);
  assert.doesNotMatch(schema, /create table if not exists high_tier_attempt/);
});

test('memory state contains every resource and dungeon state required by the SQL contract', () => {
  const player = makeInitialPlayer('fixture-player', new Date('2026-01-01T00:00:00.000Z'));
  assert.deepEqual(Object.keys(player.resources).sort(), [...resourceIds].sort());
  assert.equal(player.equipmentCount, Object.keys(player.equipmentInstances).length);
  assert.deepEqual(Object.keys(player.buildings).sort(), ['alchemy_room', 'forge_room', 'spirit_farm', 'technique_pavilion', 'treasure_pavilion']);
  assert.deepEqual(player.collection, { techniqueLayers: {}, techniqueResearchXp: 0, treasureStars: {}, collectionMarks: 0, duplicateBalances: {} });
  assert.deepEqual(player.dungeonState, { dungeonId: null, status: 'idle', phase: 0, bossHp: 0, startedAt: null, carrySeconds: 0, failureCooldownUntil: null });
});

test('migration accepts the two pavilion building IDs as durable state rows', () => {
  assert.match(schema, /building_id text not null/);
  const player = makeInitialPlayer('pavilion-fixture', new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(player.buildings.technique_pavilion.level, 1);
  assert.equal(player.buildings.treasure_pavilion.level, 1);
});
