import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../packages/database/prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../packages/database/prisma/migrations/0001_initial/migration.sql', import.meta.url),
  'utf8',
);
const assetMigration = readFileSync(
  new URL('../../packages/database/prisma/migrations/0002_asset_reservations/migration.sql', import.meta.url),
  'utf8',
);
const settlementMigration = readFileSync(
  new URL('../../packages/database/prisma/migrations/0003_settlement_v1/migration.sql', import.meta.url),
  'utf8',
);
const queueMigration = readFileSync(
  new URL('../../packages/database/prisma/migrations/0004_queue_v1/migration.sql', import.meta.url),
  'utf8',
);
const queueCompatibilityMigration = readFileSync(
  new URL('../../packages/database/prisma/migrations/0005_cultivation_fallback/migration.sql', import.meta.url),
  'utf8',
);
const equipmentMigration = readFileSync(
  new URL('../../packages/database/prisma/migrations/0007_equipment_v1/migration.sql', import.meta.url),
  'utf8',
);
const breakthroughMigration = readFileSync(
  new URL('../../packages/database/prisma/migrations/0013_breakthrough_v1/migration.sql', import.meta.url),
  'utf8',
);

describe('database migrations', () => {
  it('contains the approved persistence boundary without market storage', () => {
    for (const model of [
      'Account',
      'Session',
      'Character',
      'CharacterProgression',
      'SkillProgression',
      'Inventory',
      'CurrencyBalance',
      'AssetTransaction',
      'AssetLedgerEntry',
      'AssetReservation',
      'EquipmentInstance',
      'IdempotencyRecord',
      'ConfigRelease',
      'OutboxEvent',
      'SettlementState',
      'SettlementRun',
      'SettlementSegment',
      'ActionQueue',
      'ActionQueueEntry',
      'LoadoutPreset',
    ]) {
      expect(schema).toContain(`model ${model}`);
    }

    expect(schema.toLowerCase()).not.toContain('market');
    expect(migration.toLowerCase()).not.toContain('market');
    expect(assetMigration.toLowerCase()).not.toContain('market');
    expect(settlementMigration.toLowerCase()).not.toContain('market');
    expect(queueMigration.toLowerCase()).not.toContain('market');
    expect(queueCompatibilityMigration.toLowerCase()).not.toContain('market');
  });

  it('preserves the database-level invariants required for assets and audit data', () => {
    expect(migration).toContain('uuidv7()');
    expect(migration).toContain('DECIMAL(30,6)');
    expect(migration).toContain('"inventories_reserved_quantity_within_quantity_check"');
    expect(migration).toContain('"currency_balances_reserved_quantity_within_quantity_check"');
    expect(migration).toContain('"accounts_registration_identity_check"');
    expect(migration).toContain('asset_ledger_immutable_trigger');
    expect(migration).toContain('FOR EACH ROW EXECUTE FUNCTION prevent_asset_ledger_mutation()');
    expect(migration).toContain('"idempotency_records_account_id_operation_type_idempotency_k_key"');
    expect(migration).toContain('"outbox_events_status_available_at_idx"');
    expect(assetMigration).toContain('CREATE TABLE "asset_reservations"');
    expect(assetMigration).toContain('asset_reservations_active_business_asset_key');
    expect(assetMigration).toContain('asset_reservations_quantity_positive_check');
    expect(assetMigration).toContain('CREATE TABLE "equipment_instances"');
    expect(assetMigration).toContain('equipment_instances_temper_level_non_negative_check');
    expect(migration).toContain('"idempotency_records"');
    expect(migration).toContain('"response_snapshot" JSONB NOT NULL');
    expect(migration).toContain('"outbox_events"');
    expect(migration).toContain('"locked_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('"outbox_events_status_available_at_idx"');
    expect(settlementMigration).toContain('CREATE TABLE "settlement_states"');
    expect(settlementMigration).toContain('CREATE TABLE "settlement_runs"');
    expect(settlementMigration).toContain('CREATE TABLE "settlement_segments"');
    expect(queueMigration).toContain('CREATE TABLE "action_queues"');
    expect(queueMigration).toContain('CREATE TABLE "action_queue_entries"');
    expect(queueMigration).toContain('action_queue_entries_active_position_key');
    expect(queueMigration).toContain('QueueMode');
    expect(queueCompatibilityMigration).toContain('action.cultivation.qi');
    expect(queueCompatibilityMigration).toContain('blocked_reason');
    expect(equipmentMigration).toContain('CREATE TABLE "loadout_presets"');
    expect(equipmentMigration).toContain('active_loadout_preset_id');
    expect(equipmentMigration).toContain('loadout_presets_weapon_instance_id_fkey');
    expect(equipmentMigration).toContain('loadout_presets_version_non_negative_check');
  });

  it('creates the breakthrough status enum before the breakthrough runs table', () => {
    const enumPosition = breakthroughMigration.indexOf('CREATE TYPE "BreakthroughStatus"');
    const tablePosition = breakthroughMigration.indexOf('CREATE TABLE "breakthrough_runs"');

    expect(enumPosition).toBeGreaterThanOrEqual(0);
    expect(tablePosition).toBeGreaterThan(enumPosition);
  });
});
