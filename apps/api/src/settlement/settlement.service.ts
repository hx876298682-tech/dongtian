import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type {
  ActionConfig,
  ConfigRegistry,
  Environment,
} from '@dongtian/config-schema';
import {
  checkpointSegments,
  applyBuffsToActionSnapshot,
  addMicroseconds,
  decimal,
  microseconds,
  isQueueInventoryConditionSatisfied,
  settleSingleAction,
  type SettlementBuffEffect,
  type SettlementActionSnapshot,
  type SettlementSegment,
  type SingleActionSettlementInput,
  type SingleActionSettlementResult,
} from '@dongtian/game-rules';
import type {
  AssetRepository,
  BuffRepository,
  BuffInstanceRecord,
  DatabasePool,
  JsonValue,
  PoolClient,
  SettlementJson,
  SettlementPersistenceInput,
  SettlementSummaryRecord,
  SettlementRepository,
  SettlementSegmentRecord,
  SettlementSkillProgressionAward,
  SettlementStateRecord,
  QueueRepository,
  QueueEntryRecord,
} from '@dongtian/database';
import { environmentToken } from '../environment.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { buffRepositoryToken } from '../buff/buff.tokens.js';
import { settlementRepositoryToken } from './settlement.tokens.js';
import { queueRepositoryToken } from '../queue/queue.tokens.js';

type JsonRecord = Record<string, unknown>;

type SettlementSnapshotRecord = {
  readonly action_config_id: string;
  readonly config_version: string;
  readonly formula_version: number;
  readonly duration_us: string;
  readonly cultivation_xp_per_cycle: string;
  readonly skill_xp_per_cycle: string;
  readonly outputs: Readonly<Record<string, string>>;
};

type SettlementRunResponse = {
  readonly settlement_id: string;
  readonly character_id: string;
  readonly status: SingleActionSettlementResult['status'];
  readonly requested_until: string;
  readonly effective_until: string;
  readonly effective_time_us: string;
  readonly capped_time_us: string;
  readonly completed_cycles: string;
  readonly progress_time_us: string;
  readonly continuation_required: boolean;
  readonly applied_rewards: {
    readonly cultivation_xp: string;
    readonly skill_xp: string;
    readonly items: readonly {
      readonly item_id: string;
      readonly quantity: string;
    }[];
  };
  readonly segments: readonly SettlementSegmentRecord[];
};

type SettlementSummaryTimelineEntry = {
  readonly segment_index: number;
  readonly queue_entry_id: string | null;
  readonly action_config_id: string;
  readonly from_at: string;
  readonly to_at: string;
  readonly completed_cycles: string;
  readonly inputs: SettlementJson;
  readonly outputs: SettlementJson;
  readonly xp_changes: SettlementJson;
  readonly transition_reason: string | null;
  readonly snapshot: SettlementJson;
};

type SettlementSummaryLedgerEntry = {
  readonly entry_id: string;
  readonly transaction_id: string;
  readonly asset_type: string;
  readonly asset_id: string;
  readonly delta: string;
  readonly balance_after: string;
  readonly reason_code: string;
  readonly reference_type: string;
  readonly reference_id: string;
  readonly config_version: string;
  readonly created_at: string;
};

type SettlementSummaryResponse = {
  readonly settlement_id: string;
  readonly character_id: string;
  readonly as_of: string;
  readonly from_at: string;
  readonly requested_until: string;
  readonly effective_until: string;
  readonly effective_time_us: string;
  readonly capped_time_us: string;
  readonly continuation_required: boolean;
  readonly status: string;
  readonly summary: SettlementJson;
  readonly rewards: {
    readonly cultivation_xp: string;
    readonly skill_xp: string;
    readonly items: readonly {
      readonly item_id: string;
      readonly quantity: string;
    }[];
  };
  readonly timeline: readonly SettlementSummaryTimelineEntry[];
  readonly ledger_entries: readonly SettlementSummaryLedgerEntry[];
};

type IdempotentSettlementInput<T extends JsonValue> = {
  readonly operationType: string;
  readonly request: unknown;
  readonly segmentLimit?: number;
  readonly execute: (context: {
    readonly client: PoolClient;
    readonly settlement: SettlementRunResponse;
    readonly settlementState: SettlementStateRecord;
    readonly requestHash: string;
  }) => Promise<{
    readonly statusCode: number;
    readonly response: T;
    readonly transactionId?: string;
    readonly outboxEvents?: readonly {
      readonly eventType: string;
      readonly aggregateType: string;
      readonly aggregateId: string;
      readonly payload: JsonValue;
      readonly availableAt?: Date;
    }[];
  }>;
};

type SettlementPlan = {
  readonly state: SettlementStateRecord;
  readonly actionConfig: ActionConfig | null;
  readonly settlement: SingleActionSettlementResult;
  readonly continuationRequired: boolean;
  readonly itemRewards: readonly { readonly itemId: string; readonly quantity: string }[];
  readonly skillAwards: readonly SettlementSkillProgressionAward[];
  readonly persistence: SettlementPersistenceInput;
  readonly responseBase: Omit<SettlementRunResponse, 'settlement_id'>;
};

type QueueItemBalanceRow = {
  readonly item_id: string;
  readonly available_quantity: string;
};

type QueueTransition = {
  readonly activeQueueEntryId: string | null;
  readonly activeCycleSnapshot: SettlementJson | null;
};

