import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetBalance,
  AssetRepository,
  BreakthroughRepository,
  BreakthroughReservedAsset,
  BreakthroughRunRecord,
  BreakthroughStatus,
  DatabasePool,
  JsonValue,
  PoolClient,
} from '@dongtian/database';
import {
  abandonBreakthroughRun as resolveAbandonBreakthroughRun,
  evaluateBreakthroughFinalizeEligibility,
  finalizeBreakthroughRun as resolveFinalizeBreakthroughRun,
  foundationBreakthroughConfig,
  previewBreakthrough,
  restoreBreakthroughRun as resolveRestoreBreakthroughRun,
  selectBreakthroughRoute as resolveSelectBreakthroughRoute,
  startBreakthroughTrial as resolveStartBreakthroughTrial,
  type BreakthroughFinalizeResult,
  type BreakthroughRunState as BreakthroughRulesRunState,
} from '@dongtian/game-rules';

import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { SettlementService } from '../settlement/settlement.service.js';
import { breakthroughRepositoryToken } from './breakthrough.tokens.js';

type JsonRecord = Record<string, unknown>;

type CharacterStateRow = {
  readonly character_id: string;
  readonly state_version: string;
  readonly active_config_version: string;
  readonly realm_stage_id: string;
  readonly cultivation_xp: string;
};

type BreakthroughChoiceRequest = {
  readonly choiceId: string;
  readonly expectedRunVersion: bigint;
};

type BreakthroughStartRequest = {
  readonly expectedStateVersion: bigint;
  readonly configVersion: string;
};

type BreakthroughEnvelope = {
  readonly character: {
    readonly character_id: string;
    readonly state_version: number;
    readonly active_config_version: string;
  };
  readonly config_version: string;
};

type BreakthroughNextResponse = BreakthroughEnvelope & {
  readonly breakthrough: ReturnType<typeof mapBreakthroughPreview>;
};

type BreakthroughRunResponse = BreakthroughEnvelope & {
  readonly run: {
    readonly breakthrough_run_id: string;
    readonly breakthrough_config_id: string;
    readonly config_version: string;
    readonly formula_version: number;
    readonly status: BreakthroughStatus;
    readonly run_version: number;
    readonly current_node_id: string;
    readonly created_at: string;
    readonly trial_deadline_at: string;
    readonly expires_at: string;
    readonly selected_choice_id: string | null;
    readonly selected_route_id: string | null;
    readonly selected_route_risk: 'SAFE' | 'HIGH_RISK' | null;
    readonly selected_at: string | null;
    readonly finalized_at: string | null;
    readonly abandoned_at: string | null;
    readonly released_at: string | null;
    readonly reservation_snapshot: ReadonlyArray<ReturnType<typeof mapReservedAsset>>;
    readonly preview_snapshot: ReturnType<typeof mapBreakthroughPreview>;
    readonly result: ReturnType<typeof mapFinalizeResult> | null;
  };
};

const BREAKTHROUGH_OPERATION_START = 'BREAKTHROUGH_START';
const BREAKTHROUGH_OPERATION_CHOICE = 'BREAKTHROUGH_CHOICE';
const BREAKTHROUGH_OPERATION_FINALIZE = 'BREAKTHROUGH_FINALIZE';
const BREAKTHROUGH_OPERATION_ABANDON = 'BREAKTHROUGH_ABANDON';
const BREAKTHROUGH_OPERATION_RECOVER = 'BREAKTHROUGH_RECOVER';
const BREAKTHROUGH_BUSINESS_TYPE = 'BREAKTHROUGH_TRIAL';
const BREAKTHROUGH_REFERENCE_TYPE = 'BREAKTHROUGH_RUN';
const CULTIVATION_ROUTE_ID = 'action.cultivation.qi';
const FOUNDATION_PILL_ROUTE_ID = 'recipe.t1.foundation_pill';
const LINGSUI_ROUTE_ID = 'route.t1.qingshe_cave.safe_exit';
const MERIDIAN_PILL_ROUTE_ID = 'recipe.t1.meridian_pill';
const SPIRIT_STONE_ROUTE_ID = 'route.t1.qingshe_cave.deep_den';

