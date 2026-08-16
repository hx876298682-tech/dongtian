import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type {
  ActionConfig,
  ConfigRegistry,
} from '@dongtian/config-schema';
import {
  QueueNotFoundError,
  QueueVersionConflictError,
  QueueWriteConflictError,
  type AssetRepository,
  type CharacterProgressionRecord,
  type CharacterRepository,
  type InventorySnapshot,
  type JsonValue,
  type QueueEntryRecord,
  type QueueEntryWrite,
  type QueueMode as DatabaseQueueMode,
  type QueueRecord,
  type QueueRepository,
} from '@dongtian/database';
import {
  decimal,
  type BlockedPolicy,
  type QueueEntryDraft,
  type QueueInventoryConditionOperator,
  type QueueMode,
  type SupportedQueueMode,
  formatBlockedMaterialReason,
  isQueueInventoryConditionSatisfied,
  validateQueuePlan,
} from '@dongtian/game-rules';

import { AuthService } from '../auth/auth.service.js';
import { characterRepositoryToken } from '../character/character.tokens.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { SettlementService } from '../settlement/settlement.service.js';
import { queueRepositoryToken } from './queue.tokens.js';

type JsonRecord = Record<string, unknown>;
type JsonObject = { readonly [key: string]: JsonValue };

type ParsedQueueEntry = QueueEntryDraft & {
  readonly conditionItemId?: string;
  readonly conditionOperator?: QueueInventoryConditionOperator;
};

type ParsedQueueRequest = {
  readonly expectedQueueVersion: bigint;
  readonly entries: readonly ParsedQueueEntry[];
  readonly fallbackActionId: string;
};

type QueueContext = {
  readonly accountId: string;
  readonly character: CharacterProgressionRecord;
  readonly maxSlots: number;
  readonly supportsInventoryConditions: boolean;
  readonly offlineCapSeconds: number;
  readonly configVersion: string;
  readonly actions: ReadonlyMap<string, ActionConfig>;
  readonly allowedModesByActionId: ReadonlyMap<string, ReadonlySet<SupportedQueueMode>>;
};

type QueueClient = Parameters<QueueRepository['lockQueue']>[0];
type QueueEntryLike = {
  readonly mode: QueueMode;
  readonly targetValue?: string | null;
};

type QueueEntryInventoryConditionLike = {
  readonly mode: QueueMode;
  readonly targetValue?: string | null;
  readonly conditionItemId?: string | null;
  readonly conditionOperator?: string | null;
};

const QUEUE_ENTRY_BUSINESS_TYPE = 'ACTION_QUEUE_ENTRY';
const QUEUE_ENTRY_RESERVE_REASON = 'QUEUE_QUEUE_ENTRY_RESERVE';
const QUEUE_ENTRY_RELEASE_REASON = 'QUEUE_QUEUE_ENTRY_RELEASE';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(reason: string): BadRequestException {
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

function featureLocked(): ForbiddenException {
  return new ForbiddenException({
    code: 'FEATURE_LOCKED',
    message_key: 'error.feature_locked',
  });
}

function requiredString(record: JsonRecord, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidRequest(`${field}_REQUIRED`);
  }
  return value;
}

function optionalString(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidRequest(`${field}_INVALID`);
  }
  return value;
}

function scalarString(record: JsonRecord, field: string): string {
  const value = record[field];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw invalidRequest(`${field}_INVALID`);
}

function nonNegativeVersion(record: JsonRecord): bigint {
  const value = record['expected_queue_version'];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  throw invalidRequest('expected_queue_version_INVALID');
}

function comparePositiveIntegerStrings(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length > right.length ? 1 : -1;
  }
  if (left === right) {
    return 0;
  }
  return left > right ? 1 : -1;
}

function comparePositiveDecimalToIntegerLimit(value: string, limit: string): number {
  const [integerPart = '0', fractionPart = ''] = value.split('.');
  const integerCompare = comparePositiveIntegerStrings(integerPart, limit);
  if (integerCompare !== 0) {
    return integerCompare;
  }
  return /^0*$/.test(fractionPart) ? 0 : 1;
}

