import type { FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetRepository,
  BreakthroughRepository,
  BreakthroughRunRecord,
  DatabasePool,
  InventorySnapshot,
  PoolClient,
} from '@dongtian/database';
import {
  foundationBreakthroughConfig,
  previewBreakthrough,
  selectBreakthroughRoute,
  startBreakthroughTrial,
} from '@dongtian/game-rules';

import type { AuthService } from '../auth/auth.service.js';
import type { SettlementService } from '../settlement/settlement.service.js';
import { BreakthroughService } from './breakthrough.service.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('1970-01-01T00:16:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const configRegistry = {
  manifest: { config_version: '2026.08.16.1', formula_version: 1 },
} as unknown as Pick<ConfigRegistry, 'manifest'>;

function makePreview(): ReturnType<typeof previewBreakthrough> {
  return previewBreakthrough({
    config: foundationBreakthroughConfig,
    cultivationXp: '24100',
    items: {
      'item.t1.foundation_pill': { total: '1', reserved: '0' },
      'item.t2.lingsui': { total: '3', reserved: '0' },
      'item.t1.meridian_pill': { total: '2', reserved: '0' },
    },
    currencies: {
      'currency.spirit_stone': { total: '2500', reserved: '0' },
    },
    sourceSecondsPerUnitByRouteId: {
      'action.cultivation.qi': '13.333333333333334',
      'recipe.t1.foundation_pill': '4500',
      'route.t1.qingshe_cave.safe_exit': '48',
      'recipe.t1.meridian_pill': '750',
      'route.t1.qingshe_cave.deep_den': '2.5833333333333335',
    },
  });
}

function microsecondsToDate(value: string): Date {
  return new Date(Number(BigInt(value) / 1_000n));
}

function toRunRecord(input: ReturnType<typeof startBreakthroughTrial>['run']): BreakthroughRunRecord {
  return {
    breakthroughRunId: input.breakthroughRunId,
    characterId: input.characterId,
    breakthroughConfigId: input.breakthroughConfigId,
    configVersion: foundationBreakthroughConfig.configVersion,
    formulaVersion: foundationBreakthroughConfig.formulaVersion,
    status: input.status,
    runVersion: String(input.runVersion),
    currentNodeId: input.currentNodeId,
    createdAt: microsecondsToDate(input.createdAtUs),
    trialDeadlineAt: microsecondsToDate(input.trialDeadlineAtUs),
    expiresAt: microsecondsToDate(input.expiresAtUs),
    selectedChoiceId: input.selectedChoiceId,
    selectedRouteId: input.selectedRouteId,
    selectedRouteRisk: input.selectedRouteRisk,
    selectedAt: input.selectedAtUs === null ? null : microsecondsToDate(input.selectedAtUs),
    finalizedAt: input.finalizedAtUs === null ? null : microsecondsToDate(input.finalizedAtUs),
    abandonedAt: input.abandonedAtUs === null ? null : microsecondsToDate(input.abandonedAtUs),
    releasedAt: input.releasedAtUs === null ? null : microsecondsToDate(input.releasedAtUs),
    reservationSnapshot: input.reservationSnapshot,
    previewSnapshot: input.previewSnapshot,
    result: input.result,
    updatedAt: microsecondsToDate(input.createdAtUs),
  };
}

function makeInventory(): InventorySnapshot {
  return {
    items: [
      { assetType: 'ITEM', assetId: 'item.t1.foundation_pill', quantity: '1', reservedQuantity: '0', availableQuantity: '1' },
      { assetType: 'ITEM', assetId: 'item.t2.lingsui', quantity: '3', reservedQuantity: '0', availableQuantity: '3' },
      { assetType: 'ITEM', assetId: 'item.t1.meridian_pill', quantity: '2', reservedQuantity: '0', availableQuantity: '2' },
    ],
    currencies: [
      { assetType: 'CURRENCY', assetId: 'currency.spirit_stone', quantity: '2500', reservedQuantity: '0', availableQuantity: '2500' },
    ],
    equipmentInstances: [],
  };
}

