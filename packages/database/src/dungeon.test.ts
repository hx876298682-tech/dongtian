import type { PoolClient, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './index.js';
import { createDungeonRepository } from './dungeon.js';

type MutableDungeonState = {
  readonly opportunity: {
    exists: boolean;
    opportunityCount: number;
    opportunityCap: number;
    recoveryAnchorAt: Date;
    nextRecoveryAt: Date | null;
    teachingGrantTutorialId: string | null;
    teachingGrantClaimedAt: Date | null;
  };
  readonly ledgerEntries: Array<{ readonly entry_id: string }>;
  readonly runs: Record<string, {
    readonly id: string;
    readonly character_id: string;
    readonly dungeon_id: string;
    readonly status: string;
    readonly current_node_id: string;
    readonly phase: string;
    readonly outcome: string;
    readonly revision: string;
    readonly initial_route_id: string;
    readonly loadout_preset_id: string | null;
    readonly strategy_preset_id: string | null;
    readonly opportunity_cost: number;
    readonly state_version: string;
    readonly config_version: string;
    readonly choice_deadline_at: Date;
    readonly selected_choice_id: string | null;
    readonly selected_route_id: string | null;
    readonly selected_route_risk: string | null;
    readonly selected_at: Date | null;
    readonly combat_resolved_at: Date | null;
    readonly finalized_at: Date | null;
    readonly run_state: Record<string, unknown>;
    readonly reward_intent: Record<string, unknown> | null;
    readonly result_snapshot: Record<string, unknown> | null;
    readonly created_at: Date;
    readonly updated_at: Date;
  }>;
};

function makeState(): MutableDungeonState {
  return {
    opportunity: {
      exists: false,
      opportunityCount: 0,
      opportunityCap: 6,
      recoveryAnchorAt: new Date('2026-08-16T00:00:00.000Z'),
      nextRecoveryAt: new Date('2026-08-16T12:00:00.000Z'),
      teachingGrantTutorialId: null,
      teachingGrantClaimedAt: null,
    },
    ledgerEntries: [],
    runs: {},
  };
}

function makeQueryClient(state: MutableDungeonState, queries: string[]): PoolClient {
  const client = {
    async query<T extends QueryResultRow>(sql: string, args?: readonly unknown[]): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      if (sql.includes('SELECT character_id, opportunity_count')) {
        if (!state.opportunity.exists) {
          return { rows: [] as T[] };
        }
        return {
          rows: [{
            character_id: 'character-1',
            opportunity_count: state.opportunity.opportunityCount,
            opportunity_cap: state.opportunity.opportunityCap,
            recovery_anchor_at: state.opportunity.recoveryAnchorAt,
            next_recovery_at: state.opportunity.nextRecoveryAt,
            teaching_grant_tutorial_id: state.opportunity.teachingGrantTutorialId,
            teaching_grant_claimed_at: state.opportunity.teachingGrantClaimedAt,
          } as unknown as T],
        };
      }
      if (sql.includes('INSERT INTO dungeon_opportunity_states')) {
        if (!state.opportunity.exists) {
          state.opportunity.exists = true;
          state.opportunity.opportunityCount = 0;
          state.opportunity.opportunityCap = Number(args?.[1] ?? 6);
          state.opportunity.recoveryAnchorAt = args?.[2] instanceof Date ? args[2] : new Date(String(args?.[2]));
          state.opportunity.nextRecoveryAt = args?.[3] instanceof Date ? args[3] : new Date(String(args?.[3]));
          state.opportunity.teachingGrantTutorialId = null;
          state.opportunity.teachingGrantClaimedAt = null;
        }
        return { rows: [] as T[] };
      }
      if (sql.includes('UPDATE dungeon_opportunity_states')) {
        state.opportunity.opportunityCount = Number(args?.[1] ?? state.opportunity.opportunityCount);
        state.opportunity.recoveryAnchorAt = args?.[2] instanceof Date ? args[2] : new Date(String(args?.[2]));
        state.opportunity.nextRecoveryAt = args?.[3] instanceof Date ? args[3] : args?.[3] === null ? null : new Date(String(args?.[3]));
        state.opportunity.teachingGrantTutorialId = args?.[4] === null ? null : String(args?.[4]);
        state.opportunity.teachingGrantClaimedAt = args?.[5] === null ? null : args?.[5] instanceof Date ? args[5] : new Date(String(args?.[5]));
        return { rows: [] as T[] };
      }
      if (sql.includes('INSERT INTO dungeon_opportunity_ledger')) {
        const entry = { entry_id: `ledger-${state.ledgerEntries.length + 1}` };
        state.ledgerEntries.push(entry);
        return { rows: [entry as unknown as T] };
      }
      if (sql.includes('INSERT INTO dungeon_runs')) {
        const run = {
          id: String(args?.[0] ?? 'run-1'),
          character_id: String(args?.[1]),
          dungeon_id: String(args?.[2]),
          status: String(args?.[3]),
          current_node_id: String(args?.[4]),
          phase: String(args?.[5]),
          outcome: String(args?.[6]),
          revision: String(args?.[7]),
          initial_route_id: String(args?.[8]),
          loadout_preset_id: args?.[9] === null ? null : String(args?.[9]),
          strategy_preset_id: args?.[10] === null ? null : String(args?.[10]),
          opportunity_cost: Number(args?.[11]),
          state_version: String(args?.[12]),
          config_version: String(args?.[13]),
          choice_deadline_at: args?.[14] instanceof Date ? args[14] : new Date(String(args?.[14])),
          selected_choice_id: args?.[15] === null ? null : String(args?.[15]),
          selected_route_id: args?.[16] === null ? null : String(args?.[16]),
          selected_route_risk: args?.[17] === null ? null : String(args?.[17]),
          selected_at: args?.[18] === null ? null : args?.[18] instanceof Date ? args[18] : new Date(String(args?.[18])),
          combat_resolved_at: args?.[19] === null ? null : args?.[19] instanceof Date ? args[19] : new Date(String(args?.[19])),
          finalized_at: args?.[20] === null ? null : args?.[20] instanceof Date ? args[20] : new Date(String(args?.[20])),
          run_state: JSON.parse(String(args?.[21] ?? '{}')),
          reward_intent: args?.[22] === null ? null : JSON.parse(String(args?.[22])),
          result_snapshot: args?.[23] === null ? null : JSON.parse(String(args?.[23])),
          created_at: new Date('2026-08-16T00:00:00.000Z'),
          updated_at: new Date('2026-08-16T00:00:00.000Z'),
        };
        state.runs[run.id] = run;
        return { rows: [{ ...run } as unknown as T] };
      }
      if (sql.includes('FROM dungeon_runs')) {
        const runId = sql.includes('WHERE character_id = $1 AND id = $2')
          ? String(args?.[1])
          : String(args?.[0]);
        const run = state.runs[runId];
        return run ? { rows: [{ ...run } as unknown as T] } : { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient;
  return client;
}

function makePool(state: MutableDungeonState, queries: string[]): DatabasePool {
  const client = makeQueryClient(state, queries);
  return {
    async query<T extends QueryResultRow>(sql: string, args?: readonly unknown[]): Promise<{ readonly rows: T[] }> {
      return args === undefined ? client.query<T>(sql) : client.query<T>(sql, args as unknown as unknown[]);
    },
  } as unknown as DatabasePool;
}

describe('dungeon repository', () => {
  it('projects the default 0 of 6 state with a 12 hour recovery timer', async () => {
    const state = makeState();
    const queries: string[] = [];
    const repository = createDungeonRepository(makePool(state, queries));

    await expect(repository.getOpportunitySnapshot('character-1', new Date('2026-08-16T00:00:00.000Z'))).resolves.toMatchObject({
      characterId: 'character-1',
      opportunityCount: 0,
      opportunityCap: 6,
      availableOpportunities: 0,
      isCapped: false,
      nextRecoveryAt: new Date('2026-08-16T12:00:00.000Z'),
    });
    expect(queries).toHaveLength(1);
  });

  it('reconstructs recovery across the 72 hour boundary and stops at the cap', async () => {
    const state = makeState();
    state.opportunity.exists = true;
    state.opportunity.opportunityCount = 4;
    state.opportunity.opportunityCap = 6;
    state.opportunity.recoveryAnchorAt = new Date('2026-08-13T00:00:00.000Z');
    state.opportunity.nextRecoveryAt = new Date('2026-08-13T12:00:00.000Z');
    const repository = createDungeonRepository(makePool(state, []));

    await expect(repository.getOpportunitySnapshot('character-1', new Date('2026-08-16T00:00:00.000Z'))).resolves.toMatchObject({
      opportunityCount: 6,
      availableOpportunities: 6,
      isCapped: true,
      nextRecoveryAt: null,
    });
  });

  it('rejects consuming an opportunity when the authoritative balance is zero', async () => {
    const state = makeState();
    state.opportunity.exists = true;
    state.opportunity.opportunityCount = 0;
    const queries: string[] = [];
    const repository = createDungeonRepository(makePool(state, queries));
    const client = makeQueryClient(state, queries);

    await expect(repository.consumeOpportunityOnTransaction(client, {
      characterId: 'character-1',
      reasonCode: 'DUNGEON_ENTER',
      referenceType: 'DUNGEON_RUN',
      referenceId: 'run-1',
      configVersion: '2026.08.16.1',
      now: new Date('2026-08-16T00:00:00.000Z'),
    })).rejects.toThrow('INSUFFICIENT_OPPORTUNITY');
    expect(queries.some((query) => query.includes('UPDATE dungeon_opportunity_states'))).toBe(false);
  });

  it('applies the teaching grant once and returns a no-op on repeat claims', async () => {
    const state = makeState();
    state.opportunity.exists = true;
    state.opportunity.opportunityCount = 5;
    const queries: string[] = [];
    const repository = createDungeonRepository(makePool(state, queries));
    const client = makeQueryClient(state, queries);

    const first = await repository.grantTeachingOpportunityOnTransaction(client, {
      characterId: 'character-1',
      sourceTutorialId: 'TUT-007',
      reasonCode: 'DUNGEON_TEACHING_GRANT',
      referenceType: 'TUTORIAL',
      referenceId: 'TUT-007',
      configVersion: '2026.08.16.1',
      now: new Date('2026-08-16T00:00:00.000Z'),
    });

    const second = await repository.grantTeachingOpportunityOnTransaction(client, {
      characterId: 'character-1',
      sourceTutorialId: 'TUT-007',
      reasonCode: 'DUNGEON_TEACHING_GRANT',
      referenceType: 'TUTORIAL',
      referenceId: 'TUT-007',
      configVersion: '2026.08.16.1',
      now: new Date('2026-08-16T00:00:00.000Z'),
    });

    expect(first).toMatchObject({
      appliedQuantity: 1,
      wasAlreadyClaimed: false,
      state: expect.objectContaining({
        opportunityCount: 6,
        isCapped: true,
        teachingGrantTutorialId: 'TUT-007',
      }),
    });
    expect(second).toMatchObject({
      appliedQuantity: 0,
      wasAlreadyClaimed: true,
      state: expect.objectContaining({
        opportunityCount: 6,
        teachingGrantTutorialId: 'TUT-007',
      }),
    });
    expect(state.ledgerEntries).toHaveLength(2);
  });

  it('creates and reloads a dungeon run record within the same repository', async () => {
    const state = makeState();
    const queries: string[] = [];
    const repository = createDungeonRepository(makePool(state, queries));
    const client = makeQueryClient(state, queries);

    const run = await repository.createDungeonRunOnTransaction(client, {
      runId: '00000000-0000-0000-0000-000000000123',
      characterId: 'character-1',
      dungeonId: 'dungeon.t1.entry',
      status: 'ENTERED',
      currentNodeId: 'node.dungeon.entered',
      phase: 'ENTERED',
      outcome: 'PENDING',
      revision: '0',
      initialRouteId: 'route.entry',
      loadoutPresetId: null,
      strategyPresetId: 'strategy.safe',
      opportunityCost: 1,
      stateVersion: '4',
      configVersion: '2026.08.16.1',
      choiceDeadlineAt: new Date('2026-08-16T12:00:00.000Z'),
      selectedChoiceId: null,
      selectedRouteId: null,
      selectedRouteRisk: null,
      selectedAt: null,
      combatResolvedAt: null,
      finalizedAt: null,
      runState: { runId: '00000000-0000-0000-0000-000000000123' },
      rewardIntent: null,
      resultSnapshot: null,
    });

    await expect(repository.getDungeonRun('character-1', run.runId)).resolves.toMatchObject({
      runId: '00000000-0000-0000-0000-000000000123',
      characterId: 'character-1',
      dungeonId: 'dungeon.t1.entry',
      stateVersion: '4',
      opportunityCost: 1,
    });
  });
});