function maxCountCycles(action: ActionConfig, offlineCapSeconds: number): bigint {
  return BigInt(offlineCapSeconds) * 1_000_000n / BigInt(action.base_duration_us);
}

function validateQueueTargetSafety(
  entry: ParsedQueueEntry,
  action: ActionConfig,
  offlineCapSeconds: number,
): void {
  if (entry.mode === 'COUNT') {
    const targetValue = entry.targetValue;
    if (targetValue === undefined) {
      return;
    }
    const maxCycles = maxCountCycles(action, offlineCapSeconds);
    if (maxCycles < 1n) {
      throw invalidRequest('COUNT_TARGET_TOO_LARGE');
    }
    const maxCyclesText = maxCycles.toString();
    if (targetValue.length > maxCyclesText.length || (targetValue.length === maxCyclesText.length && targetValue > maxCyclesText)) {
      throw invalidRequest('COUNT_TARGET_TOO_LARGE');
    }
    return;
  }

  if (entry.mode === 'DURATION') {
    const targetValue = entry.targetValue;
    if (targetValue === undefined) {
      return;
    }
    const limitText = String(offlineCapSeconds);
    if (comparePositiveDecimalToIntegerLimit(targetValue, limitText) > 0) {
      throw invalidRequest('DURATION_TARGET_TOO_LARGE');
    }
  }
}

function validateInventoryConditionFields(
  entry: ParsedQueueEntry,
  configRegistry: ConfigRegistry,
): void {
  if (entry.mode === 'UNTIL_INVENTORY') {
    if (entry.conditionItemId === undefined) {
      throw invalidRequest('condition_item_id_REQUIRED');
    }
    if (entry.conditionOperator === undefined) {
      throw invalidRequest('condition_operator_REQUIRED');
    }
    if (entry.conditionOperator !== '<' && entry.conditionOperator !== '>=') {
      throw invalidRequest('condition_operator_INVALID');
    }
    try {
      configRegistry.getItem(entry.conditionItemId);
    } catch {
      throw invalidRequest('condition_item_id_INVALID');
    }
    return;
  }

  if (entry.conditionItemId !== undefined) {
    throw invalidRequest('condition_item_id_FORBIDDEN_FOR_MODE');
  }
  if (entry.conditionOperator !== undefined) {
    throw invalidRequest('condition_operator_FORBIDDEN_FOR_MODE');
  }
}

function parseRequest(body: unknown): ParsedQueueRequest {
  if (!isRecord(body)) {
    throw invalidRequest('BODY_INVALID');
  }
  const entriesValue = body['entries'];
  if (!Array.isArray(entriesValue)) {
    throw invalidRequest('entries_REQUIRED');
  }
  const fallbackValue = body['fallback'];
  if (!isRecord(fallbackValue)) {
    throw invalidRequest('fallback_REQUIRED');
  }
  const fallbackMode = requiredString(fallbackValue, 'mode');
  if (fallbackMode !== 'INFINITE') {
    throw invalidRequest('fallback_mode_MUST_BE_INFINITE');
  }

  const entries = entriesValue.map((value, index): ParsedQueueEntry => {
    if (!isRecord(value)) {
      throw invalidRequest(`entries.${index}_INVALID`);
    }
    const mode = requiredString(value, 'mode');
    if (!['COUNT', 'DURATION', 'UNTIL_INVENTORY', 'INFINITE'].includes(mode)) {
      throw invalidRequest(`entries.${index}.mode_INVALID`);
    }
    const onBlocked = requiredString(value, 'on_blocked');
    if (onBlocked !== 'SKIP' && onBlocked !== 'FALLBACK') {
      throw invalidRequest(`entries.${index}.on_blocked_INVALID`);
    }
    const targetValue = value['target_value'] === undefined
      ? undefined
      : scalarString(value, 'target_value');
    const conditionItemId = optionalString(value, 'condition_item_id');
    const conditionOperator = optionalString(value, 'condition_operator') as QueueInventoryConditionOperator | undefined;
    return {
      clientEntryId: requiredString(value, 'client_entry_id'),
      actionConfigId: requiredString(value, 'action_id'),
      mode: mode as QueueMode,
      onBlocked: onBlocked as BlockedPolicy,
      ...(targetValue === undefined ? {} : { targetValue }),
      ...(conditionItemId === undefined ? {} : { conditionItemId }),
      ...(conditionOperator === undefined ? {} : { conditionOperator }),
    };
  });

  return {
    expectedQueueVersion: nonNegativeVersion(body),
    entries,
    fallbackActionId: requiredString(fallbackValue, 'action_id'),
  };
}

