import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeReleaseContentHash, loadConfigRegistry, type ConfigRegistry } from '@dongtian/config-schema';
import type {
  AssetRepository,
  AssetReservationRequest,
  BuffRepository,
  DatabasePool,
  JsonValue,
  PoolClient,
  SettlementPersistenceInput,
  SettlementRepository,
  SettlementStateRecord,
  SettlementSummaryRecord,
  QueueEntryRecord,
  QueueRecord,
  QueueRepository,
} from '@dongtian/database';

import type { AuthService } from '../auth/auth.service.js';
import type { IdempotencyService } from '../idempotency/idempotency.service.js';
import { SettlementService } from './settlement.service.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T00:00:01.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const version = '2026.08.16.1';
const releasePath = fileURLToPath(new URL('../../../../config/releases/2026.08.16.1', import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyRelease(): string {
  const root = mkdtempSync(join(tmpdir(), 'dongtian-config-'));
  temporaryRoots.push(root);
  cpSync(releasePath, join(root, version), { recursive: true });

  const manifestPath = join(root, version, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest['content_hash'] = computeReleaseContentHash(join(root, version));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return root;
}

const registry: ConfigRegistry = loadConfigRegistry({
  releasesRoot: copyRelease(),
  version,
});

const snapshot = {
  action_config_id: 'action.t1.herb_baicao_valley',
  config_version: '2026.08.16.1',
  formula_version: registry.manifest.formula_version,
  duration_us: '1000000',
  cultivation_xp_per_cycle: '1.25',
  skill_xp_per_cycle: '0.5',
  outputs: {
    'item.t1.qingling_herb': '2',
  },
} as const;

const state: SettlementStateRecord = {
  characterId: 'character-1',
  lastSettledAt: new Date('2026-08-16T00:00:00.000Z'),
  offlineCapSeconds: 36_000,
  activeQueueEntryId: 'entry-1',
  activeCycleIndex: 0n,
  activeCycleSnapshot: snapshot,
  progressTimeUs: 0n,
  continuationRequired: false,
};

function makeService(
  currentState: SettlementStateRecord | null = state,
  ownershipError: Error | null = null,
  queueRepository?: QueueRepository,
  inventoryAvailableQuantity = '0',
) {
  const queries: string[] = [];
  const client = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      if (sql.includes('UPDATE skill_progression')) {
        return { rows: [{ xp: '0.5' }] as T[] };
      }
      if (sql.includes('FROM inventories')) {
        return { rows: [{ item_id: 'item.t1.qingling_herb', available_quantity: inventoryAvailableQuantity }] as T[] };
      }
      return { rows: [] as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient;
  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as DatabasePool;
  let lastPersist: SettlementPersistenceInput | undefined;
  const summaryRecord: SettlementSummaryRecord = {
    run: {
      settlementId: 'settlement-1',
      characterId: 'character-1',
      fromAt: new Date('2026-08-16T00:00:00.000Z'),
      effectiveUntil: new Date('2026-08-16T02:00:00.000Z'),
      requestedUntil: new Date('2026-08-16T02:30:00.000Z'),
      effectiveSeconds: 7_200n,
      cappedSeconds: 1_800n,
      status: 'COMPLETED',
      segmentCount: 2,
      randomSeed: new Uint8Array([1, 2, 3]),
      formulaVersion: registry.manifest.formula_version,
      configVersion: '2026.08.16.1',
      summary: {
        status: 'COMPLETED',
        requested_until_us: '9000000',
        effective_until_us: '7200000',
        effective_time_us: '7200000',
        capped_time_us: '1800000',
        completed_cycles: '2',
        progress_time_us: '0',
        continuation_required: false,
        active_queue_entry_id: 'entry-1',
        active_cycle_index: '2',
        action_config_id: 'action.t1.herb_baicao_valley',
        cultivation_xp: '2.5',
        skill_xp: '1.0',
        items: [{ item_id: 'item.t1.qingling_herb', quantity: '4' }],
      },
      errorCode: null,
      createdAt: new Date('2026-08-16T02:00:05.000Z'),
      completedAt: new Date('2026-08-16T02:00:06.000Z'),
    },
    segments: [{
      settlementRunId: 'settlement-1',
      segmentIndex: 0,
      queueEntryId: 'entry-1',
      actionConfigId: 'action.t1.herb_baicao_valley',
      fromAt: new Date('2026-08-16T00:00:00.000Z'),
      toAt: new Date('2026-08-16T01:00:00.000Z'),
      completedCycles: 1n,
      inputs: { 'item.t1.qingling_herb': '1' },
      outputs: { 'item.t1.qingling_herb': '2' },
      xpChanges: { cultivation_xp: '1.25', skill_xp: '0.5' },
      transitionReason: 'ACTION_SWITCH',
      snapshot: {
        action_config_id: 'action.t1.herb_baicao_valley',
        config_version: '2026.08.16.1',
        formula_version: registry.manifest.formula_version,
        duration_us: '1000000',
        cultivation_xp_per_cycle: '1.25',
        skill_xp_per_cycle: '0.5',
        outputs: { 'item.t1.qingling_herb': '2' },
      },
    }, {
      settlementRunId: 'settlement-1',
      segmentIndex: 1,
      queueEntryId: 'entry-2',
      actionConfigId: 'action.t1.herb_baicao_valley',
      fromAt: new Date('2026-08-16T01:00:00.000Z'),
      toAt: new Date('2026-08-16T02:00:00.000Z'),
      completedCycles: 1n,
      inputs: {},
      outputs: { 'item.t1.qingling_herb': '2' },
      xpChanges: { cultivation_xp: '1.25', skill_xp: '0.5' },
      transitionReason: 'BLOCKED_MATERIAL',
      snapshot: {
        action_config_id: 'action.t1.herb_baicao_valley',
        config_version: '2026.08.16.1',
        formula_version: registry.manifest.formula_version,
        duration_us: '1000000',
        cultivation_xp_per_cycle: '1.25',
        skill_xp_per_cycle: '0.5',
        outputs: { 'item.t1.qingling_herb': '2' },
      },
    }],
    ledgerEntries: [{
      entryId: 'ledger-1',
      transactionId: 'transaction-1',
      assetType: 'ITEM',
      assetId: 'item.t1.qingling_herb',
      delta: '4',
      balanceAfter: '4',
      reasonCode: 'SETTLEMENT_OUTPUT',
      referenceType: 'SETTLEMENT_RUN',
      referenceId: 'settlement-1',
      configVersion: '2026.08.16.1',
      createdAt: new Date('2026-08-16T02:00:06.000Z'),
    }, {
      entryId: 'ledger-2',
      transactionId: 'transaction-2',
      assetType: 'PROGRESSION',
      assetId: 'progression.cultivation',
      delta: '2.5',
      balanceAfter: '2.5',
      reasonCode: 'ACTION_CULTIVATION',
      referenceType: 'SETTLEMENT_RUN',
      referenceId: 'settlement-1',
      configVersion: '2026.08.16.1',
      createdAt: new Date('2026-08-16T02:00:06.000Z'),
    }],
  };

  const settlementRepository: SettlementRepository = {
    async getState() {
      return currentState;
    },
    async lockState() {
      return currentState;
    },
    async setActiveQueueCycle() {},
    async getLatestSummary() {
      return currentState === null ? null : summaryRecord;
    },
    async getSummaryById(characterId, settlementId) {
      return currentState !== null && characterId === 'character-1' && settlementId === 'settlement-1'
        ? summaryRecord
        : null;
    },
    async persist(_: PoolClient, input: SettlementPersistenceInput) {
      lastPersist = input;
      return 'settlement-1';
    },
    async runContinuationBatch(limit, handler) {
      await handler(undefined as unknown as PoolClient, 'character-1');
      return limit;
    },
  };

  const addedRewards: Array<Record<string, unknown>> = [];
  const assetRepository: AssetRepository = {
    async getInventory() {
      return null;
    },
    async getInventoryOnTransaction() {
      return null;
    },
    async add() {
      throw new Error('not used');
    },
    async addOnTransaction(_: PoolClient, input) {
      addedRewards.push(input);
      return {
        assetType: input.assetType,
        assetId: input.assetId,
        quantity: '2',
        reservedQuantity: '0',
        availableQuantity: '2',
        transactionId: 'asset-transaction-1',
        ledgerEntryId: 'asset-ledger-1',
      };
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
    async reserveOnTransaction(_client: PoolClient, input: AssetReservationRequest) {
      return {
        assetType: input.assetType,
        assetId: input.assetId,
        quantity: input.quantity,
        reservedQuantity: input.quantity,
        availableQuantity: '0',
        transactionId: 'reserve-transaction-1',
        ledgerEntryId: 'reserve-ledger-1',
        reservation: {
          reservationId: 'reservation-1',
          characterId: input.characterId,
          businessType: input.businessType,
          businessId: input.businessId,
          assetType: input.assetType,
          assetId: input.assetId,
          quantity: input.quantity,
          status: 'ACTIVE' as const,
          expiresAt: null,
        },
      };
    },
    async findActiveReservationsByBusiness() {
      return [];
    },
    async release() {
      throw new Error('not used');
    },
    async releaseOnTransaction() {
      throw new Error('not used');
    },
    async consume() {
      throw new Error('not used');
    },
    async consumeOnTransaction(_client: PoolClient, input: { readonly reservationId: string }) {
      return {
        assetType: 'ITEM' as const,
        assetId: 'item.t1.qingling_herb',
        quantity: '0',
        reservedQuantity: '0',
        availableQuantity: '0',
        transactionId: `consume-${input.reservationId}`,
        ledgerEntryId: `consume-ledger-${input.reservationId}`,
        reservation: {
          reservationId: input.reservationId,
          characterId: 'character-1',
          businessType: 'ACTION_CYCLE',
          businessId: 'settlement-1',
          assetType: 'ITEM' as const,
          assetId: 'item.t1.qingling_herb',
          quantity: '0',
          status: 'CONSUMED' as const,
          expiresAt: null,
        },
      };
    },
    async audit() {
      return { ok: true, discrepancyCount: 0, discrepancies: [] };
    },
  };

  const buffRepository: BuffRepository = {
    async getActiveBuffs() {
      return [];
    },
    async lockActiveBuffs() {
      return [];
    },
    async replaceBuffInstance() {
      throw new Error('not used');
    },
  };

  const authService = {
    async assertCharacterOwnership() {
      if (ownershipError !== null) {
        throw ownershipError;
      }
      return undefined;
    },
    async requireCurrentAccountId() {
      return 'account-1';
    },
    async requireWriteAccess() {
      return 'account-1';
    },
  } as unknown as AuthService;

  const idempotencyService = {
    async execute<T extends JsonValue>(input: {
      readonly accountId: string;
      readonly operationType: string;
      readonly idempotencyKey: string;
      readonly request: unknown;
      readonly now?: Date;
      readonly execute: (context: {
        readonly client: PoolClient;
        readonly idempotencyRecordId: string;
        readonly requestHash: string;
      }) => Promise<{
        readonly statusCode: number;
        readonly response: T;
      }>;
    }) {
      const result = await input.execute({
        client: undefined as unknown as PoolClient,
        idempotencyRecordId: 'idempotency-1',
        requestHash: 'hash',
      });
      return { ...result, replayed: false };
    },
  } as unknown as IdempotencyService;

  const service = new SettlementService(
    settlementRepository,
    assetRepository,
    buffRepository,
    pool,
    authService,
    idempotencyService,
    registry,
    { ACTIVE_CONFIG_VERSION: '2026.08.16.1' } as never,
    queueRepository,
  );

  return { service, settlementRepository, assetRepository, addedRewards, queries, getLastPersist: () => lastPersist };
}

describe('SettlementService', () => {
  it('does not write zero-quantity item rewards when no cycle elapsed', async () => {
    const { service, addedRewards } = makeService({
      ...state,
      lastSettledAt: new Date('2026-08-16T00:00:00.999Z'),
    });

    await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(addedRewards).toHaveLength(0);
  });

  it('settles the current snapshot and persists rewards in a single transaction', async () => {
    const { service, assetRepository, addedRewards, queries, getLastPersist } = makeService();
    const result = await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(result).toMatchObject({
      settlement_id: 'settlement-1',
      character_id: 'character-1',
      completed_cycles: '1',
      applied_rewards: {
        cultivation_xp: '1.25',
        skill_xp: '0.5',
        items: [{ item_id: 'item.t1.qingling_herb', quantity: '2' }],
      },
    });
    expect(getLastPersist())
      .toMatchObject({
        progressionAward: { cultivationXpDelta: '1.25' },
        skillProgressionAwards: [{ skillId: 'skill.herbalism', skillXpDelta: '0.5' }],
      });
    expect(addedRewards).toHaveLength(1);
    expect(queries).toEqual(['BEGIN', 'COMMIT']);
    expect(assetRepository.addOnTransaction).toBeDefined();
  });

  it('re-evaluates inventory conditions after a completed cycle and enters the next queue action', async () => {
    const currentEntry: QueueEntryRecord = {
      id: 'entry-1',
      characterId: 'character-1',
      clientEntryId: 'harvest',
      position: 0,
      actionConfigId: 'action.t1.herb_baicao_valley',
      mode: 'UNTIL_INVENTORY',
      targetValue: '1',
      conditionItemId: 'item.t1.qingling_herb',
      conditionOperator: '>=',
      onBlocked: 'FALLBACK',
      status: 'RUNNING',
      completedCycles: 0n,
      progressTimeUs: 0n,
      snapshot: null,
      snapshotConfigVersion: version,
      startedAt: null,
      completedAt: null,
      blockedReason: null,
    };
    const nextEntry: QueueEntryRecord = {
      ...currentEntry,
      id: 'entry-2',
      clientEntryId: 'refine',
      position: 1,
      actionConfigId: 'action.t1.qi_gathering_pill',
      conditionItemId: 'item.t1.qi_gathering_pill',
      status: 'QUEUED',
    };
    let queue: QueueRecord = {
      characterId: 'character-1',
      queueVersion: 1n,
      pendingReplaceAfterCycle: false,
      paused: false,
      fallbackActionId: 'action.cultivation.qi',
      entries: [currentEntry, nextEntry],
    };
    const queueRepository: QueueRepository = {
      async getQueue() { return queue; },
      async lockQueue() { return queue; },
      async replaceQueue() { return queue; },
      async setPaused() { return queue; },
      async setEntryStatus(_client, input) {
        queue = {
          ...queue,
          entries: queue.entries.map((entry) => entry.id === input.entryId
            ? { ...entry, status: input.status, blockedReason: input.blockedReason ?? null }
            : entry),
        };
        return queue;
      },
    };

    const { service, getLastPersist } = makeService(state, null, queueRepository, '0.000000');
    await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(queue.entries).toEqual([
      expect.objectContaining({ id: 'entry-1', status: 'DONE_CONDITION_MET' }),
      expect.objectContaining({ id: 'entry-2', status: 'RUNNING' }),
    ]);
    expect(getLastPersist()?.nextState).toMatchObject({
      activeQueueEntryId: 'entry-2',
      activeCycleSnapshot: expect.objectContaining({ action_config_id: 'action.t1.qi_gathering_pill' }),
    });
  });

  it('caps an UNTIL_INVENTORY action at the first cycle that satisfies its target', async () => {
    const currentEntry: QueueEntryRecord = {
      id: 'entry-cap',
      characterId: 'character-1',
      clientEntryId: 'cap',
      position: 0,
      actionConfigId: 'action.t1.herb_baicao_valley',
      mode: 'UNTIL_INVENTORY',
      targetValue: '1',
      conditionItemId: 'item.t1.qingling_herb',
      conditionOperator: '>=',
      onBlocked: 'FALLBACK',
      status: 'RUNNING',
      completedCycles: 0n,
      progressTimeUs: 0n,
      snapshot: null,
      snapshotConfigVersion: version,
      startedAt: null,
      completedAt: null,
      blockedReason: null,
    };
    let queue: QueueRecord = {
      characterId: 'character-1',
      queueVersion: 1n,
      pendingReplaceAfterCycle: false,
      paused: false,
      fallbackActionId: 'action.cultivation.qi',
      entries: [currentEntry],
    };
    const queueRepository: QueueRepository = {
      async getQueue() { return queue; },
      async lockQueue() { return queue; },
      async replaceQueue() { return queue; },
      async setPaused() { return queue; },
      async setEntryStatus(_client, input) {
        queue = {
          ...queue,
          entries: queue.entries.map((entry) => entry.id === input.entryId
            ? { ...entry, status: input.status, blockedReason: input.blockedReason ?? null }
            : entry),
        };
        return queue;
      },
    };
    const cappedState = {
      ...state,
      activeQueueEntryId: currentEntry.id,
      activeCycleSnapshot: { ...snapshot, duration_us: '1000000' },
    };
    const { service, getLastPersist } = makeService(cappedState, null, queueRepository);

    vi.setSystemTime(new Date('2026-08-16T00:00:05.000Z'));
    const result = await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(result.completed_cycles).toBe('1');
    expect(result.effective_time_us).toBe('1000000');
    expect(result.applied_rewards.items).toEqual([{ item_id: 'item.t1.qingling_herb', quantity: '2' }]);
    expect(queue.entries[0]).toMatchObject({ status: 'DONE_CONDITION_MET' });
    expect(getLastPersist()?.nextState.activeQueueEntryId).toBeUndefined();
  });

  it('switches an active FALLBACK blocked entry to fallback action', async () => {
    const blockedEntry: QueueEntryRecord = {
      id: 'entry-blocked',
      characterId: 'character-1',
      clientEntryId: 'blocked',
      position: 0,
      actionConfigId: 'action.t1.qi_gathering_pill',
      mode: 'UNTIL_INVENTORY',
      targetValue: '5',
      conditionItemId: 'item.t1.qi_gathering_pill',
      conditionOperator: '>=',
      onBlocked: 'FALLBACK',
      status: 'BLOCKED',
      completedCycles: 0n,
      progressTimeUs: 0n,
      snapshot: null,
      snapshotConfigVersion: version,
      startedAt: null,
      completedAt: null,
      blockedReason: 'blocked_material:item.t1.qingling_herb',
    };
    const queueRepository: QueueRepository = {
      async getQueue() { return { characterId: 'character-1', queueVersion: 1n, pendingReplaceAfterCycle: false, paused: false, fallbackActionId: 'action.cultivation.qi', entries: [blockedEntry] }; },
      async lockQueue() { return { characterId: 'character-1', queueVersion: 1n, pendingReplaceAfterCycle: false, paused: false, fallbackActionId: 'action.cultivation.qi', entries: [blockedEntry] }; },
      async replaceQueue() { throw new Error('not used'); },
      async setPaused() { throw new Error('not used'); },
      async setEntryStatus() { throw new Error('blocked entry must remain blocked'); },
    };
    const blockedState = { ...state, activeQueueEntryId: 'entry-blocked', activeCycleSnapshot: snapshot };
    const { service, getLastPersist } = makeService(blockedState, null, queueRepository);

    const result = await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(result.completed_cycles).toBe('0');
    expect(getLastPersist()?.nextState).toMatchObject({
      activeCycleSnapshot: expect.objectContaining({ action_config_id: 'action.cultivation.qi' }),
    });
  });

  it('marks an active SKIP blocked entry incomplete and starts the next queued entry', async () => {
    const blockedEntry: QueueEntryRecord = {
      id: 'entry-blocked-skip',
      characterId: 'character-1',
      clientEntryId: 'blocked-skip',
      position: 0,
      actionConfigId: 'action.t1.qi_gathering_pill',
      mode: 'COUNT',
      targetValue: '1',
      conditionItemId: null,
      conditionOperator: null,
      onBlocked: 'SKIP',
      status: 'BLOCKED',
      completedCycles: 0n,
      progressTimeUs: 0n,
      snapshot: null,
      snapshotConfigVersion: version,
      startedAt: null,
      completedAt: null,
      blockedReason: 'blocked_material:item.t1.qingling_herb',
    };
    const nextEntry: QueueEntryRecord = {
      ...blockedEntry,
      id: 'entry-after-skip',
      clientEntryId: 'after-skip',
      position: 1,
      actionConfigId: 'action.t1.herb_baicao_valley',
      status: 'QUEUED',
      onBlocked: 'FALLBACK',
      blockedReason: null,
    };
    let queue: QueueRecord = {
      characterId: 'character-1',
      queueVersion: 1n,
      pendingReplaceAfterCycle: false,
      paused: false,
      fallbackActionId: 'action.cultivation.qi',
      entries: [blockedEntry, nextEntry],
    };
    const queueRepository: QueueRepository = {
      async getQueue() { return queue; },
      async lockQueue() { return queue; },
      async replaceQueue() { return queue; },
      async setPaused() { return queue; },
      async setEntryStatus(_client, input) {
        queue = {
          ...queue,
          entries: queue.entries.map((entry) => entry.id === input.entryId
            ? { ...entry, status: input.status, blockedReason: input.blockedReason ?? null }
            : entry),
        };
        return queue;
      },
    };
    const blockedState = { ...state, activeQueueEntryId: blockedEntry.id, activeCycleSnapshot: snapshot };
    const { service, getLastPersist } = makeService(blockedState, null, queueRepository);

    await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(queue.entries).toEqual([
      expect.objectContaining({ id: blockedEntry.id, status: 'DONE_INCOMPLETE' }),
      expect.objectContaining({ id: nextEntry.id, status: 'RUNNING' }),
    ]);
    expect(getLastPersist()?.nextState).toMatchObject({ activeQueueEntryId: nextEntry.id });
  });

  it('marks an already satisfied active UNTIL_INVENTORY entry done before settlement', async () => {
    const currentEntry: QueueEntryRecord = {
      id: 'entry-already-satisfied',
      characterId: 'character-1',
      clientEntryId: 'already-satisfied',
      position: 0,
      actionConfigId: 'action.t1.herb_baicao_valley',
      mode: 'UNTIL_INVENTORY',
      targetValue: '1',
      conditionItemId: 'item.t1.qingling_herb',
      conditionOperator: '>=',
      onBlocked: 'FALLBACK',
      status: 'RUNNING',
      completedCycles: 0n,
      progressTimeUs: 0n,
      snapshot: null,
      snapshotConfigVersion: version,
      startedAt: null,
      completedAt: null,
      blockedReason: null,
    };
    let queue: QueueRecord = {
      characterId: 'character-1',
      queueVersion: 1n,
      pendingReplaceAfterCycle: false,
      paused: false,
      fallbackActionId: 'action.cultivation.qi',
      entries: [currentEntry],
    };
    const queueRepository: QueueRepository = {
      async getQueue() { return queue; },
      async lockQueue() { return queue; },
      async replaceQueue() { return queue; },
      async setPaused() { return queue; },
      async setEntryStatus(_client, input) {
        queue = {
          ...queue,
          entries: queue.entries.map((entry) => entry.id === input.entryId
            ? { ...entry, status: input.status, blockedReason: input.blockedReason ?? null }
            : entry),
        };
        return queue;
      },
    };
    const satisfiedState = { ...state, activeQueueEntryId: currentEntry.id, activeCycleSnapshot: snapshot };
    const { service, getLastPersist } = makeService(satisfiedState, null, queueRepository, '1');

    const result = await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(result.completed_cycles).toBe('0');
    expect(queue.entries[0]).toMatchObject({ status: 'DONE_CONDITION_MET' });
    expect(getLastPersist()?.nextState.activeQueueEntryId).toBeUndefined();
  });

  it('keeps a blocked queued entry on fallback until queue reconciliation unblocks it', async () => {
    const blockedEntry: QueueEntryRecord = {
      id: 'entry-blocked-fallback',
      characterId: 'character-1',
      clientEntryId: 'blocked-fallback',
      position: 0,
      actionConfigId: 'action.t1.qi_gathering_pill',
      mode: 'UNTIL_INVENTORY',
      targetValue: '5',
      conditionItemId: 'item.t1.qi_gathering_pill',
      conditionOperator: '>=',
      onBlocked: 'FALLBACK',
      status: 'BLOCKED',
      completedCycles: 0n,
      progressTimeUs: 0n,
      snapshot: null,
      snapshotConfigVersion: version,
      startedAt: null,
      completedAt: null,
      blockedReason: 'blocked_material:item.t1.qingling_herb',
    };
    const fallbackQueue: QueueRecord = {
      characterId: 'character-1',
      queueVersion: 1n,
      pendingReplaceAfterCycle: false,
      paused: false,
      fallbackActionId: 'action.cultivation.qi',
      entries: [blockedEntry],
    };
    const queueRepository: QueueRepository = {
      async getQueue() { return fallbackQueue; },
      async lockQueue() { return fallbackQueue; },
      async replaceQueue() { throw new Error('not used'); },
      async setPaused() { throw new Error('not used'); },
      async setEntryStatus() { throw new Error('blocked entry must remain blocked'); },
    };
    const fallbackState = { ...state, activeQueueEntryId: null, activeCycleSnapshot: snapshot };
    const { service, getLastPersist } = makeService(fallbackState, null, queueRepository);

    const result = await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(result.completed_cycles).toBe('1');
    expect(getLastPersist()?.nextState).not.toHaveProperty('activeQueueEntryId');
    expect(getLastPersist()?.nextState.activeCycleSnapshot).toEqual(
      expect.objectContaining({ action_config_id: 'action.t1.herb_baicao_valley' }),
    );
  });

  it('re-enters a completed inventory condition after its target item is consumed', async () => {
    const completedEntry: QueueEntryRecord = {
      id: 'entry-reenter',
      characterId: 'character-1',
      clientEntryId: 'refine-again',
      position: 0,
      actionConfigId: 'action.t1.herb_baicao_valley',
      mode: 'UNTIL_INVENTORY',
      targetValue: '5',
      conditionItemId: 'item.t1.qingling_herb',
      conditionOperator: '>=',
      onBlocked: 'FALLBACK',
      status: 'DONE_CONDITION_MET',
      completedCycles: 1n,
      progressTimeUs: 0n,
      snapshot: null,
      snapshotConfigVersion: version,
      startedAt: null,
      completedAt: new Date('2026-08-16T00:00:01.000Z'),
      blockedReason: null,
    };
    let queue: QueueRecord = {
      characterId: 'character-1',
      queueVersion: 2n,
      pendingReplaceAfterCycle: false,
      paused: false,
      fallbackActionId: 'action.cultivation.qi',
      entries: [completedEntry],
    };
    const queueRepository: QueueRepository = {
      async getQueue() { return queue; },
      async lockQueue() { return queue; },
      async replaceQueue() { return queue; },
      async setPaused() { return queue; },
      async setEntryStatus(_client, input) {
        queue = {
          ...queue,
          entries: queue.entries.map((entry) => entry.id === input.entryId
            ? { ...entry, status: input.status, blockedReason: input.blockedReason ?? null }
            : entry),
        };
        return queue;
      },
    };
    const fallbackState = { ...state, activeQueueEntryId: null, activeCycleSnapshot: snapshot };
    const { service, getLastPersist } = makeService(fallbackState, null, queueRepository);

    vi.setSystemTime(new Date('2026-08-16T00:05:00.000Z'));
    const result = await service.settleToNow({} as unknown as FastifyRequest, 'character-1');

    expect(result.completed_cycles).toBe('3');
    expect(queue.entries[0]).toMatchObject({ status: 'RUNNING' });
    expect(getLastPersist()?.nextState).toMatchObject({
      activeQueueEntryId: 'entry-reenter',
      activeCycleSnapshot: expect.objectContaining({ action_config_id: 'action.t1.herb_baicao_valley' }),
    });
  });

  it('wraps an idempotent settlement write and forwards the settled state to the handler', async () => {
    const { service, addedRewards } = makeService();
    const request = {
      headers: { 'idempotency-key': '0198f6d7-3f09-7c11-8e2d-000000000001' },
    } as unknown as FastifyRequest;

    const result = await service.executeSettledWrite(request, 'character-1', {
      operationType: 'QUEUE_SAVE',
      request: { foo: 'bar' },
      execute: async ({ settlement, settlementState }) => ({
        statusCode: 200,
        response: {
          settlement_id: settlement.settlement_id,
          character_id: settlementState.characterId,
        },
      }),
    });

    expect(result).toMatchObject({
      statusCode: 200,
      replayed: false,
      response: {
        settlement_id: 'settlement-1',
        character_id: 'character-1',
      },
    });
    expect(addedRewards).toHaveLength(1);
  });

  it('delegates continuation work to the repository claim helper', async () => {
    const { service } = makeService(null);
    await expect(service.continuePendingSettlements(2, async () => undefined)).resolves.toBe(2);
  });

  it('returns the latest persisted settlement summary without recalculating rewards', async () => {
    const { service } = makeService();
    const result = await service.getLatestSettlementSummary({} as unknown as FastifyRequest, 'character-1');

    expect(result).toMatchObject({
      settlement: {
        settlement_id: 'settlement-1',
        character_id: 'character-1',
        as_of: '2026-08-16T02:00:06.000Z',
        from_at: '2026-08-16T00:00:00.000Z',
        requested_until: '2026-08-16T02:30:00.000Z',
        effective_until: '2026-08-16T02:00:00.000Z',
        effective_time_us: '7200000',
        capped_time_us: '1800000',
        continuation_required: false,
        status: 'COMPLETED',
        rewards: {
          cultivation_xp: '2.5',
          skill_xp: '1.0',
          items: [{ item_id: 'item.t1.qingling_herb', quantity: '4' }],
        },
        timeline: [
          expect.objectContaining({
            segment_index: 0,
            transition_reason: 'ACTION_SWITCH',
          }),
          expect.objectContaining({
            segment_index: 1,
            transition_reason: 'BLOCKED_MATERIAL',
          }),
        ],
        ledger_entries: [
          expect.objectContaining({
            entry_id: 'ledger-1',
            asset_type: 'ITEM',
          }),
          expect.objectContaining({
            entry_id: 'ledger-2',
            asset_type: 'PROGRESSION',
          }),
        ],
      },
    });
  });

  it('returns an empty state when there is no settlement summary yet', async () => {
    const { service } = makeService(null);
    const result = await service.getLatestSettlementSummary({} as unknown as FastifyRequest, 'character-1');

    expect(result).toEqual({ settlement: null });
  });

  it('reads a specified settlement summary by settlement id', async () => {
    const { service } = makeService();
    const result = await service.getSettlementSummary({} as unknown as FastifyRequest, 'character-1', 'settlement-1');

    expect(result.settlement).toMatchObject({
      settlement_id: 'settlement-1',
      rewards: { cultivation_xp: '2.5' },
    });
  });

  it('blocks settlement summary access when the character is not owned', async () => {
    const { service } = makeService(state, new Error('NOT_OWNER'));
    await expect(service.getLatestSettlementSummary({} as unknown as FastifyRequest, 'character-1'))
      .rejects.toThrow('NOT_OWNER');
  });
});
