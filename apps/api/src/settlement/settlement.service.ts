import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
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
} from '@dongtian/database';
import { environmentToken } from '../environment.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { buffRepositoryToken } from '../buff/buff.tokens.js';
import { settlementRepositoryToken } from './settlement.tokens.js';

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
): readonly SettlementSegmentRecord[] {
  return result.segments.map((segment) => ({
    segmentIndex: segment.segmentIndex,
    ...(queueEntryId === null ? {} : { queueEntryId }),
    actionConfigId: segment.actionConfigId,
    fromAt: fromMicroseconds(segment.fromUs),
    toAt: fromMicroseconds(segment.toUs),
    completedCycles: segment.completedCycles,
    inputs: {},
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

    const snapshot = snapshotFromJson(state.activeCycleSnapshot);
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
    );
    const checkpoint = checkpointSegments(settlement.segments, segmentLimit ?? 100);
    const committedSettlement = {
      ...settlement,
      segments: checkpoint.committedSegments,
    };
    const itemRewards = aggregateItemRewards(committedSettlement);
    const skillAwards = buildSkillAwards(actionConfig, committedSettlement);
    const segments = buildSegments(committedSettlement, state.activeQueueEntryId);
    const continuationRequired = checkpoint.continuationRequired;
    const actionConfigId = actionConfig?.id ?? snapshot?.action_config_id ?? null;
    const nextState = {
      lastSettledAt: fromMicroseconds(committedSettlement.effectiveUntilUs),
      activeCycleIndex: state.activeCycleIndex + committedSettlement.completedCycles,
      activeCycleSnapshot: state.activeCycleSnapshot,
      progressTimeUs: committedSettlement.progressTimeUs,
      continuationRequired,
      ...(state.activeQueueEntryId === null ? {} : { activeQueueEntryId: state.activeQueueEntryId }),
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
        summary: buildSummary(committedSettlement, state, actionConfigId, itemRewards, continuationRequired),
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
    }

    return {
      requestedUntilUs: baseResult.requestedUntilUs,
      effectiveUntilUs: baseResult.effectiveUntilUs,
      effectiveTimeUs: baseResult.effectiveTimeUs,
      cappedTimeUs: baseResult.cappedTimeUs,
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