type SettlementSummaryEnvelope = {
  readonly settlement: SettlementSummaryResponse | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function settlementSummarySource(
  summary: SettlementJson,
): {
  readonly status: string;
  readonly requested_until_us: string;
  readonly effective_until_us: string;
  readonly effective_time_us: string;
  readonly capped_time_us: string;
  readonly completed_cycles: string;
  readonly progress_time_us: string;
  readonly continuation_required: boolean;
  readonly cultivation_xp: string;
  readonly skill_xp: string;
  readonly items: readonly { readonly item_id: string; readonly quantity: string }[];
} {
  if (!isRecord(summary)) {
    throw new Error('SETTLEMENT_SUMMARY_INVALID');
  }
  const requiredString = (field: string): string => {
    const value = summary[field];
    if (typeof value !== 'string') {
      throw new Error('SETTLEMENT_SUMMARY_INVALID');
    }
    return value;
  };
  const items = summary['items'];
  return {
    status: requiredString('status'),
    requested_until_us: requiredString('requested_until_us'),
    effective_until_us: requiredString('effective_until_us'),
    effective_time_us: requiredString('effective_time_us'),
    capped_time_us: requiredString('capped_time_us'),
    completed_cycles: requiredString('completed_cycles'),
    progress_time_us: requiredString('progress_time_us'),
    continuation_required: summary['continuation_required'] === true,
    cultivation_xp: requiredString('cultivation_xp'),
    skill_xp: requiredString('skill_xp'),
    items: Array.isArray(items)
      ? items.map((item) => {
          if (!isRecord(item) || typeof item['item_id'] !== 'string' || typeof item['quantity'] !== 'string') {
            throw new Error('SETTLEMENT_SUMMARY_INVALID');
          }
          return { item_id: item['item_id'], quantity: item['quantity'] };
        })
      : [],
  };
}

function mapSummary(record: SettlementSummaryRecord): SettlementSummaryResponse {
  const summary = settlementSummarySource(record.run.summary);
  return {
    settlement_id: record.run.settlementId,
    character_id: record.run.characterId,
    as_of: (record.run.completedAt ?? record.run.createdAt).toISOString(),
    from_at: record.run.fromAt.toISOString(),
    requested_until: record.run.requestedUntil.toISOString(),
    effective_until: record.run.effectiveUntil.toISOString(),
    effective_time_us: summary.effective_time_us,
    capped_time_us: summary.capped_time_us,
    continuation_required: summary.continuation_required,
    status: summary.status,
    summary: record.run.summary,
    rewards: {
      cultivation_xp: summary.cultivation_xp,
      skill_xp: summary.skill_xp,
      items: summary.items,
    },
    timeline: record.segments.map((segment) => ({
      segment_index: segment.segmentIndex,
      queue_entry_id: segment.queueEntryId ?? null,
      action_config_id: segment.actionConfigId,
      from_at: segment.fromAt.toISOString(),
      to_at: segment.toAt.toISOString(),
      completed_cycles: segment.completedCycles.toString(),
      inputs: segment.inputs,
      outputs: segment.outputs,
      xp_changes: segment.xpChanges,
      transition_reason: segment.transitionReason ?? null,
      snapshot: segment.snapshot,
    })),
    ledger_entries: record.ledgerEntries.map((ledger) => ({
      entry_id: ledger.entryId,
      transaction_id: ledger.transactionId,
      asset_type: ledger.assetType,
      asset_id: ledger.assetId,
      delta: ledger.delta,
      balance_after: ledger.balanceAfter,
      reason_code: ledger.reasonCode,
      reference_type: ledger.referenceType,
      reference_id: ledger.referenceId,
      config_version: ledger.configVersion,
      created_at: ledger.createdAt.toISOString(),
    })),
  };
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

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest('Idempotency-Key_REQUIRED');
  }
  return value;
}

function toMicroseconds(date: Date): bigint {
  return BigInt(date.getTime()) * 1_000n;
}

function fromMicroseconds(value: bigint): Date {
  return new Date(Number(value / 1_000n));
}

function snapshotFromJson(snapshot: SettlementJson | null): SettlementSnapshotRecord | null {
  if (!isRecord(snapshot)) {
    return null;
  }
  const actionConfigId = snapshot['action_config_id'];
  const configVersion = snapshot['config_version'];
  const formulaVersion = snapshot['formula_version'];
  const durationUs = snapshot['duration_us'];
  const cultivationXpPerCycle = snapshot['cultivation_xp_per_cycle'];
  const skillXpPerCycle = snapshot['skill_xp_per_cycle'];
  const outputsValue = snapshot['outputs'];
  if (
    typeof actionConfigId !== 'string' ||
    typeof configVersion !== 'string' ||
    typeof formulaVersion !== 'number' ||
    typeof durationUs !== 'string' ||
    typeof cultivationXpPerCycle !== 'string' ||
    typeof skillXpPerCycle !== 'string' ||
    !isRecord(outputsValue)
  ) {
    throw badRequest('SETTLEMENT_SNAPSHOT_INVALID');
  }
  const outputs: Record<string, string> = {};
  for (const [itemId, quantity] of Object.entries(outputsValue)) {
    if (typeof quantity !== 'string' || itemId.trim().length === 0 || quantity.trim().length === 0) {
      throw badRequest('SETTLEMENT_SNAPSHOT_INVALID');
    }
    outputs[itemId] = quantity;
  }
  return {
    action_config_id: actionConfigId,
    config_version: configVersion,
    formula_version: formulaVersion,
    duration_us: durationUs,
    cultivation_xp_per_cycle: cultivationXpPerCycle,
    skill_xp_per_cycle: skillXpPerCycle,
    outputs,
  };
}

