import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetRepository,
  DatabasePool,
  EquipmentRepository,
  InventorySnapshot,
  LoadoutPresetRecord,
  PoolClient,
} from '@dongtian/database';
import { resolveEffectiveRealmStageId } from '@dongtian/game-rules';

import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { SettlementService } from '../settlement/settlement.service.js';
import { equipmentRepositoryToken } from './equipment.tokens.js';

type JsonRecord = Record<string, unknown>;

type LoadoutItemRef = {
  readonly instance_id: string;
  readonly item_id: string;
  readonly slot: 'WEAPON' | 'ARMOR' | 'ACCESSORY';
};

type LoadoutConsumable = {
  readonly item_id: string;
  readonly quantity: bigint;
};

type ParsedSaveRequest = {
  readonly expectedStateVersion: bigint;
  readonly name: string;
  readonly weaponInstanceId: string | null;
  readonly armorInstanceId: string | null;
  readonly accessoryInstanceId: string | null;
  readonly combatConsumables: readonly LoadoutConsumable[];
  readonly strategyId: string;
};

type CharacterStateRow = {
  readonly state_version: string;
  readonly realm_stage_id: string;
  readonly cultivation_xp: string;
  readonly active_loadout_preset_id: string | null;
};

type LoadoutPresetResponse = {
  readonly character_id: string;
  readonly preset_id: string;
  readonly name: string;
  readonly active: boolean;
  readonly complete: boolean;
  readonly effective_next_cycle?: boolean;
  readonly state_version: number;
  readonly weapon_instance_id: string | null;
  readonly armor_instance_id: string | null;
  readonly accessory_instance_id: string | null;
  readonly combat_consumables: readonly { readonly item_id: string; readonly quantity: string }[];
  readonly strategy_id: string;
  readonly version: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message_key: 'error.resource_not_found',
  });
}

function badRequest(reason: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message_key: 'error.validation_error',
    details: { reason },
  });
}

function conflict(reason: string): ConflictException {
  return new ConflictException({
    code: 'STATE_VERSION_CONFLICT',
    message_key: 'error.validation_error',
    details: { reason },
  });
}

function requiredString(record: JsonRecord, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field}_REQUIRED`);
  }
  return value;
}

function optionalString(record: JsonRecord, field: string): string | null {
  const value = record[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field}_INVALID`);
  }
  return value;
}

function parseNonNegativeInteger(value: unknown, field: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  throw badRequest(`${field}_INVALID`);
}

function parseConsumables(value: unknown): readonly LoadoutConsumable[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw badRequest('combat_consumables_INVALID');
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw badRequest(`combat_consumables.${index}_INVALID`);
    }
    return {
      item_id: requiredString(entry, 'item_id'),
      quantity: parseNonNegativeInteger(entry['quantity'], `combat_consumables.${index}.quantity`),
    };
  });
}

function parseSaveRequest(body: unknown): ParsedSaveRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  return {
    expectedStateVersion: parseNonNegativeInteger(body['expected_state_version'], 'expected_state_version'),
    name: requiredString(body, 'name'),
    weaponInstanceId: optionalString(body, 'weapon_instance_id'),
    armorInstanceId: optionalString(body, 'armor_instance_id'),
    accessoryInstanceId: optionalString(body, 'accessory_instance_id'),
    combatConsumables: parseConsumables(body['combat_consumables']),
    strategyId: requiredString(body, 'strategy_id'),
  };
}

function stateVersionAsNumber(stateVersion: string): number {
  const parsed = Number(stateVersion);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('STATE_VERSION_OUT_OF_RANGE');
  }
  return parsed;
}

function presetIsComplete(preset: LoadoutPresetRecord): boolean {
  return (
    preset.weaponInstanceId !== null
    && preset.armorInstanceId !== null
    && preset.accessoryInstanceId !== null
  );
}

function normalizeConsumables(consumables: readonly LoadoutConsumable[]): readonly { readonly item_id: string; readonly quantity: string }[] {
  return consumables.map((entry) => ({
    item_id: entry.item_id,
    quantity: entry.quantity.toString(),
  }));
}

@Injectable()
export class EquipmentService {
  public constructor(
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(databasePoolToken) private readonly pool: DatabasePool,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(equipmentRepositoryToken) private readonly equipmentRepository: EquipmentRepository,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  public async getPreset(
    request: FastifyRequest,
    characterId: string,
    presetId: string,
  ): Promise<LoadoutPresetResponse> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const state = await this.loadCharacterState(characterId, accountId);
    const preset = await this.equipmentRepository.getLoadoutPreset(characterId, accountId, presetId);
    if (!state || !preset) {
      throw notFound();
    }
    return this.toResponse(preset, stateVersionAsNumber(state.state_version), state.active_loadout_preset_id);
  }

