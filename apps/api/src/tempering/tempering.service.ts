import { randomBytes } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  JsonValue,
  PoolClient,
  TemperingRepository,
  TemperingAttemptRecord,
} from '@dongtian/database';
import { resolveTemperingAttempt } from '@dongtian/game-rules';

import { AuthService } from '../auth/auth.service.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { SettlementService } from '../settlement/settlement.service.js';
import { temperingRepositoryToken } from './tempering.tokens.js';

type JsonRecord = Record<string, unknown>;

type TemperingRequest = {
  readonly attemptId: string;
  readonly expectedStateVersion: bigint;
  readonly targetLevel: number;
  readonly useProtectionMaterial: boolean;
  readonly configVersion: string;
};

type TemperingResponse = {
  readonly character_id: string;
  readonly equipment_instance_id: string;
  readonly attempt_id: string;
  readonly from_level: number;
  readonly target_level: number;
  readonly level_before: number;
  readonly level_after: number;
  readonly status: 'APPLIED' | 'REJECTED';
  readonly outcome: 'SUCCESS' | 'FAILURE' | 'REJECTED';
  readonly success: boolean;
  readonly success_probability: string;
  readonly attribute_increase: string;
  readonly random_audit: {
    readonly namespace: string;
    readonly attempt_key: string;
    readonly seed_hex: string;
    readonly roll: string;
    readonly success_probability: string;
    readonly formula_version: number;
  } | null;
  readonly cost_snapshot: {
    readonly tempering_stone_cost: string;
    readonly spirit_stone_cost: string;
    readonly same_equipment_cost: string;
    readonly protection_material_cost_requested: string;
    readonly protection_material_cost_spent: string;
  };
  readonly equipment: {
    readonly instance_id: string;
    readonly item_id: string;
    readonly temper_level: number;
    readonly bound: boolean;
    readonly created_config_version: string;
  };
  readonly asset_transaction_id: string;
  readonly temper_audit_id: string;
  readonly state_version: number;
  readonly config_version: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    message_key: 'error.state_version_conflict',
    details: { reason },
  });
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message_key: 'error.resource_not_found',
  });
}