function snapshotFromAction(action: ActionConfig, configVersion: string, formulaVersion: number): SettlementJson {
  return {
    action_config_id: action.id,
    config_version: configVersion,
    formula_version: formulaVersion,
    duration_us: action.base_duration_us,
    cultivation_xp_per_cycle: action.cultivation_xp,
    skill_xp_per_cycle: action.skill_xp,
    outputs: Object.fromEntries(action.outputs.map((output) => [output.item_id, output.quantity])),
  };
}

function toRulesSnapshot(snapshot: SettlementSnapshotRecord): SettlementActionSnapshot {
  return {
    actionConfigId: snapshot.action_config_id,
    configVersion: snapshot.config_version,
    formulaVersion: snapshot.formula_version,
    durationUs: microseconds(BigInt(snapshot.duration_us)),
    cultivationXpPerCycle: snapshot.cultivation_xp_per_cycle,
    skillXpPerCycle: snapshot.skill_xp_per_cycle,
    outputs: Object.entries(snapshot.outputs).map(([itemId, quantity]) => ({
      itemId,
      quantityPerCycle: BigInt(quantity),
    })),
  };
}

function aggregateItemRewards(result: SingleActionSettlementResult): readonly { readonly itemId: string; readonly quantity: string }[] {
  const quantities = new Map<string, bigint>();
  for (const segment of result.segments) {
    for (const [itemId, quantity] of Object.entries(segment.outputs as Record<string, string>)) {
      const current = quantities.get(itemId) ?? 0n;
      quantities.set(itemId, current + BigInt(quantity));
    }
  }
  return [...quantities.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, quantity]) => ({ itemId, quantity: quantity.toString() }));
}

function buildSkillAwards(actionConfig: ActionConfig | null, settlement: SingleActionSettlementResult): readonly SettlementSkillProgressionAward[] {
  if (settlement.skillXp === '0') {
    return [];
  }
  if (actionConfig === null || actionConfig.skill_id === null) {
    throw badRequest('SETTLEMENT_SKILL_TARGET_UNKNOWN');
  }
  return [{ skillId: actionConfig.skill_id, skillXpDelta: settlement.skillXp }];
}

function buildSegments(
  result: SingleActionSettlementResult,
  queueEntryId: string | null,
  getAction: (actionConfigId: string) => ActionConfig | null,
): readonly SettlementSegmentRecord[] {
  return result.segments.map((segment) => ({
    segmentIndex: segment.segmentIndex,
    ...(queueEntryId === null ? {} : { queueEntryId }),
    actionConfigId: segment.actionConfigId,
    fromAt: fromMicroseconds(segment.fromUs),
    toAt: fromMicroseconds(segment.toUs),
    completedCycles: segment.completedCycles,
    inputs: Object.fromEntries(
      (getAction(segment.actionConfigId)?.inputs ?? []).map((input) => [
        input.item_id,
        (BigInt(input.quantity) * segment.completedCycles).toString(),
      ]),
    ),
    outputs: segment.outputs,
    xpChanges: {
      cultivation_xp: segment.xpChanges.cultivationXp,
      skill_xp: segment.xpChanges.skillXp,
    },
    snapshot: segment.snapshot,
  }));
}

function buildSummary(
  settlement: SingleActionSettlementResult,
  state: SettlementStateRecord,
  actionConfigId: string | null,
  itemRewards: readonly { readonly itemId: string; readonly quantity: string }[],
  continuationRequired: boolean,
): SettlementJson {
  return {
    status: settlement.status,
    requested_until_us: settlement.requestedUntilUs.toString(),
    effective_until_us: settlement.effectiveUntilUs.toString(),
    effective_time_us: settlement.effectiveTimeUs.toString(),
    capped_time_us: settlement.cappedTimeUs.toString(),
    completed_cycles: settlement.completedCycles.toString(),
    progress_time_us: settlement.progressTimeUs.toString(),
    continuation_required: continuationRequired,
    active_queue_entry_id: state.activeQueueEntryId,
    active_cycle_index: state.activeCycleIndex.toString(),
    action_config_id: actionConfigId,
    cultivation_xp: settlement.cultivationXp,
    skill_xp: settlement.skillXp,
    items: itemRewards,
  };
}

function activeBuffEffects(
  registry: ConfigRegistry,
  buffs: readonly BuffInstanceRecord[],
): readonly SettlementBuffEffect[] {
  return buffs.map((buff) => {
    const config = registry.getBuff(buff.buffConfigId);
    return {
      buffConfigId: config.id,
      sourceItemId: config.source_item_id,
      stackGroup: config.stack_group,
      stackRule: config.stack_rule,
      applicableTags: config.applicable_tags,
      modifiers: config.modifiers.flatMap((modifier) => {
        if (modifier.stat !== 'cultivation_xp' && modifier.stat !== 'skill_xp') {
          return [];
        }
        return [{
          stat: modifier.stat,
          operation: modifier.operation,
          value: modifier.value,
          tags: modifier.tags,
        }];
      }),
    };
  });
}

