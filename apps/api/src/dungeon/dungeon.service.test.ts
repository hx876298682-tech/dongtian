import type { FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetRepository,
  DatabasePool,
  DungeonOpportunitySnapshot,
  DungeonRepository,
  DungeonRunCreateInput,
  DungeonRunRecord,
  DungeonRunUpdateInput,
  JsonValue,
  PoolClient,
} from '@dongtian/database';
import type { CombatantInput } from '@dongtian/game-rules';

import type { AuthService } from '../auth/auth.service.js';
import type { SettlementService } from '../settlement/settlement.service.js';
import { applyWeaponMasteryAttack, DungeonService } from './dungeon.service.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('weapon mastery combat bonus', () => {
  const swordMastery = { tags: ['weapon_mastery', 'sword'], level: 3, attackBonusPerLevel: '0.02' };

  it('applies a matching sword mastery multiplier to weapon attack', () => {
    expect(applyWeaponMasteryAttack(12, ['equipment', 'weapon', 'sword'], [swordMastery])).toBeCloseTo(12.72);
  });

  it('keeps zero-level and nonmatching weapon attacks unchanged', () => {
    expect(applyWeaponMasteryAttack(12, ['equipment', 'weapon', 'sword'], [{ ...swordMastery, level: 0 }])).toBe(12);
    expect(applyWeaponMasteryAttack(12, ['equipment', 'weapon', 'blade'], [swordMastery])).toBe(12);
  });
});

function makeSnapshot(state: {
  readonly count: number;
  readonly cap: number;
  readonly nextRecoveryAt: Date | null;
  readonly claimedAt: Date | null;
  readonly tutorialId: string | null;
}): DungeonOpportunitySnapshot {
  return {
    characterId: 'character-1',
    opportunityCount: state.count,
    opportunityCap: state.cap,
    recoveryAnchorAt: new Date('2026-08-16T00:00:00.000Z'),
    nextRecoveryAt: state.nextRecoveryAt,
    teachingGrantTutorialId: state.tutorialId,
    teachingGrantClaimedAt: state.claimedAt,
    availableOpportunities: state.count,
    isCapped: state.count >= state.cap,
    recoveryIntervalSeconds: 43_200,
    calculationAsOf: new Date('2026-08-16T00:00:00.000Z'),
  };
}