const SOURCE_SECONDS_PER_UNIT_BY_ROUTE_ID: Readonly<Record<string, string>> = {
  [CULTIVATION_ROUTE_ID]: '13.333333333333334',
  [FOUNDATION_PILL_ROUTE_ID]: '4500',
  [LINGSUI_ROUTE_ID]: '48',
  [MERIDIAN_PILL_ROUTE_ID]: '750',
  [SPIRIT_STONE_ROUTE_ID]: '2.5833333333333335',
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

function unprocessable(code: string, details: Record<string, unknown>): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code,
    message_key: 'error.validation_error',
    details,
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

function stateVersionAsNumber(stateVersion: string): number {
  const parsed = Number(stateVersion);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('STATE_VERSION_OUT_OF_RANGE');
  }
  return parsed;
}

function parseChoiceRequest(body: unknown): BreakthroughChoiceRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  return {
    choiceId: requiredString(body, 'choice_id'),
    expectedRunVersion: parseNonNegativeInteger(body['expected_run_version'], 'expected_run_version'),
  };
}

function parseStartRequest(body: unknown): BreakthroughStartRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  return {
    expectedStateVersion: parseNonNegativeInteger(body['expected_state_version'], 'expected_state_version'),
    configVersion: requiredString(body, 'config_version'),
  };
}

function assetBalanceMap(
  balances: readonly AssetBalance[],
): Readonly<Record<string, { readonly total: string; readonly reserved: string }>> {
  return Object.fromEntries(
    balances.map((balance) => [balance.assetId, { total: balance.quantity, reserved: balance.reservedQuantity }] as const),
  );
}

function previewInput(
  cultivationXp: string,
  inventory: { readonly items: readonly AssetBalance[]; readonly currencies: readonly AssetBalance[] },
): Parameters<typeof previewBreakthrough>[0] {
  return {
    config: foundationBreakthroughConfig,
    cultivationXp,
    items: assetBalanceMap(inventory.items),
    currencies: assetBalanceMap(inventory.currencies),
    sourceSecondsPerUnitByRouteId: SOURCE_SECONDS_PER_UNIT_BY_ROUTE_ID,
  };
}

function toRulesRun(record: BreakthroughRunRecord): BreakthroughRulesRunState {
  return {
    breakthroughRunId: record.breakthroughRunId,
    characterId: record.characterId,
    breakthroughConfigId: record.breakthroughConfigId,
    status: record.status,
    runVersion: BigInt(record.runVersion),
    currentNodeId: record.currentNodeId,
    createdAtUs: (BigInt(record.createdAt.getTime()) * 1_000n).toString(),
    trialDeadlineAtUs: (BigInt(record.trialDeadlineAt.getTime()) * 1_000n).toString(),
    expiresAtUs: (BigInt(record.expiresAt.getTime()) * 1_000n).toString(),
    selectedChoiceId: record.selectedChoiceId,
    selectedRouteId: record.selectedRouteId,
    selectedRouteRisk: record.selectedRouteRisk,
    selectedAtUs: record.selectedAt === null ? null : (BigInt(record.selectedAt.getTime()) * 1_000n).toString(),
    finalizedAtUs: record.finalizedAt === null ? null : (BigInt(record.finalizedAt.getTime()) * 1_000n).toString(),
    abandonedAtUs: record.abandonedAt === null ? null : (BigInt(record.abandonedAt.getTime()) * 1_000n).toString(),
    releasedAtUs: record.releasedAt === null ? null : (BigInt(record.releasedAt.getTime()) * 1_000n).toString(),
    reservationSnapshot: record.reservationSnapshot,
    previewSnapshot: record.previewSnapshot as ReturnType<typeof previewBreakthrough>,
    result: record.result as BreakthroughFinalizeResult | null,
  };
}