function randomSeed(characterId: string, fromAt: Date, toAt: Date): Uint8Array {
  const seed = createHash('sha256')
    .update(characterId, 'utf8')
    .update('\0', 'utf8')
    .update(fromAt.toISOString(), 'utf8')
    .update('\0', 'utf8')
    .update(toAt.toISOString(), 'utf8')
    .digest();
  return new Uint8Array(seed);
}

async function withTransaction<T>(pool: DatabasePool, handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

@Injectable()
export class SettlementService {
  public constructor(
    @Inject(settlementRepositoryToken) private readonly settlementRepository: SettlementRepository,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(buffRepositoryToken) private readonly buffRepository: BuffRepository,
    @Inject(databasePoolToken) private readonly pool: DatabasePool,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(IdempotencyService) private readonly idempotencyService: IdempotencyService,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
    @Inject(environmentToken) private readonly environment: Environment,
    @Optional() @Inject(queueRepositoryToken) private readonly queueRepository?: QueueRepository,
  ) {}

  public async settleToNow(request: FastifyRequest, characterId: string): Promise<SettlementRunResponse> {
    await this.authService.assertCharacterOwnership(request, characterId);
    return withTransaction(this.pool, async (client) => {
      const plan = await this.buildPlan(client, characterId, new Date(), undefined);
      return this.persistPlan(client, plan);
    });
  }

  public async getLatestSettlementSummary(
    request: FastifyRequest,
    characterId: string,
  ): Promise<SettlementSummaryEnvelope> {
    await this.authService.assertCharacterOwnership(request, characterId);
    const summary = await this.settlementRepository.getLatestSummary(characterId);
    return { settlement: summary === null ? null : mapSummary(summary) };
  }

  public async getSettlementSummary(
    request: FastifyRequest,
    characterId: string,
    settlementId: string,
  ): Promise<SettlementSummaryEnvelope> {
    await this.authService.assertCharacterOwnership(request, characterId);
    const summary = await this.settlementRepository.getSummaryById(characterId, settlementId);
    if (summary === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message_key: 'error.resource_not_found',
      });
    }
    return { settlement: mapSummary(summary) };
  }

  public async executeSettledWrite<T extends JsonValue>(
    request: FastifyRequest,
    characterId: string,
    input: IdempotentSettlementInput<T>,
  ) {
    const accountId = await this.authService.requireWriteAccess(request);
    await this.authService.assertCharacterOwnership(request, characterId);
    const now = new Date();
    return this.idempotencyService.execute<T>({
      accountId,
      operationType: input.operationType,
      idempotencyKey: idempotencyKey(request),
      request: input.request,
      now,
      execute: async ({ client, requestHash }) => {
        const plan = await this.buildPlan(client, characterId, now, input.segmentLimit);
        const settlement = await this.persistPlan(client, plan);
        return input.execute({
          client,
          settlement,
          settlementState: plan.state,
          requestHash,
        });
      },
    });
  }

  public continuePendingSettlements(
    limit: number,
    handler: (client: PoolClient, characterId: string) => Promise<void>,
  ): Promise<number> {
    return this.settlementRepository.runContinuationBatch(limit, handler);
  }

  private async loadQueueInventory(client: PoolClient, characterId: string): Promise<Map<string, bigint>> {
    const result = await client.query<QueueItemBalanceRow>(
      `SELECT item_id, (quantity - reserved_quantity)::text AS available_quantity
         FROM inventories
        WHERE character_id = $1`,
      [characterId],
    );
    return new Map(result.rows.map((row) => [row.item_id, BigInt(row.available_quantity)]));
  }

  private inventoryConditionSatisfied(
    entry: Pick<QueueEntryRecord, 'mode' | 'targetValue' | 'conditionItemId' | 'conditionOperator'>,
    inventory: ReadonlyMap<string, bigint>,
  ): boolean {
    if (entry.mode !== 'UNTIL_INVENTORY' || entry.targetValue === null || entry.conditionItemId === null) {
      return false;
    }
    if (entry.conditionOperator !== '<' && entry.conditionOperator !== '>=') {
      return false;
    }
    return isQueueInventoryConditionSatisfied(inventory.get(entry.conditionItemId) ?? 0n, {
      itemId: entry.conditionItemId,
      operator: entry.conditionOperator,
      targetValue: entry.targetValue,
    });
  }

  private async prepareQueueEntry(
    client: PoolClient,
    characterId: string,
    state: SettlementStateRecord,
  ): Promise<{ readonly queue: Awaited<ReturnType<QueueRepository['lockQueue']>>; readonly transition: QueueTransition }> {
    if (this.queueRepository === undefined) {
      return { queue: null, transition: { activeQueueEntryId: state.activeQueueEntryId, activeCycleSnapshot: state.activeCycleSnapshot } };
    }
    let queue = await this.queueRepository.lockQueue(client, characterId);
    if (queue === null) {
      return { queue, transition: { activeQueueEntryId: state.activeQueueEntryId, activeCycleSnapshot: state.activeCycleSnapshot } };
    }
    if (state.activeQueueEntryId !== null) {
      const activeEntry = queue.entries.find((entry) => entry.id === state.activeQueueEntryId);
      if (activeEntry?.status === 'BLOCKED') {
        if (activeEntry.onBlocked === 'FALLBACK') {
          const fallback = this.getActionConfig(queue.fallbackActionId);
          return {
            queue,
            transition: {
              activeQueueEntryId: null,
              activeCycleSnapshot: fallback === null
                ? null
                : snapshotFromAction(fallback, this.configRegistry.manifest.config_version, this.configRegistry.manifest.formula_version),
            },
          };
        }
        return { queue, transition: { activeQueueEntryId: state.activeQueueEntryId, activeCycleSnapshot: null } };
      }
      if (state.activeCycleSnapshot !== null) {
        return { queue, transition: { activeQueueEntryId: state.activeQueueEntryId, activeCycleSnapshot: state.activeCycleSnapshot } };
      }
    }
    if (state.activeCycleSnapshot !== null) {
      const inventory = await this.loadQueueInventory(client, characterId);
      for (const entry of [...queue.entries].sort((left, right) => left.position - right.position)) {
        if (entry.status !== 'DONE_CONDITION_MET' || this.inventoryConditionSatisfied(entry, inventory)) {
          continue;
        }
        const action = this.getActionConfig(entry.actionConfigId);
        if (action === null) {
          continue;
        }
        queue = await this.queueRepository.setEntryStatus(client, {
          characterId,
          entryId: entry.id,
          status: 'RUNNING',
          blockedReason: null,
        });
        return {
          queue,
          transition: {
            activeQueueEntryId: entry.id,
            activeCycleSnapshot: snapshotFromAction(action, this.configRegistry.manifest.config_version, this.configRegistry.manifest.formula_version),
          },
        };
      }
      return { queue, transition: { activeQueueEntryId: state.activeQueueEntryId, activeCycleSnapshot: state.activeCycleSnapshot } };
    }

    const inventory = await this.loadQueueInventory(client, characterId);
    let activeQueueEntryId: string | null = null;
    let activeCycleSnapshot: SettlementJson | null = null;
    for (const entry of [...queue.entries].sort((left, right) => left.position - right.position)) {
      if (entry.status !== 'QUEUED') {
        continue;
      }
      if (this.inventoryConditionSatisfied(entry, inventory)) {
        queue = await this.queueRepository.setEntryStatus(client, {
          characterId,
          entryId: entry.id,
          status: 'DONE_CONDITION_MET',
          blockedReason: null,
        });
        continue;
      }
      const action = this.getActionConfig(entry.actionConfigId);
      if (action === null) {
        continue;
      }
      queue = await this.queueRepository.setEntryStatus(client, {
        characterId,
        entryId: entry.id,
        status: 'RUNNING',
        blockedReason: null,
      });
      activeQueueEntryId = entry.id;
      activeCycleSnapshot = snapshotFromAction(action, this.configRegistry.manifest.config_version, this.configRegistry.manifest.formula_version);
      break;
    }

    if (activeCycleSnapshot === null) {
      const fallback = this.getActionConfig(queue.fallbackActionId);
      activeCycleSnapshot = fallback === null
        ? null
        : snapshotFromAction(fallback, this.configRegistry.manifest.config_version, this.configRegistry.manifest.formula_version);
    }
    return { queue, transition: { activeQueueEntryId, activeCycleSnapshot } };
  }

  private async advanceQueueAfterCycle(
    client: PoolClient,
    characterId: string,
    queue: Awaited<ReturnType<QueueRepository['lockQueue']>>,
    activeQueueEntryId: string | null,
    currentSnapshot: SettlementJson | null,
    activeQueueEntry: QueueEntryRecord | null,
    settlement: SingleActionSettlementResult,
    itemRewards: readonly { readonly itemId: string; readonly quantity: string }[],
  ): Promise<QueueTransition> {
    if (this.queueRepository === undefined || queue === null || (settlement.completedCycles === 0n && settlement.effectiveTimeUs === 0n)) {
      return { activeQueueEntryId, activeCycleSnapshot: currentSnapshot };
    }
    const inventory = await this.loadQueueInventory(client, characterId);
    for (const reward of itemRewards) {
      inventory.set(reward.itemId, (inventory.get(reward.itemId) ?? 0n) + BigInt(reward.quantity));
    }
    if (activeQueueEntryId === null) {
      for (const entry of [...queue.entries].sort((left, right) => left.position - right.position)) {
        if (entry.status !== 'DONE_CONDITION_MET' || this.inventoryConditionSatisfied(entry, inventory)) {
          continue;
        }
        const action = this.getActionConfig(entry.actionConfigId);
        if (action === null) {
          continue;
        }
        await this.queueRepository.setEntryStatus(client, {
          characterId,
          entryId: entry.id,
          status: 'RUNNING',
          blockedReason: null,
        });
        return {
          activeQueueEntryId: entry.id,
          activeCycleSnapshot: snapshotFromAction(action, this.configRegistry.manifest.config_version, this.configRegistry.manifest.formula_version),
        };
      }
      return { activeQueueEntryId, activeCycleSnapshot: currentSnapshot };
    }
    const current = queue.entries.find((entry) => entry.id === activeQueueEntryId) ?? activeQueueEntry;
    if (current === undefined || current === null) {
      return { activeQueueEntryId, activeCycleSnapshot: currentSnapshot };
    }
    const completed = current.mode === 'UNTIL_INVENTORY'
      ? this.inventoryConditionSatisfied(current, inventory)
      : current.mode === 'COUNT'
        ? current.targetValue !== null
          && current.completedCycles + settlement.completedCycles >= BigInt(current.targetValue)
        : current.mode === 'DURATION'
          ? current.targetValue !== null
            && current.progressTimeUs + settlement.effectiveTimeUs >= BigInt(decimal(current.targetValue).multiply('1000000').toString())
          : false;
    if (!completed) {
      const action = this.getActionConfig(current.actionConfigId);
      await this.queueRepository.setEntryStatus(client, {
        characterId,
        entryId: current.id,
        status: current.status,
        blockedReason: current.blockedReason,
        completedCycles: current.completedCycles + settlement.completedCycles,
        progressTimeUs: settlement.progressTimeUs,
      });
      return {
        activeQueueEntryId,
        activeCycleSnapshot: action === null ? null : snapshotFromAction(action, this.configRegistry.manifest.config_version, this.configRegistry.manifest.formula_version),
      };
    }

    let nextQueue = await this.queueRepository.setEntryStatus(client, {
      characterId,
      entryId: current.id,
      status: current.mode === 'UNTIL_INVENTORY' ? 'DONE_CONDITION_MET' : 'DONE',
      blockedReason: null,
      completedCycles: current.completedCycles + settlement.completedCycles,
      progressTimeUs: settlement.progressTimeUs,
    });
    for (const entry of [...nextQueue.entries].sort((left, right) => left.position - right.position)) {
      if (entry.status !== 'QUEUED') {
        continue;
      }
      if (this.inventoryConditionSatisfied(entry, inventory)) {
        nextQueue = await this.queueRepository.setEntryStatus(client, {
          characterId,
          entryId: entry.id,
          status: 'DONE_CONDITION_MET',
          blockedReason: null,
        });
        continue;
      }
      const action = this.getActionConfig(entry.actionConfigId);
      if (action === null) {
        continue;
      }
      await this.queueRepository.setEntryStatus(client, {
        characterId,
        entryId: entry.id,
        status: 'RUNNING',
        blockedReason: null,
      });
      return {
        activeQueueEntryId: entry.id,
        activeCycleSnapshot: snapshotFromAction(action, this.configRegistry.manifest.config_version, this.configRegistry.manifest.formula_version),
      };
    }
    const fallback = this.getActionConfig(nextQueue.fallbackActionId);
    return {
      activeQueueEntryId: null,
      activeCycleSnapshot: fallback === null
        ? null
        : snapshotFromAction(fallback, this.configRegistry.manifest.config_version, this.configRegistry.manifest.formula_version),
    };
  }

  private async buildPlan(
    client: PoolClient,
    characterId: string,
    now: Date,
    segmentLimit: number | undefined,
  ): Promise<SettlementPlan> {
    const state = await this.settlementRepository.lockState(client, characterId);
    if (!state) {
      throw notFound();
    }

    const preparedQueue = await this.prepareQueueEntry(client, characterId, state);
    const snapshot = snapshotFromJson(preparedQueue.transition.activeCycleSnapshot);
    const actionConfig = snapshot === null ? null : this.getActionConfig(snapshot.action_config_id);
    const settlementInput: SingleActionSettlementInput = {
      lastSettledAtUs: microseconds(toMicroseconds(state.lastSettledAt)),
      serverNowUs: microseconds(toMicroseconds(now)),
      offlineCapUs: microseconds(BigInt(state.offlineCapSeconds) * 1_000_000n),
      progressTimeUs: microseconds(state.progressTimeUs),
      actionSnapshot: snapshot === null ? null : toRulesSnapshot(snapshot),
    };

    const settlement = await this.settleAcrossCycleBoundaries(
      client,
      state.characterId,
      settlementInput,
      snapshot,
      preparedQueue.queue?.entries.find(
        (entry) => entry.id === preparedQueue.transition.activeQueueEntryId,
      ) ?? null,
    );
    const checkpoint = checkpointSegments(settlement.segments, segmentLimit ?? 100);
    const committedSettlement = {
      ...settlement,
      segments: checkpoint.committedSegments,
    };
    const itemRewards = aggregateItemRewards(committedSettlement);
    const skillAwards = buildSkillAwards(actionConfig, committedSettlement);
    const activeQueueEntry = preparedQueue.queue?.entries.find(
      (entry) => entry.id === preparedQueue.transition.activeQueueEntryId,
    ) ?? null;
    const segments = buildSegments(
      committedSettlement,
      preparedQueue.transition.activeQueueEntryId,
      (actionConfigId) => this.getActionConfig(actionConfigId),
    );
    const continuationRequired = checkpoint.continuationRequired;
    const actionConfigId = actionConfig?.id ?? snapshot?.action_config_id ?? null;
    const queueTransition = await this.advanceQueueAfterCycle(
      client,
      characterId,
      preparedQueue.queue,
      preparedQueue.transition.activeQueueEntryId,
      preparedQueue.transition.activeCycleSnapshot,
      activeQueueEntry,
      committedSettlement,
      itemRewards,
    );
    const nextState = {
      lastSettledAt: fromMicroseconds(committedSettlement.effectiveUntilUs),
      activeCycleIndex: state.activeCycleIndex + committedSettlement.completedCycles,
      progressTimeUs: committedSettlement.progressTimeUs,
      continuationRequired,
      ...(queueTransition.activeQueueEntryId === null ? {} : { activeQueueEntryId: queueTransition.activeQueueEntryId }),
      activeCycleSnapshot: queueTransition.activeCycleSnapshot,
    };

    return {
      state,
      actionConfig,
      settlement: committedSettlement,
      continuationRequired,
      itemRewards,
      skillAwards,
      persistence: {
        characterId: state.characterId,
        fromAt: state.lastSettledAt,
        effectiveUntil: fromMicroseconds(committedSettlement.effectiveUntilUs),
        requestedUntil: fromMicroseconds(committedSettlement.requestedUntilUs),
        effectiveSeconds: committedSettlement.effectiveTimeUs / 1_000_000n,
        cappedSeconds: committedSettlement.cappedTimeUs / 1_000_000n,
        status: committedSettlement.status,
        randomSeed: randomSeed(state.characterId, state.lastSettledAt, now),
        formulaVersion: this.configRegistry.manifest.formula_version,
        configVersion: snapshot?.config_version ?? this.environment.ACTIVE_CONFIG_VERSION,
        summary: buildSummary(
          committedSettlement,
          { ...state, activeQueueEntryId: queueTransition.activeQueueEntryId },
          actionConfigId,
          itemRewards,
          continuationRequired,
        ),
        completedAt: now,
        segments,
        progressionAward: { cultivationXpDelta: committedSettlement.cultivationXp },
        skillProgressionAwards: skillAwards,
        nextState,
      },
      responseBase: {
        character_id: state.characterId,
        status: committedSettlement.status,
        requested_until: fromMicroseconds(committedSettlement.requestedUntilUs).toISOString(),
        effective_until: fromMicroseconds(committedSettlement.effectiveUntilUs).toISOString(),
        effective_time_us: committedSettlement.effectiveTimeUs.toString(),
        capped_time_us: committedSettlement.cappedTimeUs.toString(),
        completed_cycles: committedSettlement.completedCycles.toString(),
        progress_time_us: committedSettlement.progressTimeUs.toString(),
        continuation_required: continuationRequired,
        applied_rewards: {
          cultivation_xp: committedSettlement.cultivationXp,
          skill_xp: committedSettlement.skillXp,
          items: itemRewards.map((item) => ({ item_id: item.itemId, quantity: item.quantity })),
        },
        segments,
      },
    };
  }

  private async persistPlan(client: PoolClient, plan: SettlementPlan): Promise<SettlementRunResponse> {
    const settlementId = await this.settlementRepository.persist(client, plan.persistence);
    for (const segment of plan.persistence.segments) {
      const inputs = Object.entries(segment.inputs as Record<string, string>);
      if (inputs.length === 0 || segment.completedCycles === 0n) {
        continue;
      }
      const reservations = segment.queueEntryId === undefined
        ? []
        : await this.assetRepository.findActiveReservationsByBusiness(client, {
            characterId: plan.state.characterId,
            businessType: 'ACTION_QUEUE_ENTRY',
            businessId: segment.queueEntryId,
          });
      const availableReservations = reservations.map((reservation) => ({ ...reservation }));
      for (const [assetId, quantity] of inputs) {
        let remaining = BigInt(quantity);
        for (const reservation of availableReservations.filter((item) => item.assetId === assetId)) {
          if (remaining <= 0n) {
            break;
          }
          const available = BigInt(reservation.quantity);
          const consumed = available < remaining ? available : remaining;
          await this.assetRepository.consumeOnTransaction(client, {
            characterId: plan.state.characterId,
            reasonCode: 'SETTLEMENT_INPUT',
            referenceType: 'SETTLEMENT_RUN',
            referenceId: settlementId,
            configVersion: plan.persistence.configVersion,
            reservationId: reservation.reservationId,
            quantity: consumed.toString(),
          });
          remaining -= consumed;
          reservation.quantity = (available - consumed).toString();
        }
        if (remaining > 0n) {
          const reserved = await this.assetRepository.reserveOnTransaction(client, {
            characterId: plan.state.characterId,
            assetType: 'ITEM',
            assetId,
            quantity: remaining.toString(),
            businessType: 'ACTION_CYCLE',
            businessId: settlementId,
            reasonCode: 'SETTLEMENT_INPUT_RESERVE',
            referenceType: 'SETTLEMENT_RUN',
            referenceId: settlementId,
            configVersion: plan.persistence.configVersion,
          });
          await this.assetRepository.consumeOnTransaction(client, {
            characterId: plan.state.characterId,
            reasonCode: 'SETTLEMENT_INPUT',
            referenceType: 'SETTLEMENT_RUN',
            referenceId: settlementId,
            configVersion: plan.persistence.configVersion,
            reservationId: reserved.reservation.reservationId,
          });
        }
      }
    }
    for (const reward of plan.itemRewards) {
      await this.assetRepository.addOnTransaction(client, {
        characterId: plan.state.characterId,
        reasonCode: 'SETTLEMENT_OUTPUT',
        referenceType: 'SETTLEMENT_RUN',
        referenceId: settlementId,
        configVersion: plan.persistence.configVersion,
        assetType: 'ITEM',
        assetId: reward.itemId,
        quantity: reward.quantity,
      });
    }

    return {
      settlement_id: settlementId,
      ...plan.responseBase,
    };
  }

  private async settleAcrossCycleBoundaries(
    client: PoolClient,
    characterId: string,
    input: SingleActionSettlementInput,
    snapshot: SettlementSnapshotRecord | null,
    activeQueueEntry: QueueEntryRecord | null,
  ): Promise<SingleActionSettlementResult> {
    const baseResult = settleSingleAction(input);
    if (snapshot === null || baseResult.status === 'IDLE_NO_ACTION') {
      return baseResult;
    }

    const currentAction = this.getActionConfig(snapshot.action_config_id);
    if (currentAction === null) {
      return baseResult;
    }

    const baseSnapshot = toRulesSnapshot(snapshot);
    let cycleStartUs = input.lastSettledAtUs;
    let progressTimeUs = input.progressTimeUs;
    const segments: SettlementSegment[] = [];
    let cultivationXp = decimal('0');
    let skillXp = decimal('0');
    let completedCycles = 0n;
    let segmentIndex = 0;
    let remainingUs = baseResult.effectiveTimeUs;
    if (activeQueueEntry?.mode === 'COUNT' && activeQueueEntry.targetValue !== null) {
      const remainingCycles = BigInt(activeQueueEntry.targetValue) - activeQueueEntry.completedCycles;
      const targetTimeUs = remainingCycles > 0n
        ? remainingCycles * baseSnapshot.durationUs - input.progressTimeUs
        : 0n;
      remainingUs = microseconds(remainingUs < targetTimeUs && targetTimeUs > 0n ? remainingUs : targetTimeUs > 0n ? targetTimeUs : 0n);
    } else if (activeQueueEntry?.mode === 'DURATION' && activeQueueEntry.targetValue !== null) {
      const targetTimeUs = BigInt(decimal(activeQueueEntry.targetValue).multiply('1000000').toString()) - input.progressTimeUs;
      remainingUs = microseconds(remainingUs < targetTimeUs && targetTimeUs > 0n ? remainingUs : targetTimeUs > 0n ? targetTimeUs : 0n);
    }
    const virtualInventory = activeQueueEntry?.mode === 'UNTIL_INVENTORY'
      ? await this.loadQueueInventory(client, characterId)
      : null;
    let effectiveUntilUs = addMicroseconds(input.lastSettledAtUs, remainingUs);

    while (remainingUs > 0n) {
      const currentSnapshot = await this.composeCycleSnapshot(
        client,
        characterId,
        currentAction,
        baseSnapshot,
        cycleStartUs,
      );
      const cycleRemainingUs = microseconds(currentSnapshot.durationUs - progressTimeUs);
      const stepUs = microseconds(remainingUs < cycleRemainingUs ? remainingUs : cycleRemainingUs);
      const stepResult = settleSingleAction({
        lastSettledAtUs: cycleStartUs,
        serverNowUs: addMicroseconds(cycleStartUs, stepUs),
        offlineCapUs: stepUs,
        progressTimeUs,
        actionSnapshot: currentSnapshot,
      });

      completedCycles += stepResult.completedCycles;
      cultivationXp = cultivationXp.add(stepResult.cultivationXp);
      skillXp = skillXp.add(stepResult.skillXp);
      for (const segment of stepResult.segments) {
        segments.push({
          ...segment,
          segmentIndex,
        });
        segmentIndex += 1;
      }
      remainingUs = microseconds(remainingUs - stepUs);
      cycleStartUs = addMicroseconds(cycleStartUs, stepUs);
      progressTimeUs = stepResult.progressTimeUs;

      if (stepUs < cycleRemainingUs) {
        break;
      }
      progressTimeUs = microseconds('0');
      if (virtualInventory !== null && stepResult.completedCycles > 0n) {
        for (const actionInput of currentAction.inputs) {
          const current = virtualInventory.get(actionInput.item_id) ?? 0n;
          virtualInventory.set(
            actionInput.item_id,
            current - BigInt(actionInput.quantity) * stepResult.completedCycles,
          );
        }
        for (const output of currentSnapshot.outputs) {
          const current = virtualInventory.get(output.itemId) ?? 0n;
          virtualInventory.set(
            output.itemId,
            current + output.quantityPerCycle * stepResult.completedCycles,
          );
        }
        if (activeQueueEntry !== null && this.inventoryConditionSatisfied(activeQueueEntry, virtualInventory)) {
          effectiveUntilUs = cycleStartUs;
          remainingUs = microseconds(0n);
          break;
        }
      }
    }

    return {
      requestedUntilUs: baseResult.requestedUntilUs,
      effectiveUntilUs,
      effectiveTimeUs: microseconds(effectiveUntilUs - input.lastSettledAtUs),
      cappedTimeUs: microseconds(baseResult.requestedUntilUs - effectiveUntilUs),
      completedCycles,
      progressTimeUs,
      cultivationXp: cultivationXp.toString(),
      skillXp: skillXp.toString(),
      segments,
      status: baseResult.status,
    };
  }

  private async composeCycleSnapshot(
    client: PoolClient,
    characterId: string,
    actionConfig: ActionConfig,
    baseSnapshot: SettlementActionSnapshot,
    asOf: bigint,
  ): Promise<SettlementActionSnapshot> {
    const buffRows = await this.buffRepository.lockActiveBuffs(client, characterId, fromMicroseconds(asOf));
    const buffs = activeBuffEffects(this.configRegistry, buffRows);
    if (buffs.length === 0) {
      return baseSnapshot;
    }
    return applyBuffsToActionSnapshot({
      snapshot: baseSnapshot,
      actionTags: actionConfig.modifier_tags,
      buffs,
    });
  }

  private getActionConfig(actionConfigId: string): ActionConfig | null {
    try {
      return this.configRegistry.getAction(actionConfigId);
    } catch {
      return null;
    }
  }
}