function safeVersion(value: bigint): number | string {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function finiteDecimal(value: string): string {
  return decimal(value).toString();
}

function countCycles(entry: QueueEntryLike, action: ActionConfig): bigint | null {
  if (entry.mode === 'INFINITE') {
    return null;
  }
  if (entry.mode === 'COUNT') {
    return BigInt(entry.targetValue ?? '0');
  }
  if (entry.mode === 'DURATION') {
    const durationUs = decimal(entry.targetValue ?? '0').multiply('1000000');
    return BigInt(durationUs.divide(action.base_duration_us).round(0, 'FLOOR').toString());
  }
  return null;
}

function requiredInputs(
  entry: QueueEntryLike,
  action: ActionConfig,
): {
  readonly cycles: bigint | null;
  readonly requirements: readonly { readonly itemId: string; readonly quantity: bigint }[];
} {
  const cycles = countCycles(entry, action);
  if (cycles === null) {
    return { cycles, requirements: [] };
  }
  return {
    cycles,
    requirements: action.inputs.map((input) => ({
      itemId: input.item_id,
      quantity: BigInt(input.quantity) * cycles,
    })),
  };
}

function inventoryAvailableByItem(inventory: InventorySnapshot): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const item of inventory.items) {
    result.set(item.assetId, BigInt(item.availableQuantity));
  }
  return result;
}

function activeReservationsByItem(
  reservations: readonly { readonly assetId: string; readonly quantity: string }[],
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const reservation of reservations) {
    const current = result.get(reservation.assetId) ?? 0n;
    result.set(reservation.assetId, current + BigInt(reservation.quantity));
  }
  return result;
}

function inventoryConditionSatisfied(
  entry: QueueEntryInventoryConditionLike,
  availableByItem: ReadonlyMap<string, bigint>,
): boolean {
  if (entry.mode !== 'UNTIL_INVENTORY') {
    return false;
  }
  const conditionItemId = entry.conditionItemId;
  const conditionOperator = entry.conditionOperator;
  const targetValue = entry.targetValue;
  if (conditionItemId == null || conditionOperator == null || targetValue == null) {
    return false;
  }
  if (conditionOperator !== '<' && conditionOperator !== '>=') {
    return false;
  }
  return isQueueInventoryConditionSatisfied(availableByItem.get(conditionItemId) ?? 0n, {
    itemId: conditionItemId,
    operator: conditionOperator,
    targetValue,
  });
}

function durationEstimate(entry: ParsedQueueEntry, action: ActionConfig): {
  readonly cycles: bigint | null;
  readonly durationUs: string | null;
} {
  if (entry.mode === 'INFINITE') {
    return { cycles: null, durationUs: null };
  }
  if (entry.mode === 'UNTIL_INVENTORY') {
    return { cycles: null, durationUs: null };
  }
  if (entry.mode === 'COUNT') {
    const cycles = BigInt(entry.targetValue ?? '0');
    return {
      cycles,
      durationUs: decimal(action.base_duration_us).multiply(cycles).toString(),
    };
  }
  if (entry.mode === 'DURATION') {
    const durationUs = decimal(entry.targetValue ?? '0').multiply('1000000');
    const cycles = BigInt(durationUs.divide(action.base_duration_us).round(0, 'FLOOR').toString());
    return { cycles, durationUs: durationUs.toString() };
  }
  return { cycles: null, durationUs: null };
}

