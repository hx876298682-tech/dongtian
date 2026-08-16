import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetRepository,
  BuffRepository,
  PoolClient,
} from '@dongtian/database';

import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { SettlementService } from '../settlement/settlement.service.js';
import { buffRepositoryToken } from './buff.tokens.js';

type JsonRecord = Record<string, unknown>;

type ParsedBuffUseRequest = {
  readonly itemId: string;
  readonly quantity: bigint;
  readonly targetSlotIndex: number;
  readonly expectedStateVersion: bigint;
};

type CharacterStateRow = {
  readonly state_version: string;
  readonly realm_stage_id: string;
};

type BuffUseResponse = {
  readonly character_id: string;
  readonly item_id: string;
  readonly quantity: string;
  readonly target_slot_index: number;
  readonly buff_instance: {
    readonly buff_instance_id: string;
    readonly buff_config_id: string;
    readonly source_item_id: string;
    readonly slot_index: number;
    readonly stack_group: string;
    readonly started_at: string;
    readonly expires_at: string;
  };
  readonly replaced_buff_instance_id: string | null;
  readonly effective_next_cycle: boolean;
  readonly state_version: number;
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

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message_key: 'error.resource_not_found',
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

function parseNonNegativeInteger(value: unknown, field: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  throw badRequest(`${field}_INVALID`);
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  throw badRequest(`${field}_INVALID`);
}

function parseRequest(body: unknown): ParsedBuffUseRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  const quantity = parseNonNegativeInteger(body['quantity'], 'quantity');
  if (quantity !== 1n) {
    throw badRequest('quantity_MUST_BE_ONE');
  }
  return {
    itemId: requiredString(body, 'item_id'),
    quantity,
    targetSlotIndex: parsePositiveInteger(body['target_slot_index'], 'target_slot_index'),
    expectedStateVersion: parseNonNegativeInteger(body['expected_state_version'], 'expected_state_version'),
  };
}

function toStateVersionNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('STATE_VERSION_OUT_OF_RANGE');
  }
  return parsed;
}

function toDateString(value: Date): string {
  return value.toISOString();
}

@Injectable()
export class BuffService {
  public constructor(
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(buffRepositoryToken) private readonly buffRepository: BuffRepository,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
  ) {}