function requiredString(record: JsonRecord, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field}_REQUIRED`);
  }
  return value;
}

function requiredBoolean(record: JsonRecord, field: string): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') {
    throw badRequest(`${field}_INVALID`);
  }
  return value;
}

function requiredPositiveInteger(record: JsonRecord, field: string): number {
  const value = record[field];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return Number(value);
  }
  throw badRequest(`${field}_INVALID`);
}

function optionalPositiveInteger(record: JsonRecord, field: string): number {
  const value = record[field];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    return Number(value);
  }
  throw badRequest(`${field}_INVALID`);
}

function stateVersionAsNumber(stateVersion: string): number {
  const parsed = Number(stateVersion);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('STATE_VERSION_OUT_OF_RANGE');
  }
  return parsed;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function parseRequest(body: unknown): TemperingRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  return {
    attemptId: requiredString(body, 'attempt_id'),
    expectedStateVersion: BigInt(optionalPositiveInteger(body, 'expected_state_version')),
    targetLevel: requiredPositiveInteger(body, 'target_level'),
    useProtectionMaterial: requiredBoolean(body, 'use_protection_material'),
    configVersion: requiredString(body, 'config_version'),
  };
}

async function lockWritableCharacter(client: PoolClient, characterId: string): Promise<void> {
  const character = await client.query<{ id: string }>(
    `SELECT id FROM characters WHERE id = $1 FOR UPDATE`,
    [characterId],
  );
  if (!character.rows[0]) {
    throw new Error('ASSET_CHARACTER_NOT_FOUND');
  }
  const state = await client.query<{ continuation_required: boolean }>(
    `SELECT continuation_required
       FROM settlement_states
      WHERE character_id = $1
      FOR UPDATE`,
    [characterId],
  );
  const row = state.rows[0];
  if (!row) {
    throw new Error('ASSET_SETTLEMENT_STATE_NOT_FOUND');
  }
  if (row.continuation_required) {
    throw new Error('SETTLEMENT_CONTINUATION_IN_PROGRESS');
  }
}

async function createTransaction(
  client: PoolClient,
  input: {
    readonly characterId: string;
    readonly operationType: string;
    readonly reasonCode: string;
    readonly referenceType: string;
    readonly referenceId: string;
    readonly configVersion: string;
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
      input.reasonCode,
      input.referenceType,
      input.referenceId,
      input.configVersion,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('ASSET_TRANSACTION_NOT_CREATED');
  }
  return row.id;
}

async function createLedgerEntry(
  client: PoolClient,
  input: {
    readonly transactionId: string;
    readonly characterId: string;
    readonly assetType: 'ITEM' | 'CURRENCY';
    readonly assetId: string;
    readonly delta: string;
    readonly balanceAfter: string;
    readonly reasonCode: string;
    readonly referenceType: string;
    readonly referenceId: string;
    readonly configVersion: string;
  },
): Promise<string> {
  const result = await client.query<{ entry_id: string }>(
    `INSERT INTO asset_ledger (
       transaction_id, character_id, asset_type, asset_id, delta, balance_after,
       reason_code, reference_type, reference_id, config_version
     )
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9, $10)
     RETURNING entry_id`,
    [
      input.transactionId,
      input.characterId,
      input.assetType,
      input.assetId,
      input.delta,
      input.balanceAfter,
      input.reasonCode,
      input.referenceType,
      input.referenceId,
      input.configVersion,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('ASSET_LEDGER_ENTRY_NOT_CREATED');
  }
  return row.entry_id;
}

async function deductAsset(
  client: PoolClient,
  input: {
    readonly characterId: string;
    readonly assetType: 'ITEM' | 'CURRENCY';
    readonly assetId: string;
    readonly quantity: string;
  },
): Promise<{ readonly quantity: string; readonly reservedQuantity: string; readonly availableQuantity: string }> {
  const table = input.assetType === 'ITEM' ? 'inventories' : 'currency_balances';
  const amountType = input.assetType === 'ITEM' ? 'bigint' : 'numeric';
  const assetColumn = input.assetType === 'ITEM' ? 'item_id' : 'currency_id';
  const result = await client.query<{
    quantity: string;
    reserved_quantity: string;
    available_quantity: string;
  }>(
    `UPDATE ${table}
        SET quantity = quantity - $2::${amountType},
            updated_at = CURRENT_TIMESTAMP
      WHERE character_id = $1
        AND ${assetColumn} = $3
        AND (quantity - reserved_quantity) >= $2::${amountType}
      RETURNING quantity::text, reserved_quantity::text,
                (quantity - reserved_quantity)::text AS available_quantity`,
    [input.characterId, input.quantity, input.assetId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('ASSET_INSUFFICIENT_AVAILABLE');
  }
  return {
    quantity: row.quantity,
    reservedQuantity: row.reserved_quantity,
    availableQuantity: row.available_quantity,
  };
}

async function lockInventoryBalance(
  client: PoolClient,
  characterId: string,
  assetType: 'ITEM' | 'CURRENCY',
  assetId: string,
): Promise<{ readonly quantity: string; readonly reservedQuantity: string; readonly availableQuantity: string } | null> {
  const table = assetType === 'ITEM' ? 'inventories' : 'currency_balances';
  const assetColumn = assetType === 'ITEM' ? 'item_id' : 'currency_id';
  const result = await client.query<{
    quantity: string;
    reserved_quantity: string;
    available_quantity: string;
  }>(
    `SELECT quantity::text, reserved_quantity::text,
            (quantity - reserved_quantity)::text AS available_quantity
       FROM ${table}
      WHERE character_id = $1
        AND ${assetColumn} = $2
      FOR UPDATE`,
    [characterId, assetId],
  );
  const row = result.rows[0];
  return row
    ? {
        quantity: row.quantity,
        reservedQuantity: row.reserved_quantity,
        availableQuantity: row.available_quantity,
      }
    : null;
}

async function lockSameEquipmentMaterials(
  client: PoolClient,
  characterId: string,
  itemId: string,
  excludeInstanceId: string,
  limit: number,
): Promise<readonly { readonly instance_id: string }[]> {
  const result = await client.query<{ instance_id: string }>(
    `SELECT id AS instance_id
       FROM equipment_instances
      WHERE character_id = $1
        AND item_id = $2
        AND id <> $3
      ORDER BY created_at ASC, id ASC
      LIMIT $4
      FOR UPDATE`,
    [characterId, itemId, excludeInstanceId, limit],
  );
  return result.rows;
}

async function loadAttemptAudit(
  client: PoolClient,
  attemptId: string,
): Promise<{ readonly audit_id: string; readonly asset_transaction_id: string } | null> {
  const result = await client.query<{ audit_id: string; asset_transaction_id: string }>(
    `SELECT id AS audit_id, asset_transaction_id
       FROM equipment_temper_audits
      WHERE attempt_id = $1`,
    [attemptId],
  );
  return result.rows[0] ?? null;
}

function resolveFromAttempt(attempt: TemperingAttemptRecord): ReturnType<typeof resolveTemperingAttempt> {
  const costSnapshot = attempt.costs as TemperingResponse['cost_snapshot'];
  const useProtectionMaterial = costSnapshot.protection_material_cost_spent !== '0';
  return resolveTemperingAttempt({
    attemptId: attempt.attemptId,
    equipmentInstanceId: attempt.equipmentInstanceId,
    fromLevel: attempt.fromLevel,
    targetLevel: attempt.targetLevel,
    useProtectionMaterial,
    serverSeedHex: attempt.randomSeedHex,
    configVersion: attempt.configVersion,
    formulaVersion: attempt.formulaVersion,
  });
}

function buildResponse(
  attempt: TemperingAttemptRecord,
  auditId: string,
  equipment: {
    readonly instanceId: string;
    readonly itemId: string;
    readonly temperLevel: number;
    readonly bound: boolean;
    readonly createdConfigVersion: string;
  },
  resolved: ReturnType<typeof resolveTemperingAttempt>,
  responseStateVersion: number,
): TemperingResponse {
  return {
    character_id: attempt.characterId,
    equipment_instance_id: attempt.equipmentInstanceId,
    attempt_id: attempt.attemptId,
    from_level: attempt.fromLevel,
    target_level: attempt.targetLevel,
    level_before: resolved.equipmentLevelBefore,
    level_after: resolved.equipmentLevelAfter,
    status: resolved.status,
    outcome: resolved.outcome,
    success: resolved.success,
    success_probability: resolved.successProbability,
    attribute_increase: resolved.attributeIncrease,
    random_audit: resolved.randomAudit === null ? null : {
      namespace: resolved.randomAudit.namespace,
      attempt_key: resolved.randomAudit.attemptKey,
      seed_hex: resolved.randomAudit.seedHex,
      roll: resolved.randomAudit.roll,
      success_probability: resolved.randomAudit.successProbability,
      formula_version: resolved.randomAudit.formulaVersion,
    },
    cost_snapshot: {
      tempering_stone_cost: resolved.costSnapshot.temperingStoneCost,
      spirit_stone_cost: resolved.costSnapshot.spiritStoneCost,
      same_equipment_cost: resolved.costSnapshot.sameEquipmentCost,
      protection_material_cost_requested: resolved.costSnapshot.protectionMaterialCostRequested,
      protection_material_cost_spent: resolved.costSnapshot.protectionMaterialCostSpent,
    },
    equipment: {
      instance_id: equipment.instanceId,
      item_id: equipment.itemId,
      temper_level: equipment.temperLevel,
      bound: equipment.bound,
      created_config_version: equipment.createdConfigVersion,
    },
    asset_transaction_id: attempt.assetTransactionId ?? '',
    temper_audit_id: auditId,
    state_version: responseStateVersion,
    config_version: attempt.configVersion,
  };
}

@Injectable()
export class TemperingService {
  public constructor(
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(temperingRepositoryToken) private readonly temperingRepository: TemperingRepository,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  public async temperEquipment(
    request: FastifyRequest,
    characterId: string,
    instanceId: string,
    body: unknown,
  ): Promise<TemperingResponse> {
    const parsed = parseRequest(body);
    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'EQUIPMENT_TEMPER',
      request: body,
      execute: async ({ client }) => {
        const accountId = await this.authService.requireWriteAccess(request);
        const state = await this.loadCharacterStateOnTransaction(client, characterId, accountId);
        if (!state) {
          throw notFound();
        }
        await lockWritableCharacter(client, characterId);
        if (state.state_version !== parsed.expectedStateVersion.toString()) {
          throw conflict('expected_state_version');
        }
        if (parsed.configVersion !== this.configRegistry.manifest.config_version) {
          throw conflict('config_version_mismatch');
        }
        if (parsed.targetLevel < 1 || parsed.targetLevel > 10) {
          throw badRequest('TEMPERING_TARGET_LEVEL_INVALID');
        }

        const existingAttempt = await this.temperingRepository.getTemperingAttempt(client, parsed.attemptId);
        if (existingAttempt?.completedAt != null) {
          const existingAudit = await loadAttemptAudit(client, parsed.attemptId);
          if (!existingAudit) {
            throw new Error('TEMPER_AUDIT_NOT_FOUND');
          }
          const equipment = await this.loadEquipmentForResponse(client, characterId, accountId, instanceId);
          if (!equipment) {
            throw notFound();
          }
          const resolved = resolveFromAttempt(existingAttempt);
          return {
            statusCode: 200,
            response: buildResponse(existingAttempt, existingAudit.audit_id, equipment, resolved, stateVersionAsNumber(state.state_version)),
          };
        }
        if (existingAttempt != null && existingAttempt.completedAt === null) {
          throw conflict('temper_attempt_in_progress');
        }

        const targetEquipment = await this.temperingRepository.lockEquipmentInstance(client, {
          characterId,
          accountId,
          instanceId,
        });
        if (!targetEquipment) {
          throw notFound();
        }
        const equipmentConfig = this.configRegistry.getEquipment(targetEquipment.itemId);
        if (!equipmentConfig.temperable) {
          throw badRequest('TEMPERING_EQUIPMENT_NOT_TEMPERABLE');
        }
        if (parsed.targetLevel !== targetEquipment.temperLevel + 1) {
          throw badRequest('TEMPERING_TARGET_LEVEL_MUST_BE_NEXT');
        }
        if (parsed.targetLevel > equipmentConfig.max_temper_level) {
          throw badRequest('TEMPERING_LEVEL_LOCKED');
        }
        if (parsed.targetLevel > 6) {
          throw badRequest('TEMPERING_LEVEL_LOCKED');
        }

        const rule = this.configRegistry.getTempering(parsed.targetLevel);
        const seed = randomBytes(16);
        const resolved = resolveTemperingAttempt({
          attemptId: parsed.attemptId,
          equipmentInstanceId: targetEquipment.instanceId,
          fromLevel: targetEquipment.temperLevel,
          targetLevel: parsed.targetLevel,
          useProtectionMaterial: parsed.useProtectionMaterial,
          serverSeedHex: toHex(seed),
          configVersion: parsed.configVersion,
          formulaVersion: this.configRegistry.manifest.formula_version,
        });

        const createdAttempt = await this.temperingRepository.createTemperingAttempt(client, {
          attemptId: parsed.attemptId,
          characterId,
          equipmentInstanceId: targetEquipment.instanceId,
          fromLevel: targetEquipment.temperLevel,
          targetLevel: parsed.targetLevel,
          successProbability: resolved.successProbability,
          randomSeedHex: resolved.randomAudit?.seedHex ?? toHex(seed),
          configVersion: parsed.configVersion,
          formulaVersion: this.configRegistry.manifest.formula_version,
          costs: resolved.costSnapshot as JsonValue,
        });
        if (createdAttempt.completedAt != null) {
          const replayAudit = await loadAttemptAudit(client, parsed.attemptId);
          if (!replayAudit) {
            throw new Error('TEMPER_AUDIT_NOT_FOUND');
          }
          const equipment = await this.loadEquipmentForResponse(client, characterId, accountId, instanceId);
          if (!equipment) {
            throw notFound();
          }
          const replayResolved = resolveFromAttempt(createdAttempt);
          return {
            statusCode: 200,
            response: buildResponse(createdAttempt, replayAudit.audit_id, equipment, replayResolved, stateVersionAsNumber(state.state_version)),
          };
        }

        const temperingStone = await lockInventoryBalance(client, characterId, 'ITEM', rule.tempering_stone_item_id);
        const spiritStone = await lockInventoryBalance(client, characterId, 'CURRENCY', 'currency.spirit_stone');
        const protectionMaterialSpent = parsed.useProtectionMaterial ? rule.protection_material_cost : '0';
        const protectionMaterial = protectionMaterialSpent !== '0'
          ? await lockInventoryBalance(client, characterId, 'ITEM', rule.protection_material_item_id)
          : null;

        if (!temperingStone || BigInt(temperingStone.availableQuantity) < BigInt(rule.tempering_stone_cost)) {
          throw badRequest('TEMPERING_STONE_INSUFFICIENT');
        }
        if (!spiritStone || BigInt(spiritStone.availableQuantity) < BigInt(rule.spirit_stone_cost)) {
          throw badRequest('SPIRIT_STONE_INSUFFICIENT');
        }
        if (protectionMaterialSpent !== '0') {
          if (!protectionMaterial || BigInt(protectionMaterial.availableQuantity) < BigInt(protectionMaterialSpent)) {
            throw badRequest('PROTECTION_MATERIAL_INSUFFICIENT');
          }
        }

        const sameEquipmentCount = Number(rule.same_equipment_cost);
        const sameEquipmentMaterials = sameEquipmentCount > 0
          ? await lockSameEquipmentMaterials(client, characterId, targetEquipment.itemId, targetEquipment.instanceId, sameEquipmentCount)
          : [];
        if (sameEquipmentMaterials.length < sameEquipmentCount) {
          throw badRequest('SAME_EQUIPMENT_INSUFFICIENT');
        }

        const transactionId = await createTransaction(client, {
          characterId,
          operationType: 'EQUIPMENT_TEMPER',
          reasonCode: 'EQUIPMENT_TEMPER',
          referenceType: 'TEMPER_ATTEMPT',
          referenceId: parsed.attemptId,
          configVersion: parsed.configVersion,
        });

        const itemDeduct = async (assetType: 'ITEM' | 'CURRENCY', assetId: string, quantity: string): Promise<void> => {
          const current = assetType === 'ITEM'
            ? await lockInventoryBalance(client, characterId, 'ITEM', assetId)
            : await lockInventoryBalance(client, characterId, 'CURRENCY', assetId);
          if (!current || BigInt(current.availableQuantity) < BigInt(quantity)) {
            throw badRequest(`${assetId}_INSUFFICIENT`);
          }
          const updated = await deductAsset(client, {
            characterId,
            assetType,
            assetId,
            quantity,
          });
          await createLedgerEntry(client, {
            transactionId,
            characterId,
            assetType,
            assetId,
            delta: `-${quantity}`,
            balanceAfter: updated.quantity,
            reasonCode: 'EQUIPMENT_TEMPER',
            referenceType: 'TEMPER_ATTEMPT',
            referenceId: parsed.attemptId,
            configVersion: parsed.configVersion,
          });
        };

        await itemDeduct('ITEM', rule.tempering_stone_item_id, rule.tempering_stone_cost);
        await itemDeduct('CURRENCY', 'currency.spirit_stone', rule.spirit_stone_cost);
        if (protectionMaterialSpent !== '0') {
          await itemDeduct('ITEM', rule.protection_material_item_id, protectionMaterialSpent);
        }

        if (sameEquipmentMaterials.length > 0) {
          await client.query(
            `DELETE FROM equipment_instances
              WHERE id = ANY($1::uuid[])
                AND character_id = $2`,
            [sameEquipmentMaterials.map((row) => row.instance_id), characterId],
          );
        }

        const updatedEquipment = await client.query<{
          id: string;
          item_id: string;
          temper_level: number;
          bound: boolean;
          created_config_version: string;
        }>(
          `UPDATE equipment_instances
              SET temper_level = $2,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
              AND character_id = $3
            RETURNING id, item_id, temper_level, bound, created_config_version`,
          [targetEquipment.instanceId, resolved.success ? parsed.targetLevel : targetEquipment.temperLevel, characterId],
        );
        const equipmentRow = updatedEquipment.rows[0];
        if (!equipmentRow) {
          throw new Error('TEMPERING_EQUIPMENT_UPDATE_FAILED');
        }

        const completeAttempt = await this.temperingRepository.completeTemperingAttempt(client, {
          attemptId: parsed.attemptId,
          assetTransactionId: transactionId,
          result: resolved.outcome === 'REJECTED' ? 'REJECTED' : (resolved.success ? 'SUCCESS' : 'FAILURE'),
          success: resolved.success,
          costs: resolved.costSnapshot as JsonValue,
          completedAt: new Date(),
        });

        const audit = await this.temperingRepository.createEquipmentTemperAudit(client, {
          attemptId: parsed.attemptId,
          characterId,
          equipmentInstanceId: targetEquipment.instanceId,
          fromLevel: targetEquipment.temperLevel,
          targetLevel: parsed.targetLevel,
          levelBefore: targetEquipment.temperLevel,
          levelAfter: resolved.success ? parsed.targetLevel : targetEquipment.temperLevel,
          success: resolved.success,
          result: resolved.outcome === 'REJECTED' ? 'REJECTED' : (resolved.success ? 'SUCCESS' : 'FAILURE'),
          assetTransactionId: transactionId,
        });

        await client.query(
          `INSERT INTO outbox_events
            (event_type, aggregate_type, aggregate_id, transaction_id, payload, available_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)`,
          [
            'equipment_temper_attempted',
            'character',
            characterId,
            transactionId,
            JSON.stringify({
              character_id: characterId,
              equipment_instance_id: targetEquipment.instanceId,
              attempt_id: parsed.attemptId,
              target_level: parsed.targetLevel,
              success: resolved.success,
              outcome: resolved.outcome,
              state_version: stateVersionAsNumber(state.state_version),
            }),
          ],
        );

        return {
          statusCode: 200,
          response: buildResponse(
            completeAttempt,
            audit.auditId,
            {
              instanceId: equipmentRow.id,
              itemId: equipmentRow.item_id,
              temperLevel: equipmentRow.temper_level,
              bound: equipmentRow.bound,
              createdConfigVersion: equipmentRow.created_config_version,
            },
            resolved,
            stateVersionAsNumber(state.state_version) + 1,
          ),
          transactionId,
          outboxEvents: [],
        };
      },
    });
    return result.response;
  }

  private async loadCharacterStateOnTransaction(
    client: PoolClient,
    characterId: string,
    accountId: string,
  ): Promise<{ readonly state_version: string } | null> {
    const result = await client.query<{ readonly state_version: string }>(
      `SELECT c.state_version::text AS state_version
         FROM characters c
        WHERE c.id = $1
          AND c.account_id = $2
        FOR UPDATE`,
      [characterId, accountId],
    );
    return result.rows[0] ?? null;
  }

  private async loadEquipmentForResponse(
    client: PoolClient,
    characterId: string,
    accountId: string,
    instanceId: string,
  ): Promise<{
    readonly instanceId: string;
    readonly itemId: string;
    readonly temperLevel: number;
    readonly bound: boolean;
    readonly createdConfigVersion: string;
  } | null> {
    const result = await client.query<{
      instance_id: string;
      item_id: string;
      temper_level: number;
      bound: boolean;
      created_config_version: string;
    }>(
      `SELECT e.id AS instance_id, e.item_id, e.temper_level, e.bound, e.created_config_version
         FROM equipment_instances e
         INNER JOIN characters c ON c.id = e.character_id
        WHERE e.id = $1
          AND e.character_id = $2
          AND c.account_id = $3`,
      [instanceId, characterId, accountId],
    );
    const row = result.rows[0];
    return row
      ? {
          instanceId: row.instance_id,
          itemId: row.item_id,
          temperLevel: row.temper_level,
          bound: row.bound,
          createdConfigVersion: row.created_config_version,
        }
      : null;
  }
}