function mapReservedAsset(asset: BreakthroughReservedAsset) {
  return {
    asset_type: asset.assetType,
    asset_id: asset.assetId,
    quantity: asset.quantity,
  } as const;
}

function mapBreakthroughPreview(preview: ReturnType<typeof previewBreakthrough>) {
  return {
    breakthrough_config_id: preview.breakthroughConfigId,
    target_realm_id: preview.targetRealmId,
    config_version: preview.configVersion,
    formula_version: preview.formulaVersion,
    success_rate: preview.successRate,
    all_satisfied: preview.allSatisfied,
    requirements: preview.requirements.map((requirement) => ({
      asset_type: requirement.assetType,
      asset_id: requirement.assetId,
      current: requirement.current,
      total: requirement.total,
      reserved: requirement.reserved,
      available: requirement.available,
      required: requirement.required,
      status: requirement.status,
      shortfall: requirement.shortfall,
      source_route_id: requirement.sourceRouteId,
      estimated_time_seconds: requirement.estimatedTimeSeconds,
    })),
    unlock_bundle_id: preview.unlockBundleId,
  } as const;
}

function mapFinalizeResult(result: BreakthroughFinalizeResult) {
  return {
    breakthrough_run_id: result.breakthroughRunId,
    breakthrough_config_id: result.breakthroughConfigId,
    success_rate: result.successRate,
    unlocked_realm_id: result.unlockedRealmId,
    unlock_bundle_id: result.unlockBundleId,
    queue_slots: result.queueSlots,
    medicine_slots: result.medicineSlots,
    reserved_assets: result.reservedAssets.map(mapReservedAsset),
  } as const;
}

function fromRulesRun(
  record: BreakthroughRulesRunState,
  configVersion: string,
  formulaVersion: number,
): BreakthroughRunResponse['run'] {
  const toDate = (value: string | null): string | null =>
    value === null ? null : new Date(Number(BigInt(value) / 1_000n)).toISOString();

  return {
    breakthrough_run_id: record.breakthroughRunId,
    breakthrough_config_id: record.breakthroughConfigId,
    config_version: configVersion,
    formula_version: formulaVersion,
    status: record.status,
    run_version: Number(record.runVersion),
    current_node_id: record.currentNodeId,
    created_at: new Date(Number(BigInt(record.createdAtUs) / 1_000n)).toISOString(),
    trial_deadline_at: new Date(Number(BigInt(record.trialDeadlineAtUs) / 1_000n)).toISOString(),
    expires_at: new Date(Number(BigInt(record.expiresAtUs) / 1_000n)).toISOString(),
    selected_choice_id: record.selectedChoiceId,
    selected_route_id: record.selectedRouteId,
    selected_route_risk: record.selectedRouteRisk,
    selected_at: toDate(record.selectedAtUs),
    finalized_at: toDate(record.finalizedAtUs),
    abandoned_at: toDate(record.abandonedAtUs),
    released_at: toDate(record.releasedAtUs),
    reservation_snapshot: record.reservationSnapshot.map(mapReservedAsset),
    preview_snapshot: mapBreakthroughPreview(record.previewSnapshot),
    result: record.result === null ? null : mapFinalizeResult(record.result),
  };
}

function dateFromMicroseconds(value: string): Date {
  return new Date(Number(BigInt(value) / 1_000n));
}

async function loadCharacterState(client: Pick<PoolClient, 'query'>, characterId: string, lock: boolean): Promise<CharacterStateRow | null> {
  const result = await client.query<CharacterStateRow>(
    `SELECT
       c.id AS character_id,
       c.state_version::text AS state_version,
       c.active_config_version,
       cp.realm_stage_id,
       cp.cultivation_xp::text AS cultivation_xp
     FROM characters c
     INNER JOIN character_progression cp ON cp.character_id = c.id
     WHERE c.id = $1
     ${lock ? 'FOR UPDATE' : ''}`,
    [characterId],
  );
  return result.rows[0] ?? null;
}