function itemAvailable(inventory: InventorySnapshot, itemId: string): bigint {
  const balance = inventory.items.find((item) => item.assetId === itemId);
  return balance === undefined ? 0n : BigInt(balance.availableQuantity);
}

function estimateEntry(
  entry: ParsedQueueEntry,
  action: ActionConfig,
  inventory: InventorySnapshot,
): JsonObject {
  const availableByItem = inventoryAvailableByItem(inventory);
  const conditionSatisfied = inventoryConditionSatisfied(entry, availableByItem);
  const estimate = entry.mode === 'UNTIL_INVENTORY' && conditionSatisfied
    ? { cycles: 0n, durationUs: '0' }
    : durationEstimate(entry, action);
  const cycles = estimate.cycles;
  const outputs = cycles === null
    ? null
    : Object.fromEntries(action.outputs.map((output) => [
      output.item_id,
      decimal(output.quantity).multiply(cycles).toString(),
    ]));
  const shortages = cycles === null
    ? []
    : action.inputs.flatMap((input) => {
      const required = BigInt(input.quantity) * cycles;
      const available = itemAvailable(inventory, input.item_id);
      const shortfall = required > available ? required - available : 0n;
      return shortfall === 0n
        ? []
        : [{
            item_id: input.item_id,
            required: required.toString(),
            available: available.toString(),
            shortfall: shortfall.toString(),
          }];
    });
  return {
    client_entry_id: entry.clientEntryId,
    action_id: entry.actionConfigId,
    mode: entry.mode,
    target_value: entry.targetValue ?? null,
    estimated_cycles: estimate.cycles === null ? null : estimate.cycles.toString(),
    estimated_duration_us: estimate.durationUs,
    estimated_outputs: outputs,
    input_shortages: shortages,
  };
}

function mapEntry(entry: QueueEntryRecord): JsonObject {
  return {
    entry_id: entry.id,
    client_entry_id: entry.clientEntryId,
    position: entry.position,
    action_id: entry.actionConfigId,
    mode: entry.mode,
    target_value: entry.targetValue,
    condition_item_id: entry.conditionItemId,
    condition_operator: entry.conditionOperator,
    on_blocked: entry.onBlocked,
    status: entry.status,
    completed_cycles: entry.completedCycles.toString(),
    progress_time_us: entry.progressTimeUs.toString(),
    blocked_reason: entry.blockedReason,
    snapshot_config_version: entry.snapshotConfigVersion,
  };
}

function mapQueue(queue: QueueRecord): JsonObject {
  const current = queue.entries.find((entry) => entry.status === 'RUNNING' || entry.status === 'BLOCKED') ?? null;
  return {
    queue_version: safeVersion(queue.queueVersion),
    paused: queue.paused,
    pending_replace_after_cycle: queue.pendingReplaceAfterCycle,
    fallback: { action_id: queue.fallbackActionId, mode: 'INFINITE' },
    current: current === null
      ? null
      : {
          ...mapEntry(current),
          cycle_progress: {
            completed_cycles: current.completedCycles.toString(),
            progress_time_us: current.progressTimeUs.toString(),
          },
        },
    entries: queue.entries.map(mapEntry),
    as_of: new Date().toISOString(),
  };
}

function mapMutation(queue: QueueRecord): JsonObject {
  return {
    queue_version: safeVersion(queue.queueVersion),
    effective_at: 'current_cycle_boundary',
    pending_replace_after_cycle: queue.pendingReplaceAfterCycle,
    paused: queue.paused,
    queue: mapQueue(queue),
  };
}

@Injectable()
export class QueueService {
  public constructor(
    @Inject(queueRepositoryToken) private readonly repository: QueueRepository,
    @Inject(characterRepositoryToken) private readonly characterRepository: CharacterRepository,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
  ) {}