function makeService() {
  const state = {
    stateVersion: '7',
    activeConfigVersion: '2026.08.16.1',
    realmStageId: 'realm.qi.early',
  };
  const queryLog: Array<{ readonly sql: string; readonly params: readonly unknown[] | undefined }> = [];
  const client = {
    async query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ readonly rows: T[] }> {
      queryLog.push({ sql, params });
      if (sql.includes('FROM characters c') && sql.includes('INNER JOIN character_progression')) {
        return {
          rows: [{
            character_id: 'character-1',
            state_version: state.stateVersion,
            active_config_version: state.activeConfigVersion,
            realm_stage_id: state.realmStageId,
            cultivation_xp: '24100',
          } as unknown as T],
        };
      }
      if (sql.includes('FROM characters') && sql.includes('FOR UPDATE')) {
        return { rows: [{ state_version: state.stateVersion } as unknown as T] };
      }
      if (sql.includes('UPDATE characters') && sql.includes('state_version = state_version + 1')) {
        state.stateVersion = String(Number(state.stateVersion) + 1);
        return { rows: [{ state_version: state.stateVersion } as unknown as T] };
      }
      if (sql.includes('UPDATE characters') && sql.includes('realm_stage_id = $2')) {
        state.realmStageId = String(params?.[1] ?? state.realmStageId);
        return { rows: [] as T[] };
      }
      if (sql.includes('UPDATE character_progression')) {
        state.realmStageId = String(params?.[1] ?? state.realmStageId);
        return { rows: [] as T[] };
      }
      if (sql.includes('INSERT INTO outbox_events')) {
        return { rows: [] as T[] };
      }
      if (sql.includes('FROM asset_reservations')) {
        return {
          rows: [
            { id: 'reservation-1' } as unknown as T,
            { id: 'reservation-2' } as unknown as T,
            { id: 'reservation-3' } as unknown as T,
            { id: 'reservation-4' } as unknown as T,
          ],
        };
      }
      return { rows: [] as T[] };
    },
  } as unknown as PoolClient;

  const settlementService = {
    async executeSettledWrite<T>(_request: FastifyRequest, _characterId: string, input: {
      readonly operationType: string;
      readonly request: unknown;
      readonly execute: (context: {
        readonly client: PoolClient;
        readonly settlement: { readonly settlement_id: string };
        readonly settlementState: { readonly continuationRequired: boolean };
        readonly requestHash: string;
      }) => Promise<{ readonly statusCode: number; readonly response: T }>;
    }) {
      return input.execute({
        client,
        settlement: { settlement_id: 'settlement-1' },
        settlementState: { continuationRequired: false },
        requestHash: `${input.operationType}:${JSON.stringify(input.request)}`,
      });
    },
  } as unknown as SettlementService;

  const breakthroughPreview = makePreview();
  const started = startBreakthroughTrial({
    runId: 'run-1',
    characterId: 'character-1',
    startedAtUs: 0n,
    preview: breakthroughPreview,
    config: foundationBreakthroughConfig,
  }).run;
  const chosen = selectBreakthroughRoute({
    run: started,
    choiceId: 'choice.breakthrough.foundation.deep_den',
    chosenAtUs: 60_000_000n,
    expectedRunVersion: 0n,
  }).run;
  const runRecord = toRunRecord(chosen);

  const breakthroughRepository = {
    async getLatestRun() {
      return null;
    },
    async lockActiveRun() {
      return null;
    },
    async getRun(runId: string) {
      return runId === 'run-1' ? runRecord : null;
    },
    async lockRun(_client: PoolClient, runId: string) {
      return runId === 'run-1' ? runRecord : null;
    },
    async createRunOnTransaction() {
      return runRecord;
    },
    async markChoiceOnTransaction() {
      return runRecord;
    },
    async markRecoveredOnTransaction() {
      return runRecord;
    },
    async markAbandonedOnTransaction() {
      return runRecord;
    },
    async markFinalizedOnTransaction(_client: PoolClient, input: { readonly result: unknown }) {
      return { ...runRecord, status: 'COMPLETED', finalizedAt: new Date(), result: input.result } as BreakthroughRunRecord;
    },
    async listRecoverableRuns() {
      return [];
    },
    async runRecoveryBatch() {
      return 0;
    },
  } as unknown as BreakthroughRepository;

  const assetRepository = {
    async getInventory() {
      return makeInventory();
    },
    async getInventoryOnTransaction() {
      return makeInventory();
    },
    async reserveOnTransaction() {
      return { transactionId: 'reserve-tx' };
    },
    async consumeOnTransaction() {
      return { transactionId: 'consume-tx' };
    },
    async releaseOnTransaction() {
      return { transactionId: 'release-tx' };
    },
    async findActiveReservationsByBusiness() {
      return [
        { reservationId: 'reservation-1' },
        { reservationId: 'reservation-2' },
        { reservationId: 'reservation-3' },
        { reservationId: 'reservation-4' },
      ] as never;
    },
    async add() {
      throw new Error('not used');
    },
    async addOnTransaction() {
      throw new Error('not used');
    },
    async deduct() {
      throw new Error('not used');
    },
    async deductOnTransaction() {
      throw new Error('not used');
    },
    async reserve() {
      throw new Error('not used');
    },
    async release() {
      throw new Error('not used');
    },
    async consume() {
      throw new Error('not used');
    },
    async audit() {
      throw new Error('not used');
    },
  } as unknown as AssetRepository;

  const authService = {
    async assertCharacterOwnership() {},
    async requireCurrentAccountId() {
      return 'account-1';
    },
    async requireWriteAccess() {
      return 'account-1';
    },
  } as unknown as AuthService;

  const service = new BreakthroughService(
    authService,
    settlementService,
    assetRepository,
    breakthroughRepository,
    configRegistry as ConfigRegistry,
    { query: client.query.bind(client) } as unknown as DatabasePool,
  );

  return { service, client, queryLog, breakthroughRepository, assetRepository };
}