async function bumpStateVersion(client: PoolClient, characterId: string, expectedStateVersion: string): Promise<string> {
  const result = await client.query<{ state_version: string }>(
    `UPDATE characters
        SET state_version = state_version + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND state_version::text = $2
      RETURNING state_version::text AS state_version`,
    [characterId, expectedStateVersion],
  );
  const row = result.rows[0];
  if (!row) {
    throw conflict('state_version_changed');
  }
  return row.state_version;
}

async function updateRealmStage(client: PoolClient, characterId: string, realmStageId: string): Promise<void> {
  await client.query(
    `UPDATE characters
        SET realm_stage_id = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [characterId, realmStageId],
  );
  await client.query(
    `UPDATE character_progression
        SET realm_stage_id = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE character_id = $1`,
    [characterId, realmStageId],
  );
}

async function createOutboxEvent(
  client: PoolClient,
  transactionId: string,
  eventType: string,
  aggregateId: string,
  payload: JsonValue,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (
       event_type, aggregate_type, aggregate_id, transaction_id, payload
     )
     VALUES ($1, 'BREAKTHROUGH_RUN', $2, $3, $4::jsonb)`,
    [eventType, aggregateId, transactionId, JSON.stringify(payload)],
  );
}

async function releaseReservations(
  client: PoolClient,
  assetRepository: AssetRepository,
  characterId: string,
  breakthroughRunId: string,
  configVersion: string,
  reasonCode: string,
): Promise<void> {
  const reservations = await client.query<{ id: string }>(
    `SELECT id
       FROM asset_reservations
      WHERE character_id = $1
        AND business_type = $2
        AND business_id = $3
        AND status = 'ACTIVE'
      ORDER BY asset_type ASC, asset_id ASC, created_at ASC
      FOR UPDATE`,
    [characterId, BREAKTHROUGH_BUSINESS_TYPE, breakthroughRunId],
  );

  for (const reservation of reservations.rows) {
    await assetRepository.releaseOnTransaction(client, {
      characterId,
      reservationId: reservation.id,
      reasonCode,
      referenceType: BREAKTHROUGH_REFERENCE_TYPE,
      referenceId: breakthroughRunId,
      configVersion,
    });
  }
}

async function consumeReservations(
  client: PoolClient,
  assetRepository: AssetRepository,
  characterId: string,
  breakthroughRunId: string,
  configVersion: string,
  reasonCode: string,
): Promise<{ readonly transactionId: string | null }> {
  const reservations = await client.query<{ id: string }>(
    `SELECT id
       FROM asset_reservations
      WHERE character_id = $1
        AND business_type = $2
        AND business_id = $3
        AND status = 'ACTIVE'
      ORDER BY asset_type ASC, asset_id ASC, created_at ASC
      FOR UPDATE`,
    [characterId, BREAKTHROUGH_BUSINESS_TYPE, breakthroughRunId],
  );

  if (reservations.rows.length === 0) {
    throw conflict('breakthrough_reservations_missing');
  }

  let transactionId: string | null = null;
  for (const reservation of reservations.rows) {
    const consumed = await assetRepository.consumeOnTransaction(client, {
      characterId,
      reservationId: reservation.id,
      reasonCode,
      referenceType: BREAKTHROUGH_REFERENCE_TYPE,
      referenceId: breakthroughRunId,
      configVersion,
    });
    transactionId = consumed.transactionId;
  }
  return { transactionId };
}

function nowUs(): bigint {
  return BigInt(Date.now()) * 1_000n;
}

function settledWriteResponse(response: BreakthroughRunResponse): {
  readonly statusCode: 200;
  readonly response: BreakthroughRunResponse;
} {
  return { statusCode: 200, response };
}

