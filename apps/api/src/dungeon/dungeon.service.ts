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

import type { ConfigRegistry, DungeonConfig as ConfigDungeonConfig, LootTableConfig, MonsterConfig } from '@dongtian/config-schema';
import type {
  AssetRepository,
  DatabasePool,
  DungeonOpportunityMutationResult,
  DungeonRepository,
  DungeonRunRecord,
  JsonValue,
  PoolClient,
} from '@dongtian/database';
import {
  enterDungeonRun as resolveDungeonEntry,
  finalizeDungeonRun as resolveDungeonFinalize,
  prepareDungeonRun as resolveDungeonPreview,
  resolveDungeonTimeout as resolveDungeonChoiceTimeout,
  restoreDungeonRunState,
  submitDungeonChoice as resolveDungeonChoice,
  type CombatantInput,
  type DungeonConfig as DungeonRulesConfig,
  type DungeonRunState as DungeonRulesRunState,
} from '@dongtian/game-rules';

import { AuthService } from '../auth/auth.service.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { SettlementService } from '../settlement/settlement.service.js';
import { dungeonRepositoryToken } from './dungeon.tokens.js';

type JsonRecord = Record<string, unknown>;

type CharacterRow = {
  readonly characterId: string;
  readonly stateVersion: string;
  readonly activeConfigVersion: string;
};

type DungeonOpportunityResponse = {
  readonly character: {
    readonly character_id: string;
    readonly state_version: number;
    readonly active_config_version: string;
  };
  readonly opportunity: {
    readonly current_opportunities: number;
    readonly opportunity_cap: number;
    readonly recovery_anchor_at: string;
    readonly next_recovery_at: string | null;
    readonly recovery_interval_seconds: number;
    readonly is_capped: boolean;
  };
  readonly teaching_grant: {
    readonly source_tutorial_id: string;
    readonly claimed_at: string | null;
    readonly available: boolean;
    readonly applied_quantity: number;
  };
  readonly calculation_as_of: string;
  readonly config_version: string;
};

type DungeonRunResponse = DungeonOpportunityResponse & {
  readonly run: {
    readonly run_id: string;
    readonly dungeon_id: string;
    readonly status: string;
    readonly current_node_id: string;
    readonly phase: string;
    readonly outcome: string;
    readonly revision: number;
    readonly initial_route_id: string;
    readonly loadout_preset_id: string | null;
    readonly strategy_preset_id: string | null;
    readonly opportunity_cost: number;
    readonly config_version: string;
    readonly created_at: string;
    readonly choice_deadline_at: string;
    readonly selected_choice_id: string | null;
    readonly selected_route_id: string | null;
    readonly selected_route_risk: string | null;
    readonly selected_at: string | null;
    readonly combat_resolved_at: string | null;
    readonly finalized_at: string | null;
    readonly run_state: DungeonRulesRunState;
  };
};

type DungeonRunCreateRequest = {
  readonly dungeonId: string;
  readonly loadoutPresetId: string;
  readonly strategyPresetId: string;
  readonly initialRouteId: string;
  readonly expectedStateVersion: bigint;
  readonly configVersion: string;
};

type DungeonPreviewRequest = {
  readonly characterId: string;
  readonly loadoutPresetId: string;
  readonly strategyPresetId: string;
  readonly initialRouteId: string;
};

type DungeonChoiceRequest = {
  readonly choiceId: string;
  readonly expectedRunVersion: bigint;
};

type DungeonFinalizeResponse = DungeonRunResponse;

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

function conflict(details: Record<string, unknown>): ConflictException {
  return new ConflictException({
    code: 'STATE_VERSION_CONFLICT',
    message_key: 'error.state_version_conflict',
    details,
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

function parseCreateRequest(body: unknown): DungeonRunCreateRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  return {
    dungeonId: requiredString(body, 'dungeon_id'),
    loadoutPresetId: requiredString(body, 'loadout_preset_id'),
    strategyPresetId: requiredString(body, 'strategy_preset_id'),
    initialRouteId: requiredString(body, 'initial_route_id'),
    expectedStateVersion: parseNonNegativeInteger(body['expected_state_version'], 'expected_state_version'),
    configVersion: requiredString(body, 'config_version'),
  };
}

function parsePreviewRequest(body: unknown): DungeonPreviewRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  return {
    characterId: requiredString(body, 'character_id'),
    loadoutPresetId: requiredString(body, 'loadout_preset_id'),
    strategyPresetId: requiredString(body, 'strategy_preset_id'),
    initialRouteId: requiredString(body, 'initial_route_id'),
  };
}

function parseChoiceRequest(body: unknown): DungeonChoiceRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  return {
    choiceId: requiredString(body, 'choice_id'),
    expectedRunVersion: parseNonNegativeInteger(body['expected_run_version'], 'expected_run_version'),
  };
}

function parseOptionalJson(value: JsonValue | null | undefined): JsonValue | null {
  return value ?? null;
}