  public async use(
    request: FastifyRequest,
    characterId: string,
    body: unknown,
  ): Promise<BuffUseResponse> {
    const parsed = parseRequest(body);
    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'BUFF_USE',
      request: body,
      execute: async ({ client, settlement, settlementState }) => {
        void settlementState;
        const stateRow = await this.loadCharacterState(client, characterId);
        if (!stateRow) {
          throw notFound();
        }

        if (stateRow.state_version !== parsed.expectedStateVersion.toString()) {
          throw conflict('expected_state_version');
        }

        const buffConfig = this.configRegistry.getBuffBySourceItemId(parsed.itemId);
        const realm = this.configRegistry.getRealm(stateRow.realm_stage_id);
        if (parsed.targetSlotIndex > realm.medicine_slots) {
          throw badRequest('target_slot_index_OUT_OF_RANGE');
        }

        const activeBuffs = await this.buffRepository.lockActiveBuffs(
          client,
          characterId,
          new Date(settlement.effective_until),
        );
        const targetBuff = activeBuffs.find((buff) => buff.slotIndex === parsed.targetSlotIndex);
        if (targetBuff && buffConfig.stack_rule !== 'REPLACE') {
          throw conflict('target_slot_occupied');
        }

        const replacedBuffIds = new Set<string>();
        if (buffConfig.stack_rule === 'REPLACE') {
          for (const buff of activeBuffs) {
            if (buff.stackGroup === buffConfig.stack_group) {
              replacedBuffIds.add(buff.id);
            }
          }
        }
        if (targetBuff) {
          replacedBuffIds.add(targetBuff.id);
        }

        let replacedBuffInstanceId: string | null = null;
        for (const buffId of replacedBuffIds) {
          const deleted = await client.query<{ id: string }>(
            `DELETE FROM buff_instances
              WHERE id = $1 AND character_id = $2
              RETURNING id`,
            [buffId, characterId],
          );
          if (deleted.rows[0] && replacedBuffInstanceId === null) {
            replacedBuffInstanceId = deleted.rows[0].id;
          }
        }

        const startedAt = new Date(settlement.effective_until);
        const expiresAt = new Date(startedAt.getTime() + buffConfig.duration_seconds * 1000);
        const assetMutation = await this.assetRepository.deductOnTransaction(client, {
          characterId,
          reasonCode: 'BUFF_USE',
          referenceType: 'BUFF_USE',
          referenceId: settlement.settlement_id,
          configVersion: this.configRegistry.manifest.config_version,
          assetType: 'ITEM',
          assetId: parsed.itemId,
          quantity: parsed.quantity.toString(),
        });

        const buffRow = await client.query<{
          id: string;
          character_id: string;
          buff_config_id: string;
          slot_index: number;
          stack_group: string;
          started_at: Date;
          expires_at: Date;
        }>(
          `INSERT INTO buff_instances
            (character_id, buff_config_id, slot_index, stack_group,
             started_at, expires_at, source_transaction_id, config_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, character_id, buff_config_id, slot_index, stack_group,
                     started_at, expires_at`,
          [
            characterId,
            buffConfig.id,
            parsed.targetSlotIndex,
            buffConfig.stack_group,
            startedAt,
            expiresAt,
            assetMutation.transactionId,
            this.configRegistry.manifest.config_version,
          ],
        );
        const inserted = buffRow.rows[0];
        if (!inserted) {
          throw new Error('BUFF_INSTANCE_CREATE_FAILED');
        }

        const updatedState = await client.query<{ state_version: string }>(
          `UPDATE characters
              SET state_version = state_version + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND state_version::text = $2
            RETURNING state_version::text AS state_version`,
          [characterId, stateRow.state_version],
        );
        const nextStateVersion = updatedState.rows[0]?.state_version;
        if (!nextStateVersion) {
          throw conflict('state_version_changed');
        }

        return {
          statusCode: 200,
          response: {
            character_id: characterId,
            item_id: parsed.itemId,
            quantity: parsed.quantity.toString(),
            target_slot_index: parsed.targetSlotIndex,
            buff_instance: {
              buff_instance_id: inserted.id,
              buff_config_id: buffConfig.id,
              source_item_id: buffConfig.source_item_id,
              slot_index: inserted.slot_index,
              stack_group: inserted.stack_group,
              started_at: toDateString(inserted.started_at),
              expires_at: toDateString(inserted.expires_at),
            },
            replaced_buff_instance_id: replacedBuffInstanceId,
            effective_next_cycle: true,
            state_version: toStateVersionNumber(nextStateVersion),
          },
          transactionId: assetMutation.transactionId,
          outboxEvents: [
            {
              eventType: 'BUFF_USED',
              aggregateType: 'CHARACTER',
              aggregateId: characterId,
              payload: {
                character_id: characterId,
                item_id: parsed.itemId,
                quantity: parsed.quantity.toString(),
                target_slot_index: parsed.targetSlotIndex,
                buff_instance_id: inserted.id,
                buff_config_id: buffConfig.id,
                source_item_id: buffConfig.source_item_id,
                started_at: toDateString(inserted.started_at),
                expires_at: toDateString(inserted.expires_at),
                replaced_buff_instance_id: replacedBuffInstanceId,
                effective_next_cycle: true,
                state_version: toStateVersionNumber(nextStateVersion),
              },
            },
          ],
        };
      },
    });
    return result.response;
  }

  private async loadCharacterState(
    client: PoolClient,
    characterId: string,
  ): Promise<CharacterStateRow | null> {
    const result = await client.query<CharacterStateRow>(
      `SELECT c.state_version::text AS state_version,
              cp.realm_stage_id
         FROM characters c
         INNER JOIN character_progression cp ON cp.character_id = c.id
        WHERE c.id = $1
        FOR UPDATE`,
      [characterId],
    );
    return result.rows[0] ?? null;
  }
}