  public async getQueue(request: FastifyRequest, characterId: string): Promise<JsonObject> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    await this.requireContext(characterId, accountId);
    const queue = await this.repository.getQueue(characterId);
    if (queue === null) {
      throw notFound();
    }
    return mapQueue(queue);
  }

  public async preview(
    request: FastifyRequest,
    characterId: string,
    body: unknown,
  ): Promise<JsonObject> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const context = await this.requireContext(characterId, accountId);
    try {
      const parsed = parseRequest(body);
      const normalized = this.validatePlan(context, parsed);
      const currentQueue = await this.repository.getQueue(characterId);
      const actualVersion = currentQueue?.queueVersion ?? 0n;
      if (actualVersion !== parsed.expectedQueueVersion) {
        throw new QueueVersionConflictError(actualVersion);
      }
      const inventory = await this.assetRepository.getInventory(characterId, accountId);
      if (inventory === null) {
        throw notFound();
      }
      const estimates = normalized.entries.map((entry) => {
        const source = parsed.entries[entry.position];
        if (source === undefined) {
          throw new Error('QUEUE_PREVIEW_ENTRY_NOT_FOUND');
        }
        return estimateEntry(source, context.actions.get(entry.actionConfigId)!, inventory);
      });
      const finiteDurations = estimates
        .map((estimate) => estimate['estimated_duration_us'])
        .filter((value): value is string => typeof value === 'string');
      const totalDurationUs = estimates.some((estimate) => estimate['estimated_duration_us'] === null)
        ? null
        : finiteDurations.reduce((total, value) => decimal(total).add(value).toString(), '0');
      return {
        queue_version: safeVersion(actualVersion),
        expected_queue_version: safeVersion(parsed.expectedQueueVersion),
        entries: estimates,
        fallback: { action_id: parsed.fallbackActionId, mode: 'INFINITE' },
        total_duration_us: totalDurationUs,
        warnings: estimates.flatMap((estimate) => {
          if ((estimate['input_shortages'] as readonly unknown[]).length === 0) {
            return [];
          }
          const clientEntryId = estimate['client_entry_id'];
          return [{
            ...(typeof clientEntryId === 'string' ? { client_entry_id: clientEntryId } : {}),
            code: 'INPUT_SHORTAGE',
          }];
        }),
        calculation_as_of: new Date().toISOString(),
        config_version: this.configRegistry.manifest.config_version,
      };
    } catch (error) {
      throw this.toHttpError(error, undefined);
    }
  }

  public async save(request: FastifyRequest, characterId: string, body: unknown): Promise<JsonObject> {
    const accountId = await this.authService.requireWriteAccess(request);
    const context = await this.requireContext(characterId, accountId);
    const parsed = parseRequest(body);
    const normalized = this.validatePlan(context, parsed);
    try {
      const result = await this.executeSettledQueueWrite(request, characterId, 'QUEUE_SAVE', body, async ({ client }) => {
        const queue = await this.saveQueuePlan(client, context, characterId, parsed, normalized);
        return {
          statusCode: 200,
          response: mapMutation(queue),
        };
      });
      return result.response;
    } catch (error) {
      throw this.toHttpError(error, parsed.expectedQueueVersion);
    }
  }

  public pause(request: FastifyRequest, characterId: string, body: unknown): Promise<JsonObject> {
    return this.setPaused(request, characterId, body, true);
  }

  public resume(request: FastifyRequest, characterId: string, body: unknown): Promise<JsonObject> {
    return this.setPaused(request, characterId, body, false);
  }

  private async setPaused(
    request: FastifyRequest,
    characterId: string,
    body: unknown,
    paused: boolean,
  ): Promise<JsonObject> {
    const accountId = await this.authService.requireWriteAccess(request);
    const context = await this.requireContext(characterId, accountId);
    if (!isRecord(body)) {
      throw invalidRequest('BODY_INVALID');
    }
    const expectedQueueVersion = nonNegativeVersion(body);
    try {
      const result = await this.executeSettledQueueWrite(
        request,
        characterId,
        paused ? 'QUEUE_PAUSE' : 'QUEUE_RESUME',
        body,
        async ({ client }) => {
          const queue = await this.repository.setPaused(client, {
            characterId,
            expectedQueueVersion,
            paused,
          });
          const reconciledQueue = paused
            ? queue
            : await this.reconcileQueueReservations(client, context, queue);
          return {
            statusCode: 200,
            response: mapMutation(reconciledQueue),
          };
        },
      );
      return result.response;
    } catch (error) {
      throw this.toHttpError(error, expectedQueueVersion);
    }
  }

  private async executeSettledQueueWrite<T extends JsonValue>(
    request: FastifyRequest,
    characterId: string,
    operationType: 'QUEUE_SAVE' | 'QUEUE_PAUSE' | 'QUEUE_RESUME',
    body: unknown,
    handler: (context: {
      readonly client: QueueClient;
      readonly settlement: unknown;
      readonly settlementState: { readonly continuationRequired: boolean };
      readonly requestHash: string;
    }) => Promise<{ readonly statusCode: number; readonly response: T }>,
  ): Promise<{ readonly statusCode: number; readonly response: T }> {
    return this.settlementService.executeSettledWrite<T>(request, characterId, {
      operationType,
      request: body,
      execute: async (context) => {
        if (context.settlementState.continuationRequired) {
          throw new QueueWriteConflictError('SETTLEMENT_CONTINUATION_IN_PROGRESS');
        }
        return handler(context);
      },
    });
  }

  private async saveQueuePlan(
    client: QueueClient,
    context: QueueContext,
    characterId: string,
    parsed: ParsedQueueRequest,
    normalized: ReturnType<typeof validateQueuePlan>,
  ): Promise<QueueRecord> {
    const currentQueue = await this.repository.lockQueue(client, characterId);
    const actualVersion = currentQueue?.queueVersion ?? 0n;
    if (actualVersion !== parsed.expectedQueueVersion) {
      throw new QueueVersionConflictError(actualVersion);
    }
    if (currentQueue !== null) {
      const removedEntries = currentQueue.entries.filter((entry) => entry.status === 'QUEUED' || entry.status === 'BLOCKED');
      await this.releaseQueueEntryReservations(client, context, removedEntries);
    }

    const queue = await this.repository.replaceQueue(client, {
      characterId,
      expectedQueueVersion: parsed.expectedQueueVersion,
      fallbackActionId: parsed.fallbackActionId,
      entries: this.toWrites(normalized.entries, parsed.entries),
    });

    return this.reconcileQueueReservations(client, context, queue);
  }

  private async releaseQueueEntryReservations(
    client: QueueClient,
    context: QueueContext,
    entries: readonly QueueEntryRecord[],
    availableByItem?: Map<string, bigint>,
  ): Promise<void> {
    for (const entry of entries) {
      const reservations = await this.assetRepository.findActiveReservationsByBusiness(client, {
        characterId: entry.characterId,
        businessType: QUEUE_ENTRY_BUSINESS_TYPE,
        businessId: entry.id,
      });
      for (const reservation of reservations) {
        await this.assetRepository.releaseOnTransaction(client, {
          characterId: entry.characterId,
          reasonCode: QUEUE_ENTRY_RELEASE_REASON,
          referenceType: 'ACTION_QUEUE_ENTRY',
          referenceId: entry.id,
          configVersion: context.configVersion,
          reservationId: reservation.reservationId,
        });
        if (availableByItem !== undefined) {
          const current = availableByItem.get(reservation.assetId) ?? 0n;
          availableByItem.set(reservation.assetId, current + BigInt(reservation.quantity));
        }
      }
    }
  }

  private async reconcileQueueReservations(
    client: QueueClient,
    context: QueueContext,
    queue: QueueRecord,
  ): Promise<QueueRecord> {
    let blockedFallbackActive = false;
    let currentQueue = queue;
    const inventory = await this.assetRepository.getInventoryOnTransaction(client, queue.characterId, context.accountId);
    if (inventory === null) {
      throw notFound();
    }
    const availableByItem = inventoryAvailableByItem(inventory);
    for (const entry of [...queue.entries].sort((left, right) => left.position - right.position)) {
      if (entry.status !== 'QUEUED' && entry.status !== 'BLOCKED') {
        continue;
      }

      const action = context.actions.get(entry.actionConfigId);
      if (action === undefined) {
        throw new Error(`QUEUE_ACTION_NOT_FOUND:${entry.actionConfigId}`);
      }

      const existingReservations = await this.assetRepository.findActiveReservationsByBusiness(client, {
        characterId: queue.characterId,
        businessType: QUEUE_ENTRY_BUSINESS_TYPE,
        businessId: entry.id,
      });
      const reservedByItem = activeReservationsByItem(existingReservations);

      if (blockedFallbackActive && existingReservations.length === 0) {
        continue;
      }

      if (inventoryConditionSatisfied(entry, availableByItem)) {
        if (existingReservations.length > 0) {
          await this.releaseQueueEntryReservations(client, context, [entry], availableByItem);
        }
        currentQueue = await this.repository.setEntryStatus(client, {
          characterId: queue.characterId,
          entryId: entry.id,
          status: 'DONE_CONDITION_MET',
          blockedReason: null,
        });
        blockedFallbackActive = false;
        continue;
      }

      const required = requiredInputs(entry, action);
      if (required.requirements.length === 0) {
        if (entry.status === 'BLOCKED' && entry.blockedReason !== null) {
          currentQueue = await this.repository.setEntryStatus(client, {
            characterId: queue.characterId,
            entryId: entry.id,
            status: 'QUEUED',
            blockedReason: null,
          });
        }
        continue;
      }

      let blockedReason: string | null = null;
      let fullyReserved = true;
      for (const requirement of required.requirements) {
        const alreadyReserved = reservedByItem.get(requirement.itemId) ?? 0n;
        const remaining = requirement.quantity - alreadyReserved;
        if (remaining <= 0n) {
          continue;
        }

        const available = availableByItem.get(requirement.itemId) ?? 0n;
        if (available > 0n) {
          const reserveQuantity = available < remaining ? available : remaining;
          await this.assetRepository.reserveOnTransaction(client, {
            characterId: queue.characterId,
            assetType: 'ITEM',
            assetId: requirement.itemId,
            quantity: reserveQuantity.toString(),
            businessType: QUEUE_ENTRY_BUSINESS_TYPE,
            businessId: entry.id,
            reasonCode: QUEUE_ENTRY_RESERVE_REASON,
            referenceType: 'ACTION_QUEUE_ENTRY',
            referenceId: entry.id,
            configVersion: context.configVersion,
          });
          availableByItem.set(requirement.itemId, available - reserveQuantity);
          const nextReserved = alreadyReserved + reserveQuantity;
          reservedByItem.set(requirement.itemId, nextReserved);
        }

        const totalReserved = reservedByItem.get(requirement.itemId) ?? 0n;
        if (totalReserved < requirement.quantity) {
          fullyReserved = false;
          if (blockedReason === null) {
            const shortfall = requirement.quantity - totalReserved;
            blockedReason = formatBlockedMaterialReason({
              itemId: requirement.itemId,
              required: requirement.quantity.toString(),
              available: totalReserved.toString(),
              shortfall: shortfall.toString(),
            });
          }
        }
      }

      if (fullyReserved) {
        if (entry.status === 'BLOCKED' || entry.blockedReason !== null) {
          currentQueue = await this.repository.setEntryStatus(client, {
            characterId: queue.characterId,
            entryId: entry.id,
            status: 'QUEUED',
            blockedReason: null,
          });
        }
        blockedFallbackActive = false;
        continue;
      }

      currentQueue = await this.repository.setEntryStatus(client, {
        characterId: queue.characterId,
        entryId: entry.id,
        status: 'BLOCKED',
        blockedReason,
      });
      if (entry.onBlocked === 'FALLBACK') {
        blockedFallbackActive = true;
      }
    }

    return currentQueue;
  }

  private async requireContext(characterId: string, accountId: string): Promise<QueueContext> {
    const character = await this.characterRepository.getProgression(characterId, accountId);
    if (character === null) {
      throw notFound();
    }
    const realm = this.configRegistry.getRealm(character.realmStageId);
    const actions = new Map<string, ActionConfig>();
    const allowedModes = new Map<string, ReadonlySet<SupportedQueueMode>>();
    for (const action of this.configRegistry.actions) {
      const actionRealm = this.configRegistry.getRealm(action.realm_required);
      if (!action.enabled || action.deprecated || realm.stage_order < actionRealm.stage_order) {
        continue;
      }
      actions.set(action.id, action);
      allowedModes.set(action.id, new Set(action.allowed_queue_modes));
    }
    return {
      accountId,
      character,
      maxSlots: realm.queue_slots,
      supportsInventoryConditions: realm.queue_slots >= 3,
      offlineCapSeconds: realm.offline_cap_seconds,
      configVersion: this.configRegistry.manifest.config_version,
      actions,
      allowedModesByActionId: allowedModes,
    };
  }

  private validatePlan(context: QueueContext, request: ParsedQueueRequest) {
    try {
      if (request.entries.some((entry) => entry.mode === 'UNTIL_INVENTORY') && !context.supportsInventoryConditions) {
        throw featureLocked();
      }
      for (const entry of request.entries) {
        validateInventoryConditionFields(entry, this.configRegistry);
        const action = context.actions.get(entry.actionConfigId);
        if (action !== undefined) {
          validateQueueTargetSafety(entry, action, context.offlineCapSeconds);
        }
      }
      return validateQueuePlan({
        plan: { fallbackActionId: request.fallbackActionId, entries: request.entries },
        maxSlots: context.maxSlots,
        availableActionIds: new Set(context.actions.keys()),
        allowedModesByActionId: context.allowedModesByActionId,
      });
    } catch (error) {
      throw this.toHttpError(error, request.expectedQueueVersion);
    }
  }

  private toWrites(
    entries: readonly (QueueEntryDraft & { readonly position: number })[],
    sourceEntries: readonly ParsedQueueEntry[],
  ): readonly QueueEntryWrite[] {
    return entries.map((entry) => {
      const source = sourceEntries[entry.position];
      if (source === undefined) {
        throw new Error('QUEUE_WRITE_ENTRY_NOT_FOUND');
      }
      return {
        clientEntryId: entry.clientEntryId,
        position: entry.position,
        actionConfigId: entry.actionConfigId,
        mode: entry.mode as DatabaseQueueMode,
        onBlocked: entry.onBlocked,
        configVersion: this.configRegistry.manifest.config_version,
        ...(entry.targetValue === undefined ? {} : { targetValue: finiteDecimal(entry.targetValue) }),
        ...(source.conditionItemId === undefined ? {} : { conditionItemId: source.conditionItemId }),
        ...(source.conditionOperator === undefined ? {} : { conditionOperator: source.conditionOperator }),
      };
    });
  }

  private toHttpError(error: unknown, expectedVersion: bigint | undefined): Error {
    if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException) {
      return error;
    }
    if (error instanceof QueueVersionConflictError) {
      return new ConflictException({
        code: error.code,
        message_key: 'error.queue_version_conflict',
        details: {
          ...(expectedVersion === undefined ? {} : { expected: safeVersion(expectedVersion) }),
          actual: safeVersion(error.actualVersion),
        },
      });
    }
    if (error instanceof QueueNotFoundError) {
      return notFound();
    }
    if (error instanceof QueueWriteConflictError) {
      return new ConflictException({
        code: error.code,
        message_key: `error.${error.code.toLowerCase()}`,
      });
    }
    if (error instanceof Error && error.message.startsWith('QUEUE_VALIDATION_FAILED:')) {
      return invalidRequest(error.message.slice('QUEUE_VALIDATION_FAILED:'.length));
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