@Injectable()
export class BreakthroughService {
  public constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(breakthroughRepositoryToken) private readonly breakthroughRepository: BreakthroughRepository,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
    @Inject(databasePoolToken) private readonly pool: DatabasePool,
  ) {}

  public async getNextBreakthrough(request: FastifyRequest, characterId: string): Promise<BreakthroughNextResponse> {
    await this.authService.assertCharacterOwnership(request, characterId);
    const accountId = await this.authService.requireCurrentAccountId(request);
    const state = await loadCharacterState(this.pool, characterId, false);
    if (!state) {
      throw notFound();
    }
    const inventory = await this.assetRepository.getInventory(characterId, accountId);
    if (!inventory) {
      throw notFound();
    }
    return {
      character: {
        character_id: state.character_id,
        state_version: stateVersionAsNumber(state.state_version),
        active_config_version: state.active_config_version,
      },
      breakthrough: mapBreakthroughPreview(previewBreakthrough(previewInput(state.cultivation_xp, inventory))),
      config_version: this.configRegistry.manifest.config_version,
    };
  }

  public async previewBreakthrough(request: FastifyRequest, characterId: string, body: unknown): Promise<BreakthroughNextResponse> {
    void body;
    return this.getNextBreakthrough(request, characterId);
  }

  public async startBreakthrough(request: FastifyRequest, characterId: string, body: unknown): Promise<BreakthroughRunResponse> {
    const parsed = parseStartRequest(body);
    if (parsed.configVersion !== this.configRegistry.manifest.config_version) {
      throw badRequest('config_version_MISMATCH');
    }

    return this.settlementService.executeSettledWrite<BreakthroughRunResponse>(request, characterId, {
      operationType: BREAKTHROUGH_OPERATION_START,
      request: body,
      execute: async ({ client }) => {
        const state = await loadCharacterState(client, characterId, true);
        if (!state) {
          throw notFound();
        }

        if (state.state_version !== parsed.expectedStateVersion.toString()) {
          throw conflict('expected_state_version');
        }
        if (state.active_config_version !== parsed.configVersion) {
          throw badRequest('config_version_MISMATCH');
        }

        const latestRun = await this.breakthroughRepository.getLatestRun(characterId);
        if (state.realm_stage_id === foundationBreakthroughConfig.targetRealmId && latestRun?.status === 'COMPLETED') {
          return settledWriteResponse(this.toRunResponse(state, latestRun));
        }

        const activeRun = await this.breakthroughRepository.lockActiveRun(client, characterId);
        if (activeRun !== null) {
          const recovery = resolveRestoreBreakthroughRun({
            run: toRulesRun(activeRun),
            restoredAtUs: nowUs(),
          });
          if (recovery.eligibility.reason === 'EXPIRED') {
            await releaseReservations(
              client,
              this.assetRepository,
              characterId,
              activeRun.breakthroughRunId,
              activeRun.configVersion,
              BREAKTHROUGH_OPERATION_RECOVER,
            );
            const recovered = await this.breakthroughRepository.markRecoveredOnTransaction(client, {
              breakthroughRunId: activeRun.breakthroughRunId,
              characterId,
              recoveredAt: new Date(),
            });
            if (!recovered) {
              throw conflict('breakthrough_run_recovery_failed');
            }
            const stateVersion = await bumpStateVersion(client, characterId, state.state_version);
            const recoveredState = { ...state, state_version: stateVersion };
            return settledWriteResponse(this.toRunResponse(recoveredState, recovered));
          }
          return settledWriteResponse(this.toRunResponse(state, activeRun));
        }

        const accountId = await this.authService.requireCurrentAccountId(request);
        const inventory = await this.assetRepository.getInventoryOnTransaction(client, characterId, accountId);
        if (!inventory) {
          throw notFound();
        }
        const preview = previewBreakthrough(previewInput(state.cultivation_xp, inventory));
        if (!preview.allSatisfied) {
          throw unprocessable('BREAKTHROUGH_REQUIREMENTS_NOT_MET', {
            config_version: preview.configVersion,
          });
        }

        const runId = randomUUID();
        const startedAtUs = nowUs();
        const resolved = resolveStartBreakthroughTrial({
          runId,
          characterId,
          startedAtUs,
          preview,
          config: foundationBreakthroughConfig,
          existingRun: latestRun === null ? null : toRulesRun(latestRun),
        });
        if (resolved.idempotent) {
          if (latestRun === null) {
            throw conflict('breakthrough_run_idempotent_missing');
          }
          return settledWriteResponse(this.toRunResponse(state, latestRun));
        }

        for (const reservation of resolved.run.reservationSnapshot) {
          await this.assetRepository.reserveOnTransaction(client, {
            characterId,
            businessType: BREAKTHROUGH_BUSINESS_TYPE,
            businessId: resolved.run.breakthroughRunId,
            assetType: reservation.assetType,
            assetId: reservation.assetId,
            quantity: reservation.quantity,
            reasonCode: BREAKTHROUGH_OPERATION_START,
            referenceType: BREAKTHROUGH_REFERENCE_TYPE,
            referenceId: resolved.run.breakthroughRunId,
            configVersion: this.configRegistry.manifest.config_version,
            expiresAt: dateFromMicroseconds(resolved.run.expiresAtUs),
          });
        }

        const created = await this.breakthroughRepository.createRunOnTransaction(client, {
          breakthroughRunId: resolved.run.breakthroughRunId,
          characterId,
          breakthroughConfigId: resolved.run.breakthroughConfigId,
          configVersion: this.configRegistry.manifest.config_version,
          formulaVersion: this.configRegistry.manifest.formula_version,
          status: resolved.run.status,
          currentNodeId: resolved.run.currentNodeId,
          createdAt: dateFromMicroseconds(resolved.run.createdAtUs),
          trialDeadlineAt: dateFromMicroseconds(resolved.run.trialDeadlineAtUs),
          expiresAt: dateFromMicroseconds(resolved.run.expiresAtUs),
          selectedChoiceId: resolved.run.selectedChoiceId,
          selectedRouteId: resolved.run.selectedRouteId,
          selectedRouteRisk: resolved.run.selectedRouteRisk,
          selectedAt: resolved.run.selectedAtUs === null ? null : dateFromMicroseconds(resolved.run.selectedAtUs),
          finalizedAt: resolved.run.finalizedAtUs === null ? null : dateFromMicroseconds(resolved.run.finalizedAtUs),
          abandonedAt: resolved.run.abandonedAtUs === null ? null : dateFromMicroseconds(resolved.run.abandonedAtUs),
          releasedAt: resolved.run.releasedAtUs === null ? null : dateFromMicroseconds(resolved.run.releasedAtUs),
          reservationSnapshot: resolved.run.reservationSnapshot,
          previewSnapshot: resolved.run.previewSnapshot,
          result: resolved.run.result,
        });
        const stateVersion = await bumpStateVersion(client, characterId, state.state_version);
        return settledWriteResponse(this.toRunResponse({ ...state, state_version: stateVersion }, created));
      },
    }).then((result) => result.response);
  }

  public async getBreakthroughRun(request: FastifyRequest, runId: string): Promise<BreakthroughRunResponse> {
    const run = await this.breakthroughRepository.getRun(runId);
    if (!run) {
      throw notFound();
    }
    await this.authService.assertCharacterOwnership(request, run.characterId);
    const state = await loadCharacterState(this.pool, run.characterId, false);
    if (!state) {
      throw notFound();
    }
    return this.toRunResponse(state, run);
  }

  public async chooseBreakthroughRoute(request: FastifyRequest, runId: string, body: unknown): Promise<BreakthroughRunResponse> {
    const parsed = parseChoiceRequest(body);
    return this.settlementService.executeSettledWrite<BreakthroughRunResponse>(request, await this.resolveCharacterId(request, runId), {
      operationType: BREAKTHROUGH_OPERATION_CHOICE,
      request: body,
      execute: async ({ client }) => {
        const run = await this.breakthroughRepository.lockRun(client, runId);
        if (!run) {
          throw notFound();
        }
        const state = await loadCharacterState(client, run.characterId, true);
        if (!state) {
          throw notFound();
        }
        if (run.status === 'COMPLETED' && run.result !== null) {
          return settledWriteResponse(this.toRunResponse(state, run));
        }
        if (run.status === 'ABANDONED' || run.status === 'FAILED_RECOVERABLE') {
          throw conflict('breakthrough_run_not_active');
        }
        const routeChoice = foundationBreakthroughConfig.choices.find((choice) => choice.choiceId === parsed.choiceId);
        if (!routeChoice) {
          throw badRequest('choice_id_UNKNOWN');
        }
        const ruleRun = toRulesRun(run);
        if (ruleRun.runVersion !== parsed.expectedRunVersion) {
          throw conflict('expected_run_version');
        }
        const choice = resolveSelectBreakthroughRoute({
          run: ruleRun,
          choiceId: parsed.choiceId,
          chosenAtUs: nowUs(),
          expectedRunVersion: parsed.expectedRunVersion,
        });
        if (choice.idempotent) {
          return settledWriteResponse(this.toRunResponse(state, run));
        }
        const updated = await this.breakthroughRepository.markChoiceOnTransaction(client, {
          breakthroughRunId: runId,
          characterId: run.characterId,
          choiceId: choice.run.selectedChoiceId ?? parsed.choiceId,
          routeId: choice.run.selectedRouteId ?? routeChoice.routeId,
          routeRisk: choice.run.selectedRouteRisk ?? routeChoice.risk,
          chosenAt: new Date(),
        });
        if (!updated) {
          throw conflict('breakthrough_run_choice_conflict');
        }
        const stateVersion = await bumpStateVersion(client, run.characterId, state.state_version);
        return settledWriteResponse(this.toRunResponse({ ...state, state_version: stateVersion }, updated));
      },
    }).then((result) => result.response);
  }

  public async finalizeBreakthroughRun(request: FastifyRequest, runId: string, body: unknown): Promise<BreakthroughRunResponse> {
    void body;
    return this.settlementService.executeSettledWrite<BreakthroughRunResponse>(request, await this.resolveCharacterId(request, runId), {
      operationType: BREAKTHROUGH_OPERATION_FINALIZE,
      request: body ?? {},
      execute: async ({ client }) => {
        const run = await this.breakthroughRepository.lockRun(client, runId);
        if (!run) {
          throw notFound();
        }
        const state = await loadCharacterState(client, run.characterId, true);
        if (!state) {
          throw notFound();
        }
        if (run.status === 'COMPLETED' && run.result !== null) {
          return settledWriteResponse(this.toRunResponse(state, run));
        }
        const ruleRun = toRulesRun(run);
        const now = nowUs();
        const eligibility = evaluateBreakthroughFinalizeEligibility({
          run: ruleRun,
          restoredAtUs: now,
        });
        if (!eligibility.eligible) {
          if (eligibility.reason === 'EXPIRED') {
            await releaseReservations(
              client,
              this.assetRepository,
              run.characterId,
              runId,
              run.configVersion,
              BREAKTHROUGH_OPERATION_RECOVER,
            );
            const recovered = await this.breakthroughRepository.markRecoveredOnTransaction(client, {
              breakthroughRunId: runId,
              characterId: run.characterId,
              recoveredAt: new Date(),
            });
            if (!recovered) {
              throw conflict('breakthrough_run_recovery_failed');
            }
            const stateVersion = await bumpStateVersion(client, run.characterId, state.state_version);
            return settledWriteResponse(this.toRunResponse({ ...state, state_version: stateVersion }, recovered));
          }
          throw conflict(eligibility.reason);
        }

        const finalized = resolveFinalizeBreakthroughRun({
          run: ruleRun,
          restoredAtUs: now,
        });
        if (finalized.idempotent) {
          return settledWriteResponse(this.toRunResponse(state, run));
        }

        const consumed = await consumeReservations(
          client,
          this.assetRepository,
          run.characterId,
          runId,
          run.configVersion,
          BREAKTHROUGH_OPERATION_FINALIZE,
        );
        const updated = await this.breakthroughRepository.markFinalizedOnTransaction(client, {
          breakthroughRunId: runId,
          characterId: run.characterId,
          finalizedAt: new Date(),
          result: finalized.run.result ?? null,
        });
        if (!updated) {
          throw conflict('breakthrough_run_finalize_conflict');
        }

        await updateRealmStage(client, run.characterId, foundationBreakthroughConfig.targetRealmId);
        const stateVersion = await bumpStateVersion(client, run.characterId, state.state_version);
        if (consumed.transactionId !== null) {
          await createOutboxEvent(client, consumed.transactionId, 'breakthrough.finalized', runId, {
            breakthrough_run_id: runId,
            breakthrough_config_id: run.breakthroughConfigId,
            config_version: run.configVersion,
            unlocked_realm_id: foundationBreakthroughConfig.targetRealmId,
            unlock_bundle_id: foundationBreakthroughConfig.unlockBundleId,
          });
        }
        return settledWriteResponse(this.toRunResponse({ ...state, state_version: stateVersion }, updated));
      },
    }).then((result) => result.response);
  }

  public async abandonBreakthroughRun(request: FastifyRequest, runId: string, body: unknown): Promise<BreakthroughRunResponse> {
    void body;
    return this.settlementService.executeSettledWrite<BreakthroughRunResponse>(request, await this.resolveCharacterId(request, runId), {
      operationType: BREAKTHROUGH_OPERATION_ABANDON,
      request: body ?? {},
      execute: async ({ client }) => {
        const run = await this.breakthroughRepository.lockRun(client, runId);
        if (!run) {
          throw notFound();
        }
        const state = await loadCharacterState(client, run.characterId, true);
        if (!state) {
          throw notFound();
        }
        if (run.status === 'ABANDONED' || run.status === 'COMPLETED') {
          return settledWriteResponse(this.toRunResponse(state, run));
        }
        await releaseReservations(
          client,
          this.assetRepository,
          run.characterId,
          runId,
          run.configVersion,
          BREAKTHROUGH_OPERATION_ABANDON,
        );
        const abandoned = resolveAbandonBreakthroughRun({
          run: toRulesRun(run),
          restoredAtUs: nowUs(),
        });
        if (abandoned.idempotent) {
          return settledWriteResponse(this.toRunResponse(state, run));
        }
        const updated = await this.breakthroughRepository.markAbandonedOnTransaction(client, {
          breakthroughRunId: runId,
          characterId: run.characterId,
          endedAt: new Date(),
        });
        if (!updated) {
          throw conflict('breakthrough_run_abandon_conflict');
        }
        const stateVersion = await bumpStateVersion(client, run.characterId, state.state_version);
        return settledWriteResponse(this.toRunResponse({ ...state, state_version: stateVersion }, updated));
      },
    }).then((result) => result.response);
  }

  private async resolveCharacterId(request: FastifyRequest, runId: string): Promise<string> {
    const run = await this.breakthroughRepository.getRun(runId);
    if (!run) {
      throw notFound();
    }
    await this.authService.assertCharacterOwnership(request, run.characterId);
    return run.characterId;
  }

  private toRunResponse(state: CharacterStateRow, run: BreakthroughRunRecord): BreakthroughRunResponse {
    return {
      character: {
        character_id: state.character_id,
        state_version: stateVersionAsNumber(state.state_version),
        active_config_version: state.active_config_version,
      },
      config_version: run.configVersion,
      run: fromRulesRun(toRulesRun(run), run.configVersion, run.formulaVersion),
    };
  }
}