function toOpportunityResponse(
  character: CharacterRow,
  snapshot: {
    readonly opportunityCount: number;
    readonly opportunityCap: number;
    readonly recoveryAnchorAt: Date;
    readonly nextRecoveryAt: Date | null;
    readonly recoveryIntervalSeconds: number;
    readonly isCapped: boolean;
    readonly calculationAsOf: Date;
    readonly teachingGrantTutorialId: string | null;
    readonly teachingGrantClaimedAt: Date | null;
  },
  appliedQuantity: number,
): DungeonOpportunityResponse {
  return {
    character: {
      character_id: character.characterId,
      state_version: stateVersionAsNumber(character.stateVersion),
      active_config_version: character.activeConfigVersion,
    },
    opportunity: {
      current_opportunities: snapshot.opportunityCount,
      opportunity_cap: snapshot.opportunityCap,
      recovery_anchor_at: snapshot.recoveryAnchorAt.toISOString(),
      next_recovery_at: snapshot.nextRecoveryAt === null ? null : snapshot.nextRecoveryAt.toISOString(),
      recovery_interval_seconds: snapshot.recoveryIntervalSeconds,
      is_capped: snapshot.isCapped,
    },
    teaching_grant: {
      source_tutorial_id: snapshot.teachingGrantTutorialId ?? 'TUT-007',
      claimed_at: snapshot.teachingGrantClaimedAt === null ? null : snapshot.teachingGrantClaimedAt.toISOString(),
      available: snapshot.teachingGrantClaimedAt === null,
      applied_quantity: appliedQuantity,
    },
    calculation_as_of: snapshot.calculationAsOf.toISOString(),
    config_version: character.activeConfigVersion,
  };
}

function toRunResponse(
  character: CharacterRow,
  snapshot: {
    readonly opportunityCount: number;
    readonly opportunityCap: number;
    readonly recoveryAnchorAt: Date;
    readonly nextRecoveryAt: Date | null;
    readonly recoveryIntervalSeconds: number;
    readonly isCapped: boolean;
    readonly calculationAsOf: Date;
    readonly teachingGrantTutorialId: string | null;
    readonly teachingGrantClaimedAt: Date | null;
  },
  run: DungeonRunRecord,
): DungeonRunResponse {
  return {
    ...toOpportunityResponse(character, snapshot, 0),
    run: {
      run_id: run.runId,
      dungeon_id: run.dungeonId,
      status: run.status,
      current_node_id: run.currentNodeId,
      phase: run.phase,
      outcome: run.outcome,
      revision: Number(run.revision),
      initial_route_id: run.initialRouteId,
      loadout_preset_id: run.loadoutPresetId,
      strategy_preset_id: run.strategyPresetId,
      opportunity_cost: run.opportunityCost,
      config_version: run.configVersion,
      created_at: run.createdAt.toISOString(),
      choice_deadline_at: run.choiceDeadlineAt.toISOString(),
      selected_choice_id: run.selectedChoiceId,
      selected_route_id: run.selectedRouteId,
      selected_route_risk: run.selectedRouteRisk,
      selected_at: run.selectedAt === null ? null : run.selectedAt.toISOString(),
      combat_resolved_at: run.combatResolvedAt === null ? null : run.combatResolvedAt.toISOString(),
      finalized_at: run.finalizedAt === null ? null : run.finalizedAt.toISOString(),
      run_state: restoreDungeonRunState(run.runState as DungeonRulesRunState),
    },
  };
}

function monsterToCombatant(monster: MonsterConfig): CombatantInput {
  return {
    side: 'ENEMY',
    style: 'MELEE',
    staminaLevel: monster.combat.hp,
    intelligenceLevel: '4',
    attackLevel: monster.combat.attack,
    defenseLevel: monster.combat.defense,
    meleeLevel: monster.combat.attack,
    rangedLevel: '0',
    magicLevel: '0',
    equipmentHp: monster.combat.spirit_stone,
    baseAttackIntervalSeconds: monster.combat.attack_interval_seconds,
    accuracyBonus: '0',
    damageBonus: '0',
    evasionBonus: '0',
    attackSpeedBonus: '0',
    critRateBonus: '0',
    critDamageBonus: '0.5',
    penetration: '0',
  };
}

function toRuntimeDungeonConfig(
  configRegistry: ConfigRegistry,
  dungeon: ConfigDungeonConfig,
): DungeonRulesConfig {
  const uniqueLootTables = new Map<string, LootTableConfig>();
  uniqueLootTables.set(dungeon.reward_table_id, configRegistry.getLootTable(dungeon.reward_table_id));
  uniqueLootTables.set(dungeon.failure_reward_table_id, configRegistry.getLootTable(dungeon.failure_reward_table_id));
  for (const choice of dungeon.choices) {
    uniqueLootTables.set(choice.success_reward_table_id, configRegistry.getLootTable(choice.success_reward_table_id));
    uniqueLootTables.set(choice.failure_reward_table_id, configRegistry.getLootTable(choice.failure_reward_table_id));
  }

  return {
    id: dungeon.id,
    realmRequired: dungeon.realm_required,
    opportunityCost: dungeon.opportunity_cost,
    entryItems: dungeon.entry_items.map((entry) => ({
      itemId: entry.item_id,
      quantity: entry.quantity,
    })),
    choiceTimeoutSeconds: dungeon.choice_timeout_seconds,
    defaultSafeChoiceId: dungeon.default_safe_choice_id,
    prepareNodeId: dungeon.prepare_node_id,
    entryNodeId: dungeon.entry_node_id,
    choiceNodeId: dungeon.choice_node_id,
    battleNodeId: dungeon.battle_node_id,
    rewardNodeId: dungeon.reward_node_id,
    nodes: dungeon.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      nextNodeId: node.next_node_ids[0] ?? null,
    })),
    choices: dungeon.choices.map((choice) => ({
      id: choice.id,
      routeId: choice.route_id,
      risk: choice.risk,
      labelKey: choice.label_key,
      battleEnemy: monsterToCombatant(configRegistry.getMonster(choice.monster_id)),
      successRewardTableId: choice.success_reward_table_id,
      failureRewardTableId: choice.failure_reward_table_id,
      ...(choice.max_events === undefined ? {} : { maxEvents: choice.max_events }),
      ...(choice.max_rounds === undefined ? {} : { maxRounds: choice.max_rounds }),
    })),
    rewardTables: [...uniqueLootTables.values()].map((table) => ({
      id: table.id,
      cultivationXp: table.cultivation_xp,
      entries: table.entries.map((entry) => ({
        itemId: entry.item_id,
        minQuantity: entry.min_qty,
        ...(entry.max_qty === undefined ? {} : { maxQuantity: entry.max_qty }),
        probability: entry.probability,
        rolls: entry.rolls,
      })),
    })),
    failureRewardTableId: dungeon.failure_reward_table_id,
    successModel: {
      baseSuccessRate: dungeon.base_success_model.base_success_rate,
      recommendedPower: dungeon.base_success_model.recommended_power,
      powerElasticity: dungeon.base_success_model.power_elasticity,
      minSuccessRate: dungeon.base_success_model.min_success_rate,
      maxSuccessRate: dungeon.base_success_model.max_success_rate,
    },
    scope: dungeon.scope,
  };
}