  public async savePreset(
    request: FastifyRequest,
    characterId: string,
    presetId: string,
    body: unknown,
  ): Promise<LoadoutPresetResponse> {
    const parsed = parseSaveRequest(body);
    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'LOADOUT_SAVE',
      request: body,
      execute: async ({ client, settlement }) => {
        const accountId = await this.authService.requireWriteAccess(request);
        const state = await this.loadCharacterStateOnTransaction(client, characterId, accountId);
        if (!state) {
          throw notFound();
        }
        if (state.state_version !== parsed.expectedStateVersion.toString()) {
          throw conflict('expected_state_version');
        }

        const inventory = await this.assetRepository.getInventoryOnTransaction(client, characterId, accountId);
        if (!inventory) {
          throw notFound();
        }

        const selected = this.validateSelection({
          inventory,
          realmStageId: resolveEffectiveRealmStageId(this.configRegistry.realms, state.realm_stage_id, state.cultivation_xp),
          weaponInstanceId: parsed.weaponInstanceId,
          armorInstanceId: parsed.armorInstanceId,
          accessoryInstanceId: parsed.accessoryInstanceId,
        });
        const preset = await this.equipmentRepository.saveLoadoutPreset(client, {
          characterId,
          presetId,
          name: parsed.name,
          weaponInstanceId: parsed.weaponInstanceId,
          armorInstanceId: parsed.armorInstanceId,
          accessoryInstanceId: parsed.accessoryInstanceId,
          combatConsumables: normalizeConsumables(parsed.combatConsumables),
          strategyId: parsed.strategyId,
        });

        const transactionId = await this.createAuditTransaction(client, {
          characterId,
          referenceId: presetId,
          operationType: 'LOADOUT_SAVE',
        });
        const nextStateVersion = await this.bumpStateVersion(client, characterId, state.state_version);
        await this.insertOutbox(client, transactionId, characterId, 'equipment.loadout_saved', {
          character_id: characterId,
          preset_id: presetId,
          state_version: stateVersionAsNumber(nextStateVersion),
          complete: presetIsComplete(preset),
          selected_instances: selected,
          settlement_id: settlement.settlement_id,
        });
        return {
          statusCode: 200,
          response: this.toResponse(preset, stateVersionAsNumber(nextStateVersion), state.active_loadout_preset_id),
          transactionId,
          outboxEvents: [{
            eventType: 'LOADOUT_PRESET_SAVED',
            aggregateType: 'CHARACTER',
            aggregateId: characterId,
            payload: {
              character_id: characterId,
              preset_id: presetId,
              state_version: stateVersionAsNumber(nextStateVersion),
              complete: presetIsComplete(preset),
            },
          }],
        };
      },
    });
    return result.response;
  }

  public async equipPreset(
    request: FastifyRequest,
    characterId: string,
    presetId: string,
  ): Promise<LoadoutPresetResponse> {
    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'LOADOUT_EQUIP',
      request: { preset_id: presetId },
      execute: async ({ client, settlement }) => {
        const accountId = await this.authService.requireWriteAccess(request);
        const state = await this.loadCharacterStateOnTransaction(client, characterId, accountId);
        if (!state) {
          throw notFound();
        }

        const preset = await this.equipmentRepository.activateLoadoutPreset(client, {
          characterId,
          presetId,
        });
        if (!presetIsComplete(preset)) {
          throw badRequest('loadout_preset_INCOMPLETE');
        }

        const transactionId = await this.createAuditTransaction(client, {
          characterId,
          referenceId: presetId,
          operationType: 'LOADOUT_EQUIP',
        });
        const nextStateVersion = await this.bumpStateVersion(client, characterId, state.state_version);
        await this.insertOutbox(client, transactionId, characterId, 'equipment.loadout_equipped', {
          character_id: characterId,
          preset_id: presetId,
          state_version: stateVersionAsNumber(nextStateVersion),
          effective_next_cycle: true,
          settlement_id: settlement.settlement_id,
        });
        return {
          statusCode: 200,
          response: this.toResponse(preset, stateVersionAsNumber(nextStateVersion), preset.presetId, true),
          transactionId,
          outboxEvents: [{
            eventType: 'LOADOUT_PRESET_EQUIPPED',
            aggregateType: 'CHARACTER',
            aggregateId: characterId,
            payload: {
              character_id: characterId,
              preset_id: presetId,
              state_version: stateVersionAsNumber(nextStateVersion),
              effective_next_cycle: true,
            },
          }],
        };
      },
    });
    return result.response;
  }

  private async loadCharacterState(characterId: string, accountId: string): Promise<CharacterStateRow | null> {
    const result = await this.pool.query<CharacterStateRow>(
      `SELECT c.state_version::text AS state_version,
              c.realm_stage_id,
              cp.cultivation_xp::text AS cultivation_xp,
              c.active_loadout_preset_id::text AS active_loadout_preset_id
         FROM characters c
         INNER JOIN character_progression cp ON cp.character_id = c.id
        WHERE c.id = $1
          AND c.account_id = $2`,
      [characterId, accountId],
    );
    return result.rows[0] ?? null;
  }

  private async loadCharacterStateOnTransaction(
    client: PoolClient,
    characterId: string,
    accountId: string,
  ): Promise<CharacterStateRow | null> {
    const result = await client.query<CharacterStateRow>(
      `SELECT c.state_version::text AS state_version,
              c.realm_stage_id,
              cp.cultivation_xp::text AS cultivation_xp,
              c.active_loadout_preset_id::text AS active_loadout_preset_id
         FROM characters c
         INNER JOIN character_progression cp ON cp.character_id = c.id
        WHERE c.id = $1
          AND c.account_id = $2
        FOR UPDATE`,
      [characterId, accountId],
    );
    return result.rows[0] ?? null;
  }

  private validateSelection(input: {
    readonly inventory: InventorySnapshot;
    readonly realmStageId: string;
    readonly weaponInstanceId: string | null;
    readonly armorInstanceId: string | null;
    readonly accessoryInstanceId: string | null;
  }): readonly LoadoutItemRef[] {
    const requested = [
      { slot: 'WEAPON' as const, instanceId: input.weaponInstanceId },
      { slot: 'ARMOR' as const, instanceId: input.armorInstanceId },
      { slot: 'ACCESSORY' as const, instanceId: input.accessoryInstanceId },
    ];
    const seen = new Set<string>();
    const owned = new Map(input.inventory.equipmentInstances.map((item) => [item.instanceId, item] as const));
    const selected: LoadoutItemRef[] = [];
    const realm = this.configRegistry.getRealm(input.realmStageId);
    for (const entry of requested) {
      if (entry.instanceId === null) {
        continue;
      }
      if (seen.has(entry.instanceId)) {
        throw badRequest('loadout_preset_duplicate_instance');
      }
      seen.add(entry.instanceId);
      const equipment = owned.get(entry.instanceId);
      if (!equipment) {
        throw notFound();
      }
      const item = this.configRegistry.getItem(equipment.itemId);
      const equipmentConfig = this.configRegistry.getEquipment(equipment.itemId);
      if (equipmentConfig.slot !== entry.slot) {
        throw badRequest('loadout_slot_mismatch');
      }
      if (!item.tags.includes(entry.slot.toLowerCase())) {
        throw badRequest('loadout_slot_tag_mismatch');
      }
      if (this.configRegistry.getRealm(item.realm_required).stage_order > realm.stage_order) {
        throw badRequest('equipment_realm_locked');
      }
      const requiredRealm = equipmentConfig.equip_requirements.required_realm;
      if (requiredRealm !== null && this.configRegistry.getRealm(requiredRealm).stage_order > realm.stage_order) {
        throw badRequest('equipment_requirement_locked');
      }
      if (equipmentConfig.equip_requirements.required_tags.some((tag) => !item.tags.includes(tag))) {
        throw badRequest('equipment_requirement_tags_locked');
      }
      selected.push({
        instance_id: entry.instanceId,
        item_id: item.id,
        slot: entry.slot,
      });
    }
    return selected;
  }

  private async createAuditTransaction(
    client: PoolClient,
    input: {
      readonly characterId: string;
      readonly referenceId: string;
      readonly operationType: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO asset_transactions (
         character_id, operation_type, reason_code, reference_type, reference_id, config_version
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.characterId,
        input.operationType,
        input.operationType,
        'LOADOUT_PRESET',
        input.referenceId,
        this.configRegistry.manifest.config_version,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('EQUIPMENT_TRANSACTION_NOT_CREATED');
    }
    return row.id;
  }

  private async bumpStateVersion(client: PoolClient, characterId: string, stateVersion: string): Promise<string> {
    const result = await client.query<{ state_version: string }>(
      `UPDATE characters
          SET state_version = state_version + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND state_version::text = $2
        RETURNING state_version::text AS state_version`,
      [characterId, stateVersion],
    );
    const row = result.rows[0];
    if (!row) {
      throw conflict('state_version_changed');
    }
    return row.state_version;
  }

  private async insertOutbox(
    client: PoolClient,
    transactionId: string,
    characterId: string,
    eventType: string,
    payload: JsonRecord,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events
        (event_type, aggregate_type, aggregate_id, transaction_id, payload, available_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)`,
      [eventType, 'character', characterId, transactionId, JSON.stringify(payload)],
    );
  }

  private toResponse(
    preset: LoadoutPresetRecord,
    stateVersion: number,
    activePresetId: string | null,
    effectiveNextCycle = false,
  ): LoadoutPresetResponse {
    return {
      character_id: preset.characterId,
      preset_id: preset.presetId,
      name: preset.name,
      active: activePresetId === preset.presetId || preset.active,
      complete: presetIsComplete(preset),
      ...(effectiveNextCycle ? { effective_next_cycle: true } : {}),
      state_version: stateVersion,
      weapon_instance_id: preset.weaponInstanceId,
      armor_instance_id: preset.armorInstanceId,
      accessory_instance_id: preset.accessoryInstanceId,
      combat_consumables: Array.isArray(preset.combatConsumables)
        ? preset.combatConsumables.flatMap((entry) => {
            if (!isRecord(entry)) {
              return [];
            }
            const itemId = entry['item_id'];
            const quantity = entry['quantity'];
            if (typeof itemId !== 'string' || typeof quantity !== 'number' && typeof quantity !== 'string') {
              return [];
            }
            return [{
              item_id: itemId,
              quantity: String(quantity),
            }];
          })
        : [],
      strategy_id: preset.strategyId,
      version: preset.version.toString(),
    };
  }
}