function makeService(accountId = 'account-1') {
  const character = {
    accountId,
    stateVersion: '3',
    activeConfigVersion: '2026.08.16.1',
    activeLoadoutPresetId: 'preset-starter',
  };
  const opportunityState = {
    count: 1,
    cap: 6,
    nextRecoveryAt: new Date('2026-08-16T12:00:00.000Z') as Date | null,
    claimedAt: null as Date | null,
    tutorialId: null as string | null,
  };
  const runs: Record<string, {
    readonly runId: string;
    readonly characterId: string;
    readonly dungeonId: string;
    readonly status: string;
    readonly currentNodeId: string;
    readonly phase: string;
    readonly outcome: string;
    readonly revision: string;
    readonly initialRouteId: string;
    readonly loadoutPresetId: string | null;
    readonly strategyPresetId: string | null;
    readonly opportunityCost: number;
    readonly stateVersion: string;
    readonly configVersion: string;
    readonly choiceDeadlineAt: Date;
    readonly selectedChoiceId: string | null;
    readonly selectedRouteId: string | null;
    readonly selectedRouteRisk: string | null;
    readonly selectedAt: Date | null;
    readonly combatResolvedAt: Date | null;
    readonly finalizedAt: Date | null;
    readonly runState: JsonValue;
    readonly rewardIntent: JsonValue | null;
    readonly resultSnapshot: JsonValue | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }> = {};
  function makeRunRecord(input: {
    readonly runId?: string;
    readonly characterId: string;
    readonly dungeonId: string;
    readonly status: string;
    readonly currentNodeId: string;
    readonly phase: string;
    readonly outcome: string;
    readonly revision: string;
    readonly initialRouteId: string;
    readonly loadoutPresetId: string | null;
    readonly strategyPresetId: string | null;
    readonly opportunityCost: number;
    readonly stateVersion: string;
    readonly configVersion: string;
    readonly choiceDeadlineAt: Date;
    readonly selectedChoiceId: string | null;
    readonly selectedRouteId: string | null;
    readonly selectedRouteRisk: string | null;
    readonly selectedAt: Date | null;
    readonly combatResolvedAt: Date | null;
    readonly finalizedAt: Date | null;
    readonly runState: JsonValue;
    readonly rewardIntent: JsonValue | null;
    readonly resultSnapshot: JsonValue | null;
  }): DungeonRunRecord {
    return {
      runId: input.runId ?? 'run-1',
      characterId: input.characterId,
      dungeonId: input.dungeonId,
      status: input.status,
      currentNodeId: input.currentNodeId,
      phase: input.phase,
      outcome: input.outcome,
      revision: input.revision,
      initialRouteId: input.initialRouteId,
      loadoutPresetId: input.loadoutPresetId,
      strategyPresetId: input.strategyPresetId,
      opportunityCost: input.opportunityCost,
      stateVersion: input.stateVersion,
      configVersion: input.configVersion,
      choiceDeadlineAt: input.choiceDeadlineAt,
      selectedChoiceId: input.selectedChoiceId,
      selectedRouteId: input.selectedRouteId,
      selectedRouteRisk: input.selectedRouteRisk,
      selectedAt: input.selectedAt,
      combatResolvedAt: input.combatResolvedAt,
      finalizedAt: input.finalizedAt,
      runState: input.runState,
      rewardIntent: input.rewardIntent,
      resultSnapshot: input.resultSnapshot,
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
    };
  }

  const queries: string[] = [];
  const client = {
    async query<T extends Record<string, unknown>>(sql: string, args?: readonly unknown[]): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      if (sql.includes('FROM characters') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            state_version: character.stateVersion,
            active_config_version: character.activeConfigVersion,
            active_loadout_preset_id: character.activeLoadoutPresetId,
          } as unknown as T],
        };
      }
      if (sql.includes('FROM characters')) {
        const rows = accountId === 'account-1'
          ? ([{
              state_version: character.stateVersion,
              active_config_version: character.activeConfigVersion,
              active_loadout_preset_id: character.activeLoadoutPresetId,
            } as unknown as T])
          : ([] as T[]);
        return {
          rows,
        };
      }
      if (sql.includes('UPDATE characters')) {
        if (String(args?.[1]) !== character.stateVersion) {
          return { rows: [] as T[] };
        }
        character.stateVersion = String(Number(character.stateVersion) + 1);
        return { rows: [{ state_version: character.stateVersion } as unknown as T] };
      }
      if (sql.includes('INSERT INTO asset_transactions')) {
        return { rows: [{ id: 'asset-txn-1' } as unknown as T] };
      }
      if (sql.includes('INSERT INTO equipment_instances')) {
        return { rows: [{ id: 'equipment-1' } as unknown as T] };
      }
      return { rows: [] as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient;

  const pool = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<{ readonly rows: T[] }> {
      if (sql.includes('FROM characters')) {
        return accountId === 'account-1'
          ? {
              rows: [{
                state_version: character.stateVersion,
                active_config_version: character.activeConfigVersion,
                active_loadout_preset_id: character.activeLoadoutPresetId,
              } as unknown as T],
            }
          : { rows: [] as T[] };
      }
      if (sql.includes('FROM dungeon_runs')) {
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
  } as unknown as DatabasePool;

  const dungeonRepository = {
    async getOpportunitySnapshot() {
      return makeSnapshot({
        count: opportunityState.count,
        cap: opportunityState.cap,
        nextRecoveryAt: opportunityState.nextRecoveryAt,
        claimedAt: opportunityState.claimedAt,
        tutorialId: opportunityState.tutorialId,
      });
    },
    async settleOpportunityStateOnTransaction() {
      return {
        state: {
          characterId: 'character-1',
          opportunityCount: opportunityState.count,
          opportunityCap: opportunityState.cap,
          recoveryAnchorAt: new Date('2026-08-16T00:00:00.000Z'),
          nextRecoveryAt: opportunityState.nextRecoveryAt,
          teachingGrantTutorialId: opportunityState.tutorialId,
          teachingGrantClaimedAt: opportunityState.claimedAt,
        },
        recovered: 0,
        snapshot: makeSnapshot({
          count: opportunityState.count,
          cap: opportunityState.cap,
          nextRecoveryAt: opportunityState.nextRecoveryAt,
          claimedAt: opportunityState.claimedAt,
          tutorialId: opportunityState.tutorialId,
        }),
      };
    },
    async grantTeachingOpportunityOnTransaction(_client: PoolClient, input: { readonly now: Date; readonly sourceTutorialId: string }) {
      if (opportunityState.claimedAt !== null) {
        return {
          state: makeSnapshot({
            count: opportunityState.count,
            cap: opportunityState.cap,
            nextRecoveryAt: opportunityState.nextRecoveryAt,
            claimedAt: opportunityState.claimedAt,
            tutorialId: opportunityState.tutorialId,
          }),
          ledgerEntryId: 'ledger-claimed',
          appliedQuantity: 0,
          wasAlreadyClaimed: true,
        };
      }
      opportunityState.count = Math.min(opportunityState.cap, opportunityState.count + 1);
      opportunityState.claimedAt = input.now;
      opportunityState.tutorialId = input.sourceTutorialId;
      if (opportunityState.count >= opportunityState.cap) {
        opportunityState.nextRecoveryAt = null;
      }
      return {
        state: makeSnapshot({
          count: opportunityState.count,
          cap: opportunityState.cap,
          nextRecoveryAt: opportunityState.nextRecoveryAt,
          claimedAt: opportunityState.claimedAt,
          tutorialId: opportunityState.tutorialId,
        }),
        ledgerEntryId: 'ledger-grant',
        appliedQuantity: 1,
        wasAlreadyClaimed: false,
      };
    },
    async consumeOpportunityOnTransaction(_client: PoolClient, input: { readonly now: Date }) {
      if (opportunityState.count < 1) {
        throw new Error('INSUFFICIENT_OPPORTUNITY');
      }
      opportunityState.count -= 1;
      if (opportunityState.count < opportunityState.cap && opportunityState.nextRecoveryAt === null) {
        opportunityState.nextRecoveryAt = new Date(input.now.getTime() + 43_200_000);
      }
      return {
        state: makeSnapshot({
          count: opportunityState.count,
          cap: opportunityState.cap,
          nextRecoveryAt: opportunityState.nextRecoveryAt,
          claimedAt: opportunityState.claimedAt,
          tutorialId: opportunityState.tutorialId,
        }),
        ledgerEntryId: 'ledger-consume',
        appliedQuantity: 1,
      };
    },
    async createDungeonRunOnTransaction(_client: PoolClient, input: DungeonRunCreateInput) {
      const run = makeRunRecord({
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        characterId: input.characterId,
        dungeonId: input.dungeonId,
        status: input.status,
        currentNodeId: input.currentNodeId,
        phase: input.phase,
        outcome: input.outcome,
        revision: input.revision,
        initialRouteId: input.initialRouteId,
        loadoutPresetId: input.loadoutPresetId,
        strategyPresetId: input.strategyPresetId,
        opportunityCost: input.opportunityCost,
        stateVersion: input.stateVersion,
        configVersion: input.configVersion,
        choiceDeadlineAt: input.choiceDeadlineAt,
        selectedChoiceId: input.selectedChoiceId,
        selectedRouteId: input.selectedRouteId,
        selectedRouteRisk: input.selectedRouteRisk,
        selectedAt: input.selectedAt,
        combatResolvedAt: input.combatResolvedAt,
        finalizedAt: input.finalizedAt,
        runState: input.runState,
        rewardIntent: input.rewardIntent,
        resultSnapshot: input.resultSnapshot,
      });
      runs[run.runId] = run;
      return run;
    },
    async getDungeonRun(_characterId: string, runId: string) {
      return runs[runId] ?? null;
    },
    async updateDungeonRunOnTransaction(_client: PoolClient, input: DungeonRunUpdateInput) {
      const current = runs[input.runId];
      if (!current) {
        throw new Error('not found');
      }
      const next = makeRunRecord({
        runId: current.runId,
        characterId: current.characterId,
        dungeonId: current.dungeonId,
        status: input.phase,
        currentNodeId: input.currentNodeId,
        phase: input.phase,
        outcome: input.outcome,
        revision: input.revision,
        initialRouteId: current.initialRouteId,
        loadoutPresetId: current.loadoutPresetId,
        strategyPresetId: current.strategyPresetId,
        opportunityCost: current.opportunityCost,
        stateVersion: input.stateVersion,
        configVersion: current.configVersion,
        choiceDeadlineAt: input.choiceDeadlineAt,
        selectedChoiceId: input.selectedChoiceId,
        selectedRouteId: input.selectedRouteId,
        selectedRouteRisk: input.selectedRouteRisk,
        selectedAt: input.selectedAt,
        combatResolvedAt: input.combatResolvedAt,
        finalizedAt: input.finalizedAt,
        runState: input.runState,
        rewardIntent: input.rewardIntent,
        resultSnapshot: input.resultSnapshot,
      });
      runs[input.runId] = next;
      return next;
    },
    async getDungeonRunById(runId: string) {
      return runs[runId] ?? null;
    },
    async getActiveDungeonRun(_characterId: string, dungeonId: string) {
      return Object.values(runs).find((run) => run.dungeonId === dungeonId && run.phase !== 'FINALIZED') ?? null;
    },
  } as unknown as DungeonRepository;

  const assetRepository = {
    async addOnTransaction() {
      return {
        transactionId: 'asset-txn-1',
        ledgerEntryId: 'asset-ledger-1',
        assetType: 'ITEM',
        assetId: 'item.t2.lingsui',
        quantity: '1',
        reservedQuantity: '0',
        availableQuantity: '1',
      };
    },
  } as unknown as AssetRepository;

  const settlementService = {
    async executeSettledWrite<T>(_request: FastifyRequest, _characterId: string, input: {
      readonly operationType: string;
      readonly request: unknown;
      readonly execute: (context: {
        readonly client: PoolClient;
        readonly settlement: { readonly settlement_id: string; readonly effective_until: string };
        readonly settlementState: { readonly continuationRequired: boolean };
        readonly requestHash: string;
      }) => Promise<{
        readonly statusCode: number;
        readonly response: T;
      }>;
    }) {
      return input.execute({
        client,
        settlement: { settlement_id: 'settlement-1', effective_until: '2026-08-16T00:00:01.000Z' },
        settlementState: { continuationRequired: false },
        requestHash: 'hash',
      });
    },
  } as unknown as SettlementService;

  const authService = {
    async requireCurrentAccountId() {
      return accountId;
    },
    async requireWriteAccess() {
      return accountId;
    },
    async assertCharacterOwnership() {
      return undefined;
    },
  } as unknown as AuthService;

  const configRegistry = {
    manifest: { config_version: '2026.08.16.1', formula_version: 1 },
    getDungeon(dungeonId: string) {
      return {
        id: dungeonId,
        realm_required: 'realm.qi.early',
        opportunity_cost: 1,
        entry_items: [],
        recommended_power: '80',
        base_success_model: {
          base_success_rate: '0.9',
          recommended_power: '80',
          power_elasticity: '0.5',
          min_success_rate: '0.2',
          max_success_rate: '0.95',
        },
        choice_timeout_seconds: 60,
        default_safe_choice_id: 'choice.safe',
        prepare_node_id: 'node.prepare',
        entry_node_id: 'node.entry',
        choice_node_id: 'node.choice',
        battle_node_id: 'node.battle',
        reward_node_id: 'node.reward',
        nodes: [
          { id: 'node.prepare', type: 'PREPARE', monster_ids: [], choice_ids: [], next_node_ids: ['node.entry'], auto_resolve_policy: 'NONE' },
          { id: 'node.entry', type: 'ENTRY', monster_ids: [], choice_ids: [], next_node_ids: ['node.choice'], auto_resolve_policy: 'NONE' },
          { id: 'node.choice', type: 'CHOICE', monster_ids: [], choice_ids: ['choice.safe'], next_node_ids: ['node.battle'], auto_resolve_policy: 'TIMEOUT_SAFE_ROUTE' },
          { id: 'node.battle', type: 'BATTLE', monster_ids: ['monster.qingshe'], choice_ids: [], next_node_ids: ['node.reward'], auto_resolve_policy: 'NONE' },
          { id: 'node.reward', type: 'REWARD', monster_ids: [], choice_ids: [], next_node_ids: [], auto_resolve_policy: 'NONE' },
        ],
        choices: [
          {
            id: 'choice.safe',
            route_id: 'route.safe',
            risk: 'SAFE',
            label_key: 'dungeon.route.safe',
            monster_id: 'monster.qingshe',
            success_reward_table_id: 'loot.success',
            failure_reward_table_id: 'loot.failure',
            max_events: 64,
            max_rounds: 32,
          },
        ],
        reward_table_id: 'loot.success',
        failure_reward_table_id: 'loot.failure',
        scope: 'MVP',
      };
    },
    getMonster() {
      return {
        id: 'monster.qingshe',
        combat: {
          hp: '180',
          attack: '18',
          defense: '8',
          attack_interval_seconds: '2.4',
          skill_script_id: 'monster_script.qingshe.basic',
          recommended_power: '60',
          base_battle_duration_us: '48000000',
          spirit_stone: '18',
          loot_table_id: 'loot.monster',
        },
      };
    },
    getLootTable(tableId: string) {
      if (tableId === 'loot.failure') {
        return {
          id: tableId,
          cultivation_xp: '0',
          entries: [],
        };
      }
      return {
        id: tableId,
        cultivation_xp: '250',
        entries: [
          {
            item_id: 'item.t2.lingsui',
            min_qty: '1',
            max_qty: '1',
            probability: '1',
            rolls: 1,
          },
        ],
      };
    },
    getItem(itemId: string) {
      return {
        id: itemId,
        category: 'MATERIAL',
      };
    },
  } as unknown as ConfigRegistry;

  const service = new DungeonService(
    dungeonRepository,
    settlementService,
    authService,
    pool,
    assetRepository,
    configRegistry,
  );

  const minimalCombatContext = {
    playerPower: '100',
    loadoutSnapshot: {},
    buffSnapshot: {},
    strategySnapshot: {},
    playerCombatSnapshot: {
      side: 'PLAYER',
      style: 'MELEE',
      staminaLevel: '20',
      intelligenceLevel: '10',
      attackLevel: '20',
      defenseLevel: '15',
      meleeLevel: '20',
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: '200',
      baseAttackIntervalSeconds: '1',
      accuracyBonus: '0',
      damageBonus: '0',
      evasionBonus: '0',
      attackSpeedBonus: '0',
      critRateBonus: '0',
      critDamageBonus: '0',
      penetration: '0',
    } satisfies CombatantInput,
  };

  (service as unknown as {
    buildDungeonPreviewContext: () => Promise<typeof minimalCombatContext>;
    buildDungeonEntryContext: () => Promise<typeof minimalCombatContext>;
  }).buildDungeonPreviewContext = async () => minimalCombatContext;
  (service as unknown as {
    buildDungeonPreviewContext: () => Promise<typeof minimalCombatContext>;
    buildDungeonEntryContext: () => Promise<typeof minimalCombatContext>;
  }).buildDungeonEntryContext = async () => minimalCombatContext;

  return { service, opportunityState, character, client, runs };
}

describe('dungeon service', () => {
  it('returns the authoritative opportunity snapshot for the current character', async () => {
    const { service } = makeService();

    await expect(service.getOpportunities({} as FastifyRequest, 'character-1')).resolves.toMatchObject({
      character: {
        character_id: 'character-1',
        state_version: 3,
        active_config_version: '2026.08.16.1',
        active_loadout_preset_id: 'preset-starter',
      },
      opportunity: {
        current_opportunities: 1,
        opportunity_cap: 6,
        is_capped: false,
      },
      teaching_grant: {
        source_tutorial_id: 'TUT-007',
        available: true,
        applied_quantity: 0,
      },
      config_version: '2026.08.16.1',
    });
  });

  it('claims the teaching grant once and keeps the state version stable on repeat calls', async () => {
    const { service } = makeService();

    const first = await service.claimTeachingGrant({} as FastifyRequest, 'character-1');
    const second = await service.claimTeachingGrant({} as FastifyRequest, 'character-1');

    expect(first).toMatchObject({
      character: { state_version: 4 },
      opportunity: { current_opportunities: 2, is_capped: false },
      teaching_grant: { available: false, applied_quantity: 1, claimed_at: '2026-08-16T00:00:00.000Z' },
    });
    expect(second).toMatchObject({
      character: { state_version: 4 },
      opportunity: { current_opportunities: 2 },
      teaching_grant: { available: false, applied_quantity: 0 },
    });
  });

  it('enters a dungeon run, consumes one opportunity, and bumps the state version', async () => {
    const { service } = makeService();

    const result = await service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });

    expect(result).toMatchObject({
      character: { state_version: 4 },
      opportunity: { current_opportunities: 0, is_capped: false },
      run: {
        dungeon_id: 'dungeon.t1.entry',
        status: 'ENTERED',
        current_node_id: 'node.choice',
        initial_route_id: 'route.entry',
        loadout_preset_id: 'loadout-1',
        strategy_preset_id: 'strategy.safe',
        opportunity_cost: 1,
        config_version: '2026.08.16.1',
      },
    });
  });

  it('returns the active run unchanged on duplicate entry requests', async () => {
    const { service, opportunityState } = makeService();

    const first = await service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });
    const second = await service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });

    expect(first.run.run_id).toBe(second.run.run_id);
    expect(second.character.state_version).toBe(4);
    expect(opportunityState.count).toBe(0);
  });

  it('projects a timed-out run to the safe route on read', async () => {
    const { service } = makeService();

    const entered = await service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });
    vi.setSystemTime(new Date('2026-08-16T00:01:01.000Z'));

    const projected = await service.getDungeonRunById({} as FastifyRequest, entered.run.run_id);

    expect(projected.run.selected_choice_id).toBe('choice.safe');
    expect(projected.run.phase).toBe('REWARD_CANDIDATE');
  });

  it('treats duplicate choice requests as idempotent', async () => {
    const { service } = makeService();

    const entered = await service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });
    const firstChoice = await service.chooseDungeonRun({} as FastifyRequest, entered.run.run_id, {
      choice_id: 'choice.safe',
      expected_run_version: entered.run.revision,
    });
    const secondChoice = await service.chooseDungeonRun({} as FastifyRequest, entered.run.run_id, {
      choice_id: 'choice.safe',
      expected_run_version: entered.run.revision,
    });

    expect(firstChoice.run.revision).toBe(secondChoice.run.revision);
    expect(secondChoice.run.selected_choice_id).toBe('choice.safe');
  });

  it('treats finalize as idempotent', async () => {
    const { service } = makeService();

    const entered = await service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });
    await service.chooseDungeonRun({} as FastifyRequest, entered.run.run_id, {
      choice_id: 'choice.safe',
      expected_run_version: entered.run.revision,
    });
    const firstFinalize = await service.finalizeDungeonRun({} as FastifyRequest, entered.run.run_id);
    const secondFinalize = await service.finalizeDungeonRun({} as FastifyRequest, entered.run.run_id);

    expect(firstFinalize.run.finalized_at).not.toBeNull();
    expect(secondFinalize.run.finalized_at).toBe(firstFinalize.run.finalized_at);
    expect(secondFinalize.character.state_version).toBe(firstFinalize.character.state_version);
  });

  it('returns the existing active run for stale duplicate create requests', async () => {
    const { service } = makeService();

    const first = await service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });

    const second = await service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    });

    expect(second.run.run_id).toBe(first.run.run_id);
    expect(second.character.state_version).toBe(first.character.state_version);
  });

  it('rejects entry when no opportunity remains', async () => {
    const { service, opportunityState } = makeService();
    opportunityState.count = 0;

    await expect(service.enterDungeonRun({} as FastifyRequest, 'character-1', {
      dungeon_id: 'dungeon.t1.entry',
      loadout_preset_id: 'loadout-1',
      strategy_preset_id: 'strategy.safe',
      initial_route_id: 'route.entry',
      expected_state_version: 3,
      config_version: '2026.08.16.1',
    })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_OPPORTUNITY',
      }),
    });
  });

  it('blocks access when the character does not belong to the current account', async () => {
    const { service } = makeService('account-2');

    await expect(service.getOpportunities({} as FastifyRequest, 'character-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'RESOURCE_NOT_FOUND',
      }),
    });
  });
});