@Injectable()
export class DungeonService {
  public constructor(
    @Inject(dungeonRepositoryToken) private readonly dungeonRepository: DungeonRepository,
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(databasePoolToken) private readonly pool: DatabasePool,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
  ) {}

  public async getOpportunities(
    request: FastifyRequest,
    characterId: string,
  ): Promise<DungeonOpportunityResponse> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const [character, opportunity] = await Promise.all([
      this.loadCharacter(characterId, accountId),
      this.dungeonRepository.getOpportunitySnapshot(characterId, new Date()),
    ]);
    if (character === null || opportunity === null) {
      throw notFound();
    }
    return toOpportunityResponse(character, opportunity, 0);
  }

  public async claimTeachingGrant(
    request: FastifyRequest,
    characterId: string,
  ): Promise<DungeonOpportunityResponse> {
    const accountId = await this.authService.requireWriteAccess(request);
    await this.authService.assertCharacterOwnership(request, characterId);
    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'DUNGEON_TEACHING_GRANT',
      request: { source_tutorial_id: 'TUT-007' },
      execute: async ({ client }) => {
        const character = await this.loadCharacterOnTransaction(client, characterId, accountId);
        if (character === null) {
          throw notFound();
        }
        const mutation = await this.dungeonRepository.grantTeachingOpportunityOnTransaction(client, {
          characterId,
          sourceTutorialId: 'TUT-007',
          reasonCode: 'DUNGEON_TEACHING_GRANT',
          referenceType: 'TUTORIAL',
          referenceId: 'TUT-007',
          configVersion: this.configRegistry.manifest.config_version,
          now: new Date(),
        });
        const nextStateVersion = mutation.wasAlreadyClaimed === true
          ? character.stateVersion
          : await this.bumpStateVersion(client, characterId, character.stateVersion);
        return {
          statusCode: 200,
          response: toOpportunityResponse(
            { ...character, stateVersion: nextStateVersion },
            mutation.state,
            mutation.appliedQuantity,
          ),
        };
      },
    });
    return result.response;
  }

  public async previewDungeon(
    request: FastifyRequest,
    dungeonId: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const parsed = parsePreviewRequest(body);
    const accountId = await this.authService.requireCurrentAccountId(request);
    const [character, context] = await Promise.all([
      this.loadCharacter(parsed.characterId, accountId),
      this.buildDungeonPreviewContext(parsed.characterId, accountId, parsed.loadoutPresetId, parsed.strategyPresetId),
    ]);
    if (character === null || context === null) {
      throw notFound();
    }
    const dungeon = this.configRegistry.getDungeon(dungeonId);
    const preview = resolveDungeonPreview({
      dungeon: toRuntimeDungeonConfig(this.configRegistry, dungeon),
      configVersion: this.configRegistry.manifest.config_version,
      formulaVersion: this.configRegistry.manifest.formula_version,
      playerPower: context.playerPower,
    });
    return {
      character: {
        character_id: character.characterId,
        state_version: stateVersionAsNumber(character.stateVersion),
        active_config_version: character.activeConfigVersion,
      },
      dungeon: {
        dungeon_id: preview.dungeonId,
        recommended_power: preview.recommendedPower,
        base_success_rate: preview.baseSuccessRate,
        estimated_success_rate: preview.estimatedSuccessRate,
        choice_timeout_seconds: preview.choiceTimeoutSeconds,
        opportunity_cost: preview.opportunityCost,
        entry_items: preview.entryItems,
        choices: preview.choices,
        core_rewards: preview.coreRewards,
      },
      config_version: preview.configVersion,
      calculation_as_of: new Date().toISOString(),
    };
  }

  public async enterDungeonRun(
    request: FastifyRequest,
    characterId: string,
    body: unknown,
  ): Promise<DungeonRunResponse> {
    const parsed = parseCreateRequest(body);
    if (parsed.configVersion !== this.configRegistry.manifest.config_version) {
      throw badRequest('config_version_MISMATCH');
    }
    const accountId = await this.authService.requireWriteAccess(request);
    await this.authService.assertCharacterOwnership(request, characterId);
    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'DUNGEON_ENTER',
      request: body,
      execute: async ({ client }) => {
        const character = await this.loadCharacterOnTransaction(client, characterId, accountId);
        if (character === null) {
          throw notFound();
        }
        const activeRun = await this.dungeonRepository.getActiveDungeonRun(characterId, parsed.dungeonId);
        if (activeRun !== null) {
          const projectedRun = this.projectDungeonRunForRead(activeRun, new Date());
          return {
            statusCode: 200,
            response: toRunResponse(
              character,
              await this.dungeonRepository.getOpportunitySnapshot(characterId, new Date()) ?? {
                characterId,
                opportunityCount: 0,
                opportunityCap: 6,
                recoveryAnchorAt: new Date(),
                nextRecoveryAt: null,
                teachingGrantTutorialId: null,
                teachingGrantClaimedAt: null,
                availableOpportunities: 0,
                isCapped: false,
                recoveryIntervalSeconds: 43_200,
                calculationAsOf: new Date(),
              },
              projectedRun,
            ),
          };
        }
        if (character.stateVersion !== parsed.expectedStateVersion.toString()) {
          throw conflict({
            expected: stateVersionAsNumber(parsed.expectedStateVersion.toString()),
            actual: stateVersionAsNumber(character.stateVersion),
          });
        }
        const runId = randomUUID();
        let opportunity: DungeonOpportunityMutationResult;
        try {
          opportunity = await this.dungeonRepository.consumeOpportunityOnTransaction(client, {
            characterId,
            reasonCode: 'DUNGEON_ENTER',
            referenceType: 'DUNGEON_RUN',
            referenceId: runId,
            configVersion: this.configRegistry.manifest.config_version,
            now: new Date(),
            quantity: 1,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'INSUFFICIENT_OPPORTUNITY') {
            throw unprocessable('INSUFFICIENT_OPPORTUNITY', {});
          }
          throw error;
        }
        const context = await this.buildDungeonEntryContext(client, characterId, accountId, parsed.loadoutPresetId, parsed.strategyPresetId);
        if (context === null) {
          throw notFound();
        }
        const dungeon = this.configRegistry.getDungeon(parsed.dungeonId);
        const runtimeDungeon = toRuntimeDungeonConfig(this.configRegistry, dungeon);
        const preview = resolveDungeonPreview({
          dungeon: runtimeDungeon,
          configVersion: this.configRegistry.manifest.config_version,
          formulaVersion: this.configRegistry.manifest.formula_version,
          playerPower: context.playerPower,
        });
        const startedAt = new Date();
        const runState = resolveDungeonEntry({
          runId,
          characterId,
          dungeon: runtimeDungeon,
          configVersion: this.configRegistry.manifest.config_version,
          formulaVersion: this.configRegistry.manifest.formula_version,
          seedHex: randomUUID().replace(/-/g, ''),
          startedAtUs: `${BigInt(startedAt.getTime()) * 1000n}`,
          loadoutSnapshot: context.loadoutSnapshot,
          buffSnapshot: context.buffSnapshot,
          strategySnapshot: context.strategySnapshot,
          playerCombatSnapshot: context.playerCombatSnapshot,
          preview,
        });
        const run = await this.dungeonRepository.createDungeonRunOnTransaction(client, {
          runId,
          characterId,
          dungeonId: parsed.dungeonId,
          status: runState.phase,
          currentNodeId: runState.currentNodeId,
          phase: runState.phase,
          outcome: runState.outcome,
          revision: `${runState.revision}`,
          initialRouteId: parsed.initialRouteId,
          loadoutPresetId: parsed.loadoutPresetId === undefined ? null : parsed.loadoutPresetId,
          strategyPresetId: parsed.strategyPresetId === undefined ? null : parsed.strategyPresetId,
          opportunityCost: runtimeDungeon.opportunityCost,
          stateVersion: character.stateVersion,
          configVersion: this.configRegistry.manifest.config_version,
          choiceDeadlineAt: new Date(Number(runState.choiceDeadlineAtUs) / 1000),
          selectedChoiceId: runState.selectedChoiceId,
          selectedRouteId: runState.selectedRouteId,
          selectedRouteRisk: runState.selectedRouteRisk,
          selectedAt: runState.selectedAtUs === null ? null : new Date(Number(runState.selectedAtUs) / 1000),
          combatResolvedAt: runState.combatResolvedAtUs === null ? null : new Date(Number(runState.combatResolvedAtUs) / 1000),
          finalizedAt: runState.finalizedAtUs === null ? null : new Date(Number(runState.finalizedAtUs) / 1000),
          runState,
          rewardIntent: parseOptionalJson(runState.rewardCandidate),
          resultSnapshot: parseOptionalJson(runState.finalization),
        });
        const nextStateVersion = await this.bumpStateVersion(client, characterId, character.stateVersion);
        return {
          statusCode: 201,
          response: toRunResponse(
            { ...character, stateVersion: nextStateVersion },
            opportunity.state,
            run,
          ),
        };
      },
    });
    return result.response;
  }

  public async getDungeonRun(
    request: FastifyRequest,
    characterId: string,
    runId: string,
  ): Promise<DungeonRunResponse> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const [character, opportunity, run] = await Promise.all([
      this.loadCharacter(characterId, accountId),
      this.dungeonRepository.getOpportunitySnapshot(characterId, new Date()),
      this.dungeonRepository.getDungeonRun(characterId, runId),
    ]);
    if (character === null || opportunity === null || run === null) {
      throw notFound();
    }
    return toRunResponse(character, opportunity, this.projectDungeonRunForRead(run, new Date()));
  }

  public async getDungeonRunById(
    request: FastifyRequest,
    runId: string,
  ): Promise<DungeonRunResponse> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const run = await this.dungeonRepository.getDungeonRunById(runId);
    if (run === null) {
      throw notFound();
    }
    const [character, opportunity] = await Promise.all([
      this.loadCharacter(run.characterId, accountId),
      this.dungeonRepository.getOpportunitySnapshot(run.characterId, new Date()),
    ]);
    if (character === null || opportunity === null) {
      throw notFound();
    }
    return toRunResponse(character, opportunity, this.projectDungeonRunForRead(run, new Date()));
  }

  public async chooseDungeonRun(
    request: FastifyRequest,
    runId: string,
    body: unknown,
  ): Promise<DungeonRunResponse> {
    const parsed = parseChoiceRequest(body);
    const accountId = await this.authService.requireWriteAccess(request);
    const run = await this.dungeonRepository.getDungeonRunById(runId);
    if (run === null) {
      throw notFound();
    }
    const characterId = run.characterId;
    await this.authService.assertCharacterOwnership(request, characterId);
    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'DUNGEON_CHOICE',
      request: body,
      execute: async ({ client }) => {
        const character = await this.loadCharacterOnTransaction(client, characterId, accountId);
        if (character === null) {
          throw notFound();
        }
        const opportunity = await this.dungeonRepository.getOpportunitySnapshot(characterId, new Date());
        if (opportunity === null) {
          throw notFound();
        }
        const now = new Date();
        const projectedRun = this.projectDungeonRunForRead(run, now);
        let runState = restoreDungeonRunState(projectedRun.runState as DungeonRulesRunState);
        if (projectedRun.selectedChoiceId === null && projectedRun.choiceDeadlineAt.getTime() <= now.getTime()) {
          const timedOutState = this.projectTimedOutDungeonRun(runState, now);
          runState = timedOutState;
        }
        if (projectedRun.phase === 'FINALIZED') {
          return {
            statusCode: 200,
            response: toRunResponse(character, opportunity, projectedRun),
          };
        }
        if (projectedRun.selectedChoiceId !== null) {
          if (projectedRun.selectedChoiceId !== parsed.choiceId) {
            throw conflict({
              expected: Number(parsed.expectedRunVersion),
              actual: Number(projectedRun.revision),
            });
          }
          return {
            statusCode: 200,
            response: toRunResponse(character, opportunity, projectedRun),
          };
        }
        if (parsed.expectedRunVersion.toString() !== projectedRun.revision) {
          throw conflict({
            expected: Number(parsed.expectedRunVersion),
            actual: Number(projectedRun.revision),
          });
        }
        const chosenAtUs = `${BigInt(Date.now()) * 1000n}`;
        if (runState.selectedChoiceId === null) {
          runState = restoreDungeonRunState(resolveDungeonChoice({
            run: runState,
            choiceId: parsed.choiceId,
            expectedRunVersion: Number(parsed.expectedRunVersion),
            chosenAtUs,
          }));
        }
        const updated = await this.dungeonRepository.updateDungeonRunOnTransaction(client, {
          runId,
          characterId,
          currentNodeId: runState.currentNodeId,
          phase: runState.phase,
          outcome: runState.outcome,
          revision: `${runState.revision}`,
          stateVersion: character.stateVersion,
          choiceDeadlineAt: new Date(Number(runState.choiceDeadlineAtUs) / 1000),
          selectedChoiceId: runState.selectedChoiceId,
          selectedRouteId: runState.selectedRouteId,
          selectedRouteRisk: runState.selectedRouteRisk,
          selectedAt: runState.selectedAtUs === null ? null : new Date(Number(runState.selectedAtUs) / 1000),
          combatResolvedAt: runState.combatResolvedAtUs === null ? null : new Date(Number(runState.combatResolvedAtUs) / 1000),
          finalizedAt: runState.finalizedAtUs === null ? null : new Date(Number(runState.finalizedAtUs) / 1000),
          runState,
          rewardIntent: parseOptionalJson(runState.rewardCandidate),
          resultSnapshot: parseOptionalJson(runState.finalization),
        });
        const nextStateVersion = await this.bumpStateVersion(client, characterId, character.stateVersion);
        return {
          statusCode: 200,
          response: toRunResponse({ ...character, stateVersion: nextStateVersion }, opportunity, updated),
        };
      },
    });
    return result.response;
  }

  public async finalizeDungeonRun(
    request: FastifyRequest,
    runId: string,
  ): Promise<DungeonFinalizeResponse> {
    const accountId = await this.authService.requireWriteAccess(request);
    const run = await this.dungeonRepository.getDungeonRunById(runId);
    if (run === null) {
      throw notFound();
    }
    const characterId = run.characterId;
    await this.authService.assertCharacterOwnership(request, characterId);
    const result = await this.settlementService.executeSettledWrite(request, characterId, {
      operationType: 'DUNGEON_FINALIZE',
      request: { run_id: runId },
      execute: async ({ client }) => {
        const character = await this.loadCharacterOnTransaction(client, characterId, accountId);
        if (character === null) {
          throw notFound();
        }
        const opportunity = await this.dungeonRepository.getOpportunitySnapshot(characterId, new Date());
        if (opportunity === null) {
          throw notFound();
        }
        const now = new Date();
        const projectedRun = this.projectDungeonRunForRead(run, now);
        let runState = restoreDungeonRunState(projectedRun.runState as DungeonRulesRunState);
        if (projectedRun.phase === 'FINALIZED') {
          return { statusCode: 200, response: toRunResponse(character, opportunity, projectedRun) };
        }
        if (projectedRun.phase === 'ENTERED' && projectedRun.selectedChoiceId === null && projectedRun.choiceDeadlineAt.getTime() <= now.getTime()) {
          runState = this.projectTimedOutDungeonRun(runState, now);
        }
        if (runState.phase !== 'REWARD_CANDIDATE' || runState.rewardCandidate === null) {
          throw unprocessable('DUNGEON_RUN_NOT_READY', {});
        }
        const finalizedAt = new Date();
        const finalized = restoreDungeonRunState(resolveDungeonFinalize({
          run: runState,
          finalizedAtUs: `${BigInt(finalizedAt.getTime()) * 1000n}`,
        }));
        const finalizationTransactionId = await this.createDungeonFinalizeTransaction(client, characterId, runId);
        const grant = await this.applyDungeonReward(client, characterId, finalized, finalizationTransactionId);
        const updated = await this.dungeonRepository.updateDungeonRunOnTransaction(client, {
          runId,
          characterId,
          currentNodeId: finalized.currentNodeId,
          phase: finalized.phase,
          outcome: finalized.outcome,
          revision: `${finalized.revision}`,
          stateVersion: character.stateVersion,
          choiceDeadlineAt: new Date(Number(finalized.choiceDeadlineAtUs) / 1000),
          selectedChoiceId: finalized.selectedChoiceId,
          selectedRouteId: finalized.selectedRouteId,
          selectedRouteRisk: finalized.selectedRouteRisk,
          selectedAt: finalized.selectedAtUs === null ? null : new Date(Number(finalized.selectedAtUs) / 1000),
          combatResolvedAt: finalized.combatResolvedAtUs === null ? null : new Date(Number(finalized.combatResolvedAtUs) / 1000),
          finalizedAt: finalized.finalizedAtUs === null ? null : new Date(Number(finalized.finalizedAtUs) / 1000),
          runState: finalized,
          rewardIntent: parseOptionalJson(finalized.rewardCandidate),
          resultSnapshot: parseOptionalJson(finalized.finalization),
        });
        await client.query(
          `INSERT INTO outbox_events (
             event_type, aggregate_type, aggregate_id, transaction_id, payload, available_at
           ) VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)`,
          [
            'dungeon.run.finalized',
            'DUNGEON_RUN',
            runId,
            finalizationTransactionId,
            JSON.stringify({
              character_id: characterId,
              run_id: runId,
              dungeon_id: updated.dungeonId,
              outcome: updated.outcome,
              reward: grant.reward,
            }),
          ],
        );
        const nextStateVersion = await this.bumpStateVersion(client, characterId, character.stateVersion);
        return {
          statusCode: 200,
          response: toRunResponse({ ...character, stateVersion: nextStateVersion }, opportunity, updated),
        };
      },
    });
    return result.response;
  }

  private async buildDungeonPreviewContext(
    characterId: string,
    accountId: string,
    loadoutPresetId: string,
    strategyPresetId: string,
  ): Promise<{
    readonly playerPower: string;
    readonly loadoutSnapshot: JsonValue;
    readonly buffSnapshot: JsonValue;
    readonly strategySnapshot: JsonValue;
    readonly playerCombatSnapshot: CombatantInput;
  } | null> {
    const character = await this.loadCharacter(characterId, accountId);
    if (character === null) {
      return null;
    }
    return this.buildDungeonCombatContext({
      client: this.pool,
      characterId,
      accountId,
      loadoutPresetId,
      strategyPresetId,
    });
  }

  private async buildDungeonEntryContext(
    client: Pick<PoolClient, 'query'>,
    characterId: string,
    accountId: string,
    loadoutPresetId: string,
    strategyPresetId: string,
  ): Promise<{
    readonly playerPower: string;
    readonly loadoutSnapshot: JsonValue;
    readonly buffSnapshot: JsonValue;
    readonly strategySnapshot: JsonValue;
    readonly playerCombatSnapshot: CombatantInput;
  } | null> {
    return this.buildDungeonCombatContext({
      client,
      characterId,
      accountId,
      loadoutPresetId,
      strategyPresetId,
    });
  }

  private async buildDungeonCombatContext(input: {
    readonly client: Pick<PoolClient, 'query'>;
    readonly characterId: string;
    readonly accountId: string;
    readonly loadoutPresetId: string;
    readonly strategyPresetId: string;
  }): Promise<{
    readonly playerPower: string;
    readonly loadoutSnapshot: JsonValue;
    readonly buffSnapshot: JsonValue;
    readonly strategySnapshot: JsonValue;
    readonly playerCombatSnapshot: CombatantInput;
  } | null> {
    const [progression, loadout, buffs] = await Promise.all([
      this.loadCharacterProgression(input.client, input.characterId, input.accountId),
      this.loadLoadoutPreset(input.client, input.characterId, input.accountId, input.loadoutPresetId),
      this.loadActiveBuffSnapshot(input.client, input.characterId),
    ]);
    if (progression === null || loadout === null) {
      return null;
    }

    const weapon = loadout.weaponItemId === null ? null : this.configRegistry.getEquipment(loadout.weaponItemId);
    const armor = loadout.armorItemId === null ? null : this.configRegistry.getEquipment(loadout.armorItemId);
    const accessory = loadout.accessoryItemId === null ? null : this.configRegistry.getEquipment(loadout.accessoryItemId);

    const totalAttack = (weapon?.attack ?? 0) + (armor?.attack ?? 0) + (accessory?.attack ?? 0);
    const totalDefense = (weapon?.defense ?? 0) + (armor?.defense ?? 0) + (accessory?.defense ?? 0);
    const totalHp = (weapon?.hp ?? 0) + (armor?.hp ?? 0) + (accessory?.hp ?? 0);
    const totalSpeed = (weapon?.speed ?? 0) + (armor?.speed ?? 0) + (accessory?.speed ?? 0);
    const realmStage = this.configRegistry.getRealm(progression.realmStageId);
    const stageBonus = realmStage.stage_order + 1;
    const baseAttackInterval = Math.max(1, 2 - totalSpeed / 100);

    const playerCombatSnapshot: CombatantInput = {
      side: 'PLAYER',
      style: 'MELEE',
      staminaLevel: String(12 + stageBonus + Math.floor(totalHp / 20)),
      intelligenceLevel: String(6 + Math.floor(stageBonus / 2)),
      attackLevel: String(12 + totalAttack),
      defenseLevel: String(12 + totalDefense),
      meleeLevel: String(14 + totalAttack),
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: String(totalHp + stageBonus * 10),
      baseAttackIntervalSeconds: baseAttackInterval.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''),
      accuracyBonus: '0.10',
      damageBonus: '0.10',
      evasionBonus: '0.05',
      attackSpeedBonus: totalSpeed > 0 ? '0.05' : '0',
      critRateBonus: '0.05',
      critDamageBonus: '0.50',
      penetration: '0',
    };

    const playerPower = totalAttack + totalDefense + totalHp / 10 + totalSpeed;
    return {
      playerPower: String(Math.max(1, Math.round(playerPower))),
      loadoutSnapshot: {
        loadout_preset_id: loadout.presetId,
        weapon_instance_id: loadout.weaponItemId,
        armor_instance_id: loadout.armorItemId,
        accessory_instance_id: loadout.accessoryItemId,
        strategy_id: loadout.strategyId,
      },
      buffSnapshot: {
        active_buffs: buffs.map((buff) => ({
          buff_instance_id: buff.id,
          buff_config_id: buff.buffConfigId,
          stack_group: buff.stackGroup,
          expires_at: buff.expiresAt.toISOString(),
        })),
      },
      strategySnapshot: {
        strategy_id: loadout.strategyId,
        requested_strategy_id: input.strategyPresetId,
      },
      playerCombatSnapshot,
    };
  }

  private projectTimedOutDungeonRun(run: DungeonRulesRunState, now: Date): DungeonRulesRunState {
    if (run.selectedChoiceId !== null || run.phase !== 'ENTERED') {
      return run;
    }
    if (BigInt(now.getTime()) * 1000n < BigInt(run.choiceDeadlineAtUs)) {
      return run;
    }
    return restoreDungeonRunState(resolveDungeonChoiceTimeout({
      run,
      chosenAtUs: `${BigInt(now.getTime()) * 1000n}`,
    }));
  }

  private projectDungeonRunForRead(run: DungeonRunRecord, now: Date): DungeonRunRecord {
    const original = restoreDungeonRunState(run.runState as DungeonRulesRunState);
    const state = this.projectTimedOutDungeonRun(original, now);
    if (
      state.phase === original.phase
      && state.selectedChoiceId === original.selectedChoiceId
      && state.revision === original.revision
    ) {
      return run;
    }
    return {
      ...run,
      currentNodeId: state.currentNodeId,
      phase: state.phase,
      outcome: state.outcome,
      revision: `${state.revision}`,
      choiceDeadlineAt: new Date(Number(state.choiceDeadlineAtUs) / 1000),
      selectedChoiceId: state.selectedChoiceId,
      selectedRouteId: state.selectedRouteId,
      selectedRouteRisk: state.selectedRouteRisk,
      selectedAt: state.selectedAtUs === null ? null : new Date(Number(state.selectedAtUs) / 1000),
      combatResolvedAt: state.combatResolvedAtUs === null ? null : new Date(Number(state.combatResolvedAtUs) / 1000),
      finalizedAt: state.finalizedAtUs === null ? null : new Date(Number(state.finalizedAtUs) / 1000),
      runState: state,
      rewardIntent: parseOptionalJson(state.rewardCandidate),
      resultSnapshot: parseOptionalJson(state.finalization),
    };
  }

  private async createDungeonFinalizeTransaction(
    client: PoolClient,
    characterId: string,
    runId: string,
  ): Promise<string> {
    const result = await client.query<{ readonly id: string }>(
      `INSERT INTO asset_transactions (
         character_id, operation_type, reason_code, reference_type, reference_id, config_version
       )
       VALUES ($1, 'DUNGEON_FINALIZE', 'DUNGEON_FINALIZE', 'DUNGEON_RUN', $2, $3)
       RETURNING id`,
      [characterId, runId, this.configRegistry.manifest.config_version],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('DUNGEON_FINALIZE_TRANSACTION_NOT_CREATED');
    }
    return row.id;
  }

  private async applyDungeonReward(
    client: PoolClient,
    characterId: string,
    run: DungeonRulesRunState,
    transactionId: string,
  ): Promise<{
    readonly reward: DungeonRulesRunState['rewardCandidate'];
  }> {
    if (run.rewardCandidate === null) {
      return { reward: null };
    }
    for (const intent of run.rewardCandidate.items) {
      const item = this.configRegistry.getItem(intent.assetId);
      const quantity = BigInt(intent.quantity);
      if (quantity <= 0n) {
        continue;
      }
      for (let index = 0n; index < quantity; index += 1n) {
        await this.assetRepository.addOnTransaction(client, {
          characterId,
          reasonCode: 'DUNGEON_FINALIZE',
          referenceType: 'DUNGEON_RUN',
          referenceId: run.runId,
          configVersion: this.configRegistry.manifest.config_version,
          assetType: 'ITEM',
          assetId: intent.assetId,
          quantity: '1',
        });
        if (item.category === 'EQUIPMENT') {
          await client.query(
            `INSERT INTO equipment_instances (
               character_id, item_id, temper_level, bound, created_transaction_id, created_config_version
             )
             VALUES ($1, $2, 0, FALSE, $3, $4)`,
            [characterId, intent.assetId, transactionId, this.configRegistry.manifest.config_version],
          );
        }
      }
    }
    return { reward: run.rewardCandidate };
  }

  private async loadCharacterProgression(
    client: Pick<PoolClient, 'query'>,
    characterId: string,
    accountId: string,
  ): Promise<{ readonly realmStageId: string } | null> {
    const result = await client.query<{ readonly realm_stage_id: string }>(
      `SELECT cp.realm_stage_id
         FROM characters c
         INNER JOIN character_progression cp ON cp.character_id = c.id
        WHERE c.id = $1 AND c.account_id = $2`,
      [characterId, accountId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return { realmStageId: row.realm_stage_id };
  }

  private async loadLoadoutPreset(
    client: Pick<PoolClient, 'query'>,
    characterId: string,
    accountId: string,
    presetId: string,
  ): Promise<{
    readonly presetId: string;
    readonly weaponItemId: string | null;
    readonly armorItemId: string | null;
    readonly accessoryItemId: string | null;
    readonly strategyId: string;
    readonly version: string;
    readonly active: boolean;
  } | null> {
    const result = await client.query<{
      readonly id: string;
      readonly weapon_item_id: string | null;
      readonly armor_item_id: string | null;
      readonly accessory_item_id: string | null;
      readonly strategy_id: string;
      readonly version: string;
      readonly active: boolean;
    }>(
      `SELECT p.id,
              w.item_id AS weapon_item_id,
              a.item_id AS armor_item_id,
              x.item_id AS accessory_item_id,
              p.strategy_id, p.version::text AS version,
              COALESCE(c.active_loadout_preset_id = p.id, FALSE) AS active
         FROM loadout_presets p
         INNER JOIN characters c ON c.id = p.character_id
         LEFT JOIN equipment_instances w ON w.id = p.weapon_instance_id
         LEFT JOIN equipment_instances a ON a.id = p.armor_instance_id
         LEFT JOIN equipment_instances x ON x.id = p.accessory_instance_id
        WHERE p.id = $1
          AND p.character_id = $2
          AND c.account_id = $3`,
      [presetId, characterId, accountId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      presetId: row.id,
      weaponItemId: row.weapon_item_id,
      armorItemId: row.armor_item_id,
      accessoryItemId: row.accessory_item_id,
      strategyId: row.strategy_id,
      version: row.version,
      active: row.active,
    };
  }

  private async loadActiveBuffSnapshot(
    client: Pick<PoolClient, 'query'>,
    characterId: string,
  ): Promise<readonly {
    readonly id: string;
    readonly buffConfigId: string;
    readonly stackGroup: string;
    readonly expiresAt: Date;
  }[]> {
    const result = await client.query<{
      readonly id: string;
      readonly buff_config_id: string;
      readonly stack_group: string;
      readonly expires_at: Date;
    }>(
      `SELECT id, buff_config_id, stack_group, expires_at
         FROM buff_instances
        WHERE character_id = $1
          AND expires_at > CURRENT_TIMESTAMP
        ORDER BY slot_index ASC, expires_at ASC, id ASC`,
      [characterId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      buffConfigId: row.buff_config_id,
      stackGroup: row.stack_group,
      expiresAt: row.expires_at,
    }));
  }

  private async loadCharacter(characterId: string, accountId: string): Promise<CharacterRow | null> {
    const result = await this.pool.query<{ readonly state_version: string; readonly active_config_version: string }>(
      `SELECT state_version::text AS state_version, active_config_version
         FROM characters
        WHERE id = $1 AND account_id = $2`,
      [characterId, accountId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      characterId,
      stateVersion: row.state_version,
      activeConfigVersion: row.active_config_version,
    };
  }

  private async loadCharacterOnTransaction(
    client: PoolClient,
    characterId: string,
    accountId: string,
  ): Promise<CharacterRow | null> {
    const result = await client.query<{ readonly state_version: string; readonly active_config_version: string }>(
      `SELECT state_version::text AS state_version, active_config_version
         FROM characters
        WHERE id = $1 AND account_id = $2
        FOR UPDATE`,
      [characterId, accountId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      characterId,
      stateVersion: row.state_version,
      activeConfigVersion: row.active_config_version,
    };
  }

  private async bumpStateVersion(client: PoolClient, characterId: string, stateVersion: string): Promise<string> {
    const result = await client.query<{ readonly state_version: string }>(
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
      const current = await client.query<{ readonly state_version: string }>(
        'SELECT state_version::text AS state_version FROM characters WHERE id = $1',
        [characterId],
      );
      const actual = current.rows[0]?.state_version ?? stateVersion;
      throw conflict({
        expected: stateVersionAsNumber(stateVersion),
        actual: stateVersionAsNumber(actual),
      });
    }
    return row.state_version;
  }
}
