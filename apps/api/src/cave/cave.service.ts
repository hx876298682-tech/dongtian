import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type {
  CaveFacilityConfig,
  ConfigRegistry,
} from '@dongtian/config-schema';
import {
  createCaveFacilityCatalog,
  getCaveFacilityRule,
  microseconds,
  resolveCaveModifierSnapshotBoundary,
  type CaveFacilityModifier,
  type CaveFacilityRuleInput,
  type CaveFacilityRule,
  type CaveRealmGroup,
  type CaveScope,
} from '@dongtian/game-rules';
import type {
  AssetRepository,
  CaveBuildTaskRecord,
  CaveRepository,
  CaveStateRecord,
  DatabasePool,
  InventorySnapshot,
  PoolClient,
} from '@dongtian/database';

import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { SettlementService } from '../settlement/settlement.service.js';
import { caveRepositoryToken } from './cave.tokens.js';

type JsonRecord = Record<string, unknown>;

type CharacterStateRow = {
  readonly character_id: string;
  readonly state_version: string;
  readonly active_config_version: string;
  readonly realm_stage_id: string;
};

type ParsedBuildRequest = {
  readonly facilityId: string;
  readonly targetLevel: number;
  readonly expectedStateVersion: bigint;
  readonly configVersion: string;
};

type CaveRuleSnapshot = CaveFacilityRule & {
  readonly facilityKind: CaveFacilityConfig['facility_kind'];
  readonly nameKey: string;
  readonly descriptionKey: string;
};

type CaveResponse = {
  readonly character: {
    readonly character_id: string;
    readonly state_version: number;
    readonly active_config_version: string;
  };
  readonly cave: {
    readonly as_of: string;
    readonly config_version: string;
    readonly facilities: readonly CaveFacilityView[];
  };
};