describe('BreakthroughService', () => {
  it('rejects a stale start request before touching the write path', async () => {
    const { service } = makeService();
    await expect(
      service.startBreakthrough({} as FastifyRequest, 'character-1', {
        expected_state_version: 6,
        config_version: '2026.08.16.1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STATE_VERSION_CONFLICT',
      }),
    });
  });

  it('rejects a mismatched config version on start', async () => {
    const { service } = makeService();
    await expect(
      service.startBreakthrough({} as FastifyRequest, 'character-1', {
        expected_state_version: 7,
        config_version: '2026.08.15.1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: expect.objectContaining({
          reason: 'config_version_MISMATCH',
        }),
      }),
    });
  });

  it('finalizes atomically and persists the foundation unlock bundle', async () => {
    const { service, queryLog } = makeService();
    const response = await service.finalizeBreakthroughRun({} as FastifyRequest, 'run-1', {});

    expect(response.run.result).toMatchObject({
      unlocked_realm_id: 'realm.foundation.early',
      unlock_bundle_id: 'unlock.foundation.early',
      queue_slots: 3,
      medicine_slots: 3,
    });
    expect(response.run.reservation_snapshot[0]).toEqual({
      asset_type: 'ITEM',
      asset_id: 'item.t1.foundation_pill',
      quantity: '1',
    });
    expect(response.run.preview_snapshot).toMatchObject({
      breakthrough_config_id: 'breakthrough.foundation.early',
      target_realm_id: 'realm.foundation.early',
      all_satisfied: true,
    });
    expect(queryLog.some((entry) => entry.sql.includes('UPDATE characters') && entry.sql.includes('realm_stage_id = $2'))).toBe(true);
    expect(queryLog.some((entry) => entry.sql.includes('UPDATE character_progression'))).toBe(true);
    expect(queryLog.some((entry) => entry.sql.includes('INSERT INTO outbox_events'))).toBe(true);
  });
});