type CaveFacilityView = {
  readonly facility_config_id: string;
  readonly facility_kind: CaveFacilityConfig['facility_kind'];
  readonly name_key: string;
  readonly description_key: string;
  readonly level: number;
  readonly current_modifier: CaveFacilityModifier | null;
  readonly next_level_rule: {
    readonly level: number;
    readonly required_realm_group: CaveRealmGroup;
    readonly spirit_stone_cost: string;
    readonly material_costs: readonly { readonly itemId: string; readonly quantity: string }[];
    readonly build_duration_us: string;
    readonly modifier: CaveFacilityModifier;
    readonly scope: string;
  } | null;
  readonly build_task: {
    readonly build_task_id: string;
    readonly facility_config_id: string;
    readonly from_level: number;
    readonly target_level: number;
    readonly started_at: string;
    readonly projected_completion_at: string;
    readonly completed_at: string | null;
    readonly status: 'RUNNING' | 'COMPLETED';
    readonly cost_snapshot: {
      readonly facility_config_id: string;
      readonly facility_kind: CaveFacilityConfig['facility_kind'];
      readonly name_key: string;
      readonly description_key: string;
      readonly level: number;
      readonly required_realm_group: CaveRealmGroup;
      readonly spirit_stone_cost: string;
      readonly material_costs: readonly { readonly itemId: string; readonly quantity: string }[];
      readonly build_duration_us: string;
      readonly modifier: CaveFacilityModifier;
      readonly scope: string;
    };
    readonly completion_reached: boolean;
    readonly completion_boundary: {
      readonly currentCycleApplies: boolean;
      readonly nextCycleApplies: boolean;
    };
  } | null;
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

function forbidden(reason: string): ForbiddenException {
  return new ForbiddenException({
    code: 'FEATURE_LOCKED',
    message_key: 'error.feature_locked',
    details: { reason },
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

function requiredNonNegativeInteger(record: JsonRecord, field: string): bigint {
  const value = record[field];
  if (value === undefined || value === null) {
    throw badRequest(`${field}_REQUIRED`);
  }
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

function toMicroseconds(date: Date): bigint {
  return BigInt(date.getTime()) * 1_000n;
}

function fromMicroseconds(value: bigint): Date {
  return new Date(Number(value / 1_000n));
}

function mapRealmGroup(value: string): CaveRealmGroup {
  if (value.includes('mortal')) {
    return 'MORTAL';
  }
  if (value.includes('foundation')) {
    return 'FOUNDATION';
  }
  return 'QI';
}

function caveKindLabel(kind: CaveFacilityConfig['facility_kind']): string {
  if (kind === 'JULING_ROOM') {
    return '聚灵室';
  }
  if (kind === 'ALCHEMY_ROOM') {
    return '炼丹房';
  }
  return '炼器房';
}

function modifierFromEffect(effectType: CaveFacilityConfig['effect_type'], effectValue: string): CaveFacilityModifier {
  const statMap: Record<CaveFacilityConfig['effect_type'], CaveFacilityModifier['stat']> = {
    cultivation_efficiency: 'cultivation_xp',
    alchemy_efficiency: 'alchemy_xp',
    forging_efficiency: 'refinement_xp',
  };
  return {
    stat: statMap[effectType],
    operation: 'MULTIPLY',
    value: effectValue,
  };
}

function normalizeCaveScope(scope: CaveFacilityConfig['scope']): CaveScope {
  return scope === 'MVP_ENDGAME' || scope === 'ANCHOR' ? 'MVP_ENDGAME' : 'MVP';
}

function buildRuleInput(facility: CaveFacilityConfig): CaveFacilityRuleInput {
  return {
    facilityId: facility.facility_id,
    facilityName: caveKindLabel(facility.facility_kind),
    level: facility.level,
    requiredRealmGroup: mapRealmGroup(facility.realm_required),
    spiritStoneCost: facility.spirit_stone_cost,
    materialCosts: facility.material_costs.map((material) => ({
      itemId: material.item_id,
      quantity: material.quantity,
    })),
    buildDurationUs: microseconds(BigInt(facility.build_duration_us)),
    modifier: modifierFromEffect(facility.effect_type, facility.effect_value),
    scope: normalizeCaveScope(facility.scope),
  };
}

function buildCatalog(registry: ConfigRegistry): readonly CaveRuleSnapshot[] {
  return createCaveFacilityCatalog(registry.caveFacilities.map(buildRuleInput)).map((rule) => {
    const config = registry.caveFacilities.find((candidate) =>
      candidate.facility_id === rule.facilityId && candidate.level === 1,
    ) ?? registry.caveFacilities.find((candidate) => candidate.facility_id === rule.facilityId);
    if (config === undefined) {
      throw new Error(`CONFIG_NOT_FOUND:cave_facility:${rule.facilityId}`);
    }
    return {
      ...rule,
      facilityKind: config.facility_kind,
      nameKey: config.name_key,
      descriptionKey: config.description_key,
    };
  });
}

function parseBuildRequest(body: unknown): ParsedBuildRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  return {
    facilityId: requiredString(body, 'facility_id'),
    targetLevel: requiredPositiveInteger(body, 'target_level'),
    expectedStateVersion: requiredNonNegativeInteger(body, 'expected_state_version'),
    configVersion: requiredString(body, 'config_version'),
  };
}

function projectedBuildTask(task: CaveBuildTaskRecord, now: Date): {
  readonly status: 'RUNNING' | 'COMPLETED';
  readonly completionReached: boolean;
  readonly completedAt: Date | null;
  readonly completionBoundary: {
    readonly currentCycleApplies: boolean;
    readonly nextCycleApplies: boolean;
  };
} {
  const completionReached = task.completeAt <= now;
  const completedAt = completionReached ? task.completeAt : null;
  const nowUs = toMicroseconds(now);
  const cycleEndUs = microseconds(nowUs);
  const cycleStartUs = nowUs > 0n ? microseconds(nowUs - 1n) : microseconds(0n);
  return {
    status: completionReached ? 'COMPLETED' : 'RUNNING',
    completionReached,
    completedAt,
    completionBoundary: resolveCaveModifierSnapshotBoundary({
      cycleStartUs,
      cycleEndUs,
      facilityCompletedAtUs: completedAt === null ? null : microseconds(toMicroseconds(completedAt)),
    }),
  };
}

function cloneMaterialCosts(costs: CaveRuleSnapshot['materialCosts']): { readonly itemId: string; readonly quantity: string }[] {
  return costs.map((cost) => ({ ...cost }));
}

function cloneModifier(modifier: CaveFacilityModifier): CaveFacilityModifier {
  return { ...modifier };
}

function buildResponse(
  character: CharacterStateRow,
  cave: CaveStateRecord | null,
  catalog: readonly CaveRuleSnapshot[],
  now: Date,
  configVersion: string,
): CaveResponse {
  const facilityCatalog = catalog.filter(
    (rule, index) => catalog.findIndex((candidate) => candidate.facilityId === rule.facilityId) === index,
  );
  const facilitiesById = new Map((cave?.facilities ?? []).map((facility) => [facility.facilityConfigId, facility] as const));
  const tasksByFacility = new Map<string, CaveBuildTaskRecord>();
  for (const task of cave?.buildTasks ?? []) {
    const current = tasksByFacility.get(task.facilityConfigId);
    if (current === undefined || current.status !== 'RUNNING' || task.completeAt < current.completeAt) {
      tasksByFacility.set(task.facilityConfigId, task);
    }
  }

  return {
    character: {
      character_id: character.character_id,
      state_version: stateVersionAsNumber(character.state_version),
      active_config_version: character.active_config_version,
    },
    cave: {
      as_of: now.toISOString(),
      config_version: configVersion,
      facilities: facilityCatalog.map((rule) => {
        const persisted = facilitiesById.get(rule.facilityId);
        const task = tasksByFacility.get(rule.facilityId) ?? null;
        const projected = task === null ? null : projectedBuildTask(task, now);
        const level = projected?.completionReached === true && task !== null
          ? Math.max(persisted?.level ?? 0, task.targetLevel)
          : persisted?.level ?? 0;
        const effectiveRule = catalog.find((candidate) => candidate.facilityId === rule.facilityId && candidate.level === level) ?? null;
        const nextRule = catalog.find((candidate) => candidate.facilityId === rule.facilityId && candidate.level === level + 1) ?? null;
        const taskRule = task === null ? null : catalog.find((candidate) => candidate.facilityId === rule.facilityId && candidate.level === task.targetLevel) ?? null;

        return {
          facility_config_id: rule.facilityId,
          facility_kind: rule.facilityKind,
          name_key: rule.nameKey,
          description_key: rule.descriptionKey,
          level,
          current_modifier: effectiveRule === null ? null : cloneModifier(effectiveRule.modifier),
          next_level_rule: nextRule === null ? null : {
            level: nextRule.level,
            required_realm_group: nextRule.requiredRealmGroup,
            spirit_stone_cost: nextRule.spiritStoneCost,
            material_costs: cloneMaterialCosts(nextRule.materialCosts),
            build_duration_us: nextRule.buildDurationUs.toString(),
            modifier: cloneModifier(nextRule.modifier),
            scope: nextRule.scope,
          },
          build_task: task === null ? null : {
            build_task_id: task.id,
            facility_config_id: task.facilityConfigId,
            from_level: task.fromLevel,
            target_level: task.targetLevel,
            started_at: task.startedAt.toISOString(),
            projected_completion_at: task.completeAt.toISOString(),
            completed_at: projected?.completedAt === null ? null : task.completeAt.toISOString(),
            status: projected?.status ?? task.status,
            cost_snapshot: {
              facility_config_id: rule.facilityId,
              facility_kind: rule.facilityKind,
              name_key: rule.nameKey,
              description_key: rule.descriptionKey,
              level: task.targetLevel,
              required_realm_group: taskRule?.requiredRealmGroup ?? rule.requiredRealmGroup,
              spirit_stone_cost: taskRule?.spiritStoneCost ?? '0',
              material_costs: cloneMaterialCosts(taskRule?.materialCosts ?? []),
              build_duration_us: taskRule?.buildDurationUs.toString() ?? '0',
              modifier: taskRule === null ? cloneModifier(rule.modifier) : cloneModifier(taskRule.modifier),
              scope: taskRule?.scope ?? rule.scope,
            },
            completion_reached: projected?.completionReached ?? false,
            completion_boundary: projected?.completionBoundary ?? {
              currentCycleApplies: false,
              nextCycleApplies: false,
            },
          },
        };
      }),
    },
  };
}

function createTransaction(
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
  return client.query<{ id: string }>(
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
  ).then((result) => {
    const row = result.rows[0];
    if (!row) {
      throw new Error('CAVE_TRANSACTION_NOT_CREATED');
    }
    return row.id;
  });
}

function insertOutbox(
  client: PoolClient,
  transactionId: string,
  characterId: string,
  eventType: string,
  payload: JsonRecord,
): Promise<void> {
  return client.query(
    `INSERT INTO outbox_events
      (event_type, aggregate_type, aggregate_id, transaction_id, payload, available_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)`,
    [eventType, 'character', characterId, transactionId, JSON.stringify(payload)],
  ).then(() => undefined);
}

function ensureCostAvailability(
  inventory: InventorySnapshot,
  rule: Pick<CaveFacilityRule, 'materialCosts' | 'spiritStoneCost'>,
): void {
  for (const cost of rule.materialCosts) {
    const balance = inventory.items.find((entry) => entry.assetId === cost.itemId);
    if (!balance || BigInt(balance.availableQuantity) < BigInt(cost.quantity)) {
      throw unprocessable('INSUFFICIENT_ITEM', {
        asset_id: cost.itemId,
        required: cost.quantity,
        available: balance?.availableQuantity ?? '0',
      });
    }
  }

  const spiritStone = inventory.currencies.find((entry) => entry.assetId === 'currency.spirit_stone');
  if (!spiritStone || BigInt(spiritStone.availableQuantity) < BigInt(rule.spiritStoneCost)) {
    throw unprocessable('INSUFFICIENT_CURRENCY', {
      asset_id: 'currency.spirit_stone',
      required: rule.spiritStoneCost,
      available: spiritStone?.availableQuantity ?? '0',
    });
  }
}

@Injectable()
export class CaveService {
  public constructor(
    @Inject(caveRepositoryToken) private readonly caveRepository: CaveRepository,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(databasePoolToken) private readonly pool: DatabasePool,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
  ) {}

  public async getCave(request: FastifyRequest, characterId: string): Promise<CaveResponse> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const [character, cave] = await Promise.all([
      this.loadCharacter(characterId, accountId),
      this.caveRepository.getState(characterId),
    ]);
    if (!character) {
      throw notFound();
    }
    return buildResponse(character, cave, buildCatalog(this.configRegistry), new Date(), this.configRegistry.manifest.config_version);
  }

  public async build(request: FastifyRequest, characterId: string, body: unknown): Promise<CaveResponse> {
    const parsed = parseBuildRequest(body);
    if (parsed.configVersion !== this.configRegistry.manifest.config_version) {
      throw badRequest('config_version_MISMATCH');
    }

    const accountId = await this.authService.requireWriteAccess(request);
    await this.authService.assertCharacterOwnership(request, characterId);
    const now = new Date();
    const catalog = buildCatalog(this.configRegistry);

    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'CAVE_BUILD_START',
      request: body,
      execute: async ({ client }) => {
        const character = await this.loadCharacterOnTransaction(client, characterId, accountId);
        if (!character) {
          throw notFound();
        }
        if (character.state_version !== parsed.expectedStateVersion.toString()) {
          throw conflict('expected_state_version');
        }
        if (character.active_config_version !== parsed.configVersion) {
          throw badRequest('config_version_MISMATCH');
        }

        await this.caveRepository.ensureFacilitiesOnTransaction(client, {
          characterId,
          facilityConfigIds: [...new Set(catalog.map((rule) => rule.facilityId))],
        });

        const dueTasks = await this.caveRepository.listDueBuildTasksOnTransaction(client, {
          characterId,
          now,
        });
        for (const task of dueTasks) {
          const transactionId = await createTransaction(client, {
            characterId,
            operationType: 'CAVE_BUILD_COMPLETE',
            reasonCode: 'CAVE_BUILD_COMPLETE',
            referenceType: 'CAVE_BUILD_TASK',
            referenceId: task.id,
            configVersion: task.configVersion,
          });
          await this.caveRepository.completeBuildTaskOnTransaction(client, {
            characterId,
            buildTaskId: task.id,
            completeTransactionId: transactionId,
          });
        }

        const caveState = await this.caveRepository.lockState(client, characterId);
        if (!caveState) {
          throw notFound();
        }

        const facility = caveState.facilities.find((entry) => entry.facilityConfigId === parsed.facilityId);
        const currentLevel = facility?.level ?? 0;
        const existingTask = caveState.buildTasks.find((entry) => entry.facilityConfigId === parsed.facilityId && entry.status === 'RUNNING');
        if (existingTask) {
          throw conflict('CAVE_BUILD_CONFLICT');
        }

        const rule = getCaveFacilityRule(catalog, parsed.facilityId, parsed.targetLevel);
        const currentRealmGroup = this.configRegistry.getRealm(character.realm_stage_id).realm_group as CaveRealmGroup;
        if (parsed.targetLevel !== currentLevel + 1) {
          throw badRequest('target_level_NON_CONTIGUOUS');
        }
        if (!this.realmGroupMeetsRequirement(currentRealmGroup, rule.requiredRealmGroup)) {
          throw forbidden(`realm_required:${rule.requiredRealmGroup}`);
        }
        if (rule.requiredFacilityLevel !== currentLevel) {
          throw conflict('facility_level_conflict');
        }

        const inventory = await this.assetRepository.getInventoryOnTransaction(client, characterId, accountId);
        if (!inventory) {
          throw notFound();
        }
        ensureCostAvailability(inventory, rule);

        const transactionId = await createTransaction(client, {
          characterId,
          operationType: 'CAVE_BUILD_START',
          reasonCode: 'CAVE_BUILD_START',
          referenceType: 'CAVE_BUILD_TASK',
          referenceId: parsed.facilityId,
          configVersion: parsed.configVersion,
        });

        for (const cost of rule.materialCosts) {
          await this.assetRepository.deductOnTransaction(client, {
            characterId,
            reasonCode: 'CAVE_BUILD_COST',
            referenceType: 'CAVE_BUILD_TASK',
            referenceId: parsed.facilityId,
            configVersion: parsed.configVersion,
            assetType: 'ITEM',
            assetId: cost.itemId,
            quantity: cost.quantity,
          });
        }
        await this.assetRepository.deductOnTransaction(client, {
          characterId,
          reasonCode: 'CAVE_BUILD_COST',
          referenceType: 'CAVE_BUILD_TASK',
          referenceId: parsed.facilityId,
          configVersion: parsed.configVersion,
          assetType: 'CURRENCY',
          assetId: 'currency.spirit_stone',
          quantity: rule.spiritStoneCost,
        });

        const buildTask = await this.caveRepository.createBuildTaskOnTransaction(client, {
          characterId,
          facilityConfigId: parsed.facilityId,
          fromLevel: currentLevel,
          targetLevel: parsed.targetLevel,
          startedAt: now,
          completeAt: fromMicroseconds(toMicroseconds(now) + rule.buildDurationUs),
          costTransactionId: transactionId,
          configVersion: parsed.configVersion,
        });

        const nextStateVersion = await this.bumpStateVersion(client, characterId, character.state_version);
        const updatedCharacter: CharacterStateRow = {
          ...character,
          state_version: nextStateVersion,
        };
        const updatedCave = await this.caveRepository.lockState(client, characterId);
        if (!updatedCave) {
          throw notFound();
        }
        await insertOutbox(client, transactionId, characterId, 'cave.build_started', {
          character_id: characterId,
          build_task_id: buildTask.id,
          facility_config_id: parsed.facilityId,
          from_level: currentLevel,
          target_level: parsed.targetLevel,
          complete_at: buildTask.completeAt.toISOString(),
        });

        return {
          statusCode: 201,
          response: buildResponse(updatedCharacter, updatedCave, catalog, now, this.configRegistry.manifest.config_version),
        };
      },
    });

    return result.response;
  }

  private async loadCharacter(characterId: string, accountId: string): Promise<CharacterStateRow | null> {
    const result = await this.pool.query<CharacterStateRow>(
      `SELECT c.id AS character_id,
              c.state_version::text AS state_version,
              c.active_config_version,
              cp.realm_stage_id
         FROM characters c
         INNER JOIN character_progression cp ON cp.character_id = c.id
        WHERE c.id = $1
          AND c.account_id = $2`,
      [characterId, accountId],
    );
    return result.rows[0] ?? null;
  }

  private async loadCharacterOnTransaction(
    client: PoolClient,
    characterId: string,
    accountId: string,
  ): Promise<CharacterStateRow | null> {
    const result = await client.query<CharacterStateRow>(
      `SELECT c.id AS character_id,
              c.state_version::text AS state_version,
              c.active_config_version,
              cp.realm_stage_id
         FROM characters c
         INNER JOIN character_progression cp ON cp.character_id = c.id
        WHERE c.id = $1
          AND c.account_id = $2
        FOR UPDATE`,
      [characterId, accountId],
    );
    return result.rows[0] ?? null;
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

  private realmGroupMeetsRequirement(current: CaveRealmGroup, required: CaveRealmGroup): boolean {
    const order: Record<CaveRealmGroup, number> = {
      MORTAL: 0,
      QI: 1,
      FOUNDATION: 2,
    };
    return order[current] >= order[required];
  }
}
