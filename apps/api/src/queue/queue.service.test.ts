import { describe, expect, it } from 'vitest';

import {
  ConfigRegistry,
  type ActionConfig,
  type ItemConfig,
  type RealmConfig,
} from '@dongtian/config-schema';
import type {
  AssetRepository,
  AssetReservationLookup,
  AssetReservationRequest,
  CharacterProgressionRecord,
  CharacterRepository,
  InventorySnapshot,
  JsonValue,
  QueueEntryRecord,
  QueueRecord,
  QueueRepository,
  ReservationLifecycleRequest,
} from '@dongtian/database';
import type { FastifyRequest } from 'fastify';

import type { AuthService } from '../auth/auth.service.js';
import type { SettlementService } from '../settlement/settlement.service.js';
import { QueueService } from './queue.service.js';

const manifest = {
  config_version: '2026.08.16.1',
  schema_version: 1,
  formula_version: 1,
  created_at: '2026-08-16T00:00:00+08:00',
  min_client_version: '1.0.0',
  content_hash: `sha256:${'0'.repeat(64)}`,
  previous_version: null,
};

const realm = {
  id: 'realm.mortal.entry',
  name_key: 'realm.mortal.entry.name',
  enabled: true,
  deprecated: false,
  realm_required: 'realm.mortal.entry',
  feature_flag: null,
  sort_order: 0,
  tags: [],
  source_note: 'test',
  realm_group: 'MORTAL',
  stage_order: 0,
  cultivation_xp_start: '0',
  cultivation_xp_required: '100',
  queue_slots: 2,
  medicine_slots: 2,
  offline_cap_seconds: 36000,
  unlock_bundle_id: 'bundle.test',
  scope: 'MVP',
} as RealmConfig;

const foundationRealm = {
  ...realm,
  id: 'realm.foundation.early',
  name_key: 'realm.foundation.early.name',
  realm_required: 'realm.qi.great',
  realm_group: 'FOUNDATION',
  stage_order: 5,
  queue_slots: 3,
  cultivation_xp_required: '200',
  unlock_bundle_id: 'bundle.foundation.test',
} as RealmConfig;

const freeAction = {
  id: 'action.t1.free_loop',
  name_key: 'action.t1.free_loop.name',
  enabled: true,
  deprecated: false,
  realm_required: realm.id,
  feature_flag: null,
  sort_order: 0,
  tags: [],
  source_note: 'test',
  skill_id: null,
  base_duration_us: '100000000',
  inputs: [],
  outputs: [],
  skill_xp: '0',
  cultivation_xp: '0',
  loot_table_id: null,
  allowed_queue_modes: ['COUNT', 'DURATION', 'INFINITE'],
  required_tool_tag: null,
  modifier_tags: [],
  scope: 'MVP',
} as ActionConfig;

const materialAction = {
  id: 'action.t1.material_reserve_test',
  name_key: 'action.t1.material_reserve_test.name',
  enabled: true,
  deprecated: false,
  realm_required: realm.id,
  feature_flag: null,
  sort_order: 1,
  tags: [],
  source_note: 'test',
  skill_id: null,
  base_duration_us: '100000000',
  inputs: [{ item_id: 'item.t1.qingling_herb', quantity: '3' }],
  outputs: [],
  skill_xp: '0',
  cultivation_xp: '0',
  loot_table_id: null,
  allowed_queue_modes: ['COUNT', 'DURATION', 'INFINITE'],
  required_tool_tag: null,
  modifier_tags: [],
  scope: 'MVP',
} as ActionConfig;

const inventoryConditionItem = {
  id: 'item.t1.qingling_herb',
  name_key: 'item.t1.qingling_herb.name',
  enabled: true,
  deprecated: false,
  realm_required: realm.id,
  feature_flag: null,
  sort_order: 0,
  tags: [],
  source_note: 'test',
  category: 'HERB',
  tier: 1,
  stackable: true,
  max_stack: '999',
  trade_policy: 'NONE',
  rarity: 'COMMON',
  overflow_policy: 'MATERIAL_STACK',
} as ItemConfig;

const registry = new ConfigRegistry({
  manifest,
  realms: [realm, foundationRealm],
  featureUnlocks: [],
  skills: [],
  xpCurves: [],
  items: [inventoryConditionItem],
  actions: [freeAction, materialAction],
  recipes: [],
  equipments: [],
  buffs: [],
  lootTables: [],
  monsters: [],
  dungeons: [],
});

const character: CharacterProgressionRecord = {
  characterId: 'character-1',
  accountId: 'account-1',
  name: '洞天散修',
  stateVersion: '0',
  activeConfigVersion: manifest.config_version,
  cultivationXp: '0',
  realmStageId: realm.id,
  skills: [],
};

const foundationCharacter: CharacterProgressionRecord = {
  ...character,
  realmStageId: foundationRealm.id,
  activeConfigVersion: manifest.config_version,
  characterId: 'character-foundation',
};

type ItemState = {
  quantity: bigint;
  reserved: bigint;
};

type ReservationState = {
  readonly reservationId: string;
  readonly characterId: string;
  readonly businessType: string;
  readonly businessId: string;
  readonly assetType: 'ITEM';
  readonly assetId: string;
  quantity: string;
  status: 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';
};

function buildQueueRecord(
  characterId: string,
  version: bigint,
  paused = false,
  entries: readonly QueueEntryRecord[] = [],
): QueueRecord {
  return {
    characterId,
    queueVersion: version,
    pendingReplaceAfterCycle: false,
    paused,
    fallbackActionId: freeAction.id,
    entries,
  };
}

function makeService(
  initialInventory = 0n,
  settlementContinuationRequired = false,
  currentCharacter: CharacterProgressionRecord = character,
): {
  readonly service: QueueService;
  readonly queueState: { current: QueueRecord | null };
  readonly inventoryState: ItemState;
  readonly reservations: ReservationState[];
  readonly steps: string[];
} {
  const inventoryState: ItemState = { quantity: initialInventory, reserved: 0n };
  const reservations: ReservationState[] = [];
  const steps: string[] = [];
  let nextEntryId = 1;
  let nextTransactionId = 1;
  let nextLedgerEntryId = 1;
  let nextReservationId = 1;
  const queueState = { current: null as QueueRecord | null };
  let currentTxClient: unknown = null;
  const replayCache = new Map<string, { readonly statusCode: number; readonly response: JsonValue }>();

  function assertTxClient(client: unknown): void {
    expect(client).toBe(currentTxClient);
  }

  function snapshotInventory(): InventorySnapshot {
    return {
      items: [{
        assetType: 'ITEM',
        assetId: 'item.t1.qingling_herb',
        quantity: inventoryState.quantity.toString(),
        reservedQuantity: inventoryState.reserved.toString(),
        availableQuantity: (inventoryState.quantity - inventoryState.reserved).toString(),
      }],
      currencies: [],
      equipmentInstances: [],
    };
  }

  function cloneEntry(entry: QueueEntryRecord): QueueEntryRecord {
    return { ...entry };
  }

  const repository: QueueRepository = {
    async getQueue() {
      return queueState.current === null
        ? null
        : { ...queueState.current, entries: queueState.current.entries.map(cloneEntry) };
    },
    async lockQueue(client) {
      steps.push('queue.lockQueue');
      assertTxClient(client);
      return queueState.current === null
        ? null
        : { ...queueState.current, entries: queueState.current.entries.map(cloneEntry) };
    },
    async replaceQueue(client, input) {
      steps.push('queue.replaceQueue');
      assertTxClient(client);
      const currentVersion = queueState.current?.queueVersion ?? 0n;
      if (currentVersion !== input.expectedQueueVersion) {
        throw new Error(`QUEUE_VERSION_CONFLICT:${currentVersion.toString()}`);
      }

      const existingRunning = queueState.current?.entries.filter((entry) => entry.status === 'RUNNING').map(cloneEntry) ?? [];
      const nextEntries = input.entries.map((entry, index) => ({
        id: `entry-${nextEntryId++}`,
        characterId: input.characterId,
        clientEntryId: entry.clientEntryId,
        position: entry.position + existingRunning.length,
        actionConfigId: entry.actionConfigId,
        mode: entry.mode,
        targetValue: entry.targetValue ?? null,
        conditionItemId: entry.conditionItemId ?? null,
        conditionOperator: entry.conditionOperator ?? null,
        onBlocked: entry.onBlocked,
        status: 'QUEUED' as const,
        completedCycles: 0n,
        progressTimeUs: 0n,
        snapshot: { client_entry_id: entry.clientEntryId } as JsonValue,
        snapshotConfigVersion: entry.configVersion,
        startedAt: null,
        completedAt: null,
        blockedReason: null,
        _index: index,
      }));
      queueState.current = buildQueueRecord(
        currentCharacter.characterId,
        currentVersion + 1n,
        false,
        [...existingRunning, ...nextEntries.map(({ _index, ...entry }) => entry)],
      );
      return queueState.current;
    },
    async setPaused(client, input) {
      steps.push('queue.setPaused');
      assertTxClient(client);
      const currentVersion = queueState.current?.queueVersion ?? 0n;
      if (queueState.current === null) {
        throw new Error('QUEUE_NOT_FOUND');
      }
      if (currentVersion !== input.expectedQueueVersion) {
        throw new Error(`QUEUE_VERSION_CONFLICT:${currentVersion.toString()}`);
      }
      queueState.current = { ...queueState.current, paused: input.paused, queueVersion: currentVersion + 1n };
      return { ...queueState.current, entries: queueState.current.entries.map(cloneEntry) };
    },
    async setEntryStatus(client, input) {
      steps.push('queue.setEntryStatus');
      assertTxClient(client);
      if (queueState.current === null) {
        throw new Error('QUEUE_NOT_FOUND');
      }
      const nextEntries = queueState.current.entries.map((entry) => {
        if (entry.id !== input.entryId) {
          return entry;
        }
        return {
          ...entry,
          status: input.status,
          blockedReason: input.blockedReason ?? null,
          completedAt: input.status === 'DONE' || input.status === 'DONE_INCOMPLETE' || input.status === 'DONE_CONDITION_MET' || input.status === 'CANCELLED'
            ? new Date('2026-08-16T00:00:00.000Z')
            : entry.completedAt,
        };
      });
      queueState.current = { ...queueState.current, entries: nextEntries };
      return { ...queueState.current, entries: queueState.current.entries.map(cloneEntry) };
    },
  };

  const assetRepository = {
    async getInventory() {
      return snapshotInventory();
    },
    async getInventoryOnTransaction(client: unknown) {
      steps.push('asset.getInventoryOnTransaction');
      assertTxClient(client);
      return snapshotInventory();
    },
    async reserveOnTransaction(client: unknown, input: AssetReservationRequest) {
      steps.push('asset.reserveOnTransaction');
      assertTxClient(client);
      const amount = BigInt(input.quantity);
      const available = inventoryState.quantity - inventoryState.reserved;
      if (available < amount) {
        throw new Error('INSUFFICIENT_AVAILABLE');
      }
      inventoryState.reserved += amount;
      const reservation: ReservationState = {
        reservationId: `reservation-${nextReservationId++}`,
        characterId: input.characterId,
        businessType: input.businessType,
        businessId: input.businessId,
        assetType: 'ITEM',
        assetId: input.assetId,
        quantity: input.quantity,
        status: 'ACTIVE',
      };
      reservations.push(reservation);
      return {
        quantity: inventoryState.quantity.toString(),
        reservedQuantity: inventoryState.reserved.toString(),
        availableQuantity: (inventoryState.quantity - inventoryState.reserved).toString(),
        transactionId: `transaction-${nextTransactionId++}`,
        ledgerEntryId: `ledger-${nextLedgerEntryId++}`,
        reservation,
      };
    },
    async findActiveReservationsByBusiness(client: unknown, input: AssetReservationLookup) {
      steps.push('asset.findActiveReservationsByBusiness');
      assertTxClient(client);
      return reservations.filter((reservation) =>
        reservation.characterId === input.characterId
        && reservation.businessType === input.businessType
        && reservation.businessId === input.businessId
        && reservation.status === 'ACTIVE',
      ).map((reservation) => ({ ...reservation }));
    },
    async releaseOnTransaction(client: unknown, input: ReservationLifecycleRequest) {
      steps.push('asset.releaseOnTransaction');
      assertTxClient(client);
      const reservation = reservations.find((item) => item.reservationId === input.reservationId);
      if (!reservation || reservation.status !== 'ACTIVE') {
        throw new Error('RESERVATION_NOT_ACTIVE');
      }
      reservation.status = 'RELEASED';
      inventoryState.reserved -= BigInt(reservation.quantity);
      return {
        quantity: inventoryState.quantity.toString(),
        reservedQuantity: inventoryState.reserved.toString(),
        availableQuantity: (inventoryState.quantity - inventoryState.reserved).toString(),
        transactionId: `transaction-${nextTransactionId++}`,
        ledgerEntryId: `ledger-${nextLedgerEntryId++}`,
        reservation: { ...reservation },
      };
    },
    async consumeOnTransaction(client: unknown, _input: ReservationLifecycleRequest) {
      steps.push('asset.consumeOnTransaction');
      assertTxClient(client);
      throw new Error('NOT_USED_IN_QUEUE_TEST');
    },
  } as unknown as AssetRepository;

  const characterRepository: CharacterRepository = {
    async getProgression() {
      return currentCharacter;
    },
  };

  const authService = {
    async requireCurrentAccountId() {
      return currentCharacter.accountId;
    },
    async requireWriteAccess() {
      return currentCharacter.accountId;
    },
  } as unknown as AuthService;

  const settlementService = {
    async executeSettledWrite<T extends JsonValue>(
      request: FastifyRequest,
      characterId: string,
      input: {
        readonly operationType: 'QUEUE_SAVE' | 'QUEUE_PAUSE' | 'QUEUE_RESUME';
        readonly request: unknown;
        readonly execute: (context: {
          readonly client: unknown;
          readonly settlement: { readonly continuationRequired: boolean };
          readonly settlementState: { readonly continuationRequired: boolean };
          readonly requestHash: string;
        }) => Promise<{
          readonly statusCode: number;
          readonly response: T;
        }>;
      },
    ): Promise<{
      readonly statusCode: number;
      readonly response: T;
    }> {
      const idempotencyKey = request.headers['idempotency-key'];
      const cacheKey = `${characterId}:${input.operationType}:${
        typeof idempotencyKey === 'string' ? idempotencyKey : 'missing'
      }`;
      const cached = replayCache.get(cacheKey);
      if (cached !== undefined) {
        steps.push(`replay:${input.operationType}`);
        return cached as { readonly statusCode: number; readonly response: T };
      }

      const client = { settlementClientId: `tx-${steps.length + 1}` };
      currentTxClient = client;
      steps.push(`settlement:${input.operationType}`);
      const result = await input.execute({
        client,
        settlement: { continuationRequired: settlementContinuationRequired },
        settlementState: { continuationRequired: settlementContinuationRequired },
        requestHash: `hash-${cacheKey}`,
      });
      replayCache.set(cacheKey, result);
      return result;
    },
  } as unknown as SettlementService;

  return {
    service: new QueueService(
      repository,
      characterRepository,
      assetRepository,
      authService,
      settlementService,
      registry,
    ),
    queueState,
    inventoryState,
    reservations,
    steps,
  };
}

function request(idempotencyKey: string): FastifyRequest {
  return { headers: { 'idempotency-key': idempotencyKey } } as unknown as FastifyRequest;
}

const previewPlan = {
  expected_queue_version: 0,
  entries: [{
    client_entry_id: 'tmp-preview-1',
    action_id: freeAction.id,
    mode: 'COUNT',
    target_value: 2,
    on_blocked: 'FALLBACK',
  }],
  fallback: { action_id: freeAction.id, mode: 'INFINITE' },
};

const materialPlan = {
  expected_queue_version: 0,
  entries: [{
    client_entry_id: 'tmp-material-1',
    action_id: materialAction.id,
    mode: 'COUNT',
    target_value: 2,
    on_blocked: 'FALLBACK',
  }],
  fallback: { action_id: freeAction.id, mode: 'INFINITE' },
};

function makeValidationPlan(input: {
  readonly mode: 'COUNT' | 'DURATION';
  readonly targetValue: string | number;
}) {
  return {
    expected_queue_version: 0,
    entries: [{
      client_entry_id: `tmp-${input.mode.toLowerCase()}`,
      action_id: freeAction.id,
      mode: input.mode,
      target_value: input.targetValue,
      on_blocked: 'FALLBACK',
    }],
    fallback: { action_id: freeAction.id, mode: 'INFINITE' },
  };
}

describe('QueueService', () => {
  it('previews without changing the queue or assets', async () => {
    const { service } = makeService();
    const result = await service.preview(request('preview-key'), character.characterId, previewPlan);

    expect(result).toMatchObject({
      queue_version: 0,
      entries: [{ estimated_cycles: '2', estimated_duration_us: '200000000' }],
      total_duration_us: '200000000',
    });
  });

  it('rejects COUNT and DURATION targets that exceed the safe planning window', async () => {
    const { service } = makeService();

    await expect(service.preview(request('count-max'), character.characterId, makeValidationPlan({
      mode: 'COUNT',
      targetValue: '360',
    }))).resolves.toMatchObject({ queue_version: 0 });

    await expect(service.preview(request('count-max-plus-one'), character.characterId, makeValidationPlan({
      mode: 'COUNT',
      targetValue: '361',
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });

    await expect(service.preview(request('duration-max'), character.characterId, makeValidationPlan({
      mode: 'DURATION',
      targetValue: '36000',
    }))).resolves.toMatchObject({ queue_version: 0 });

    await expect(service.preview(request('duration-max-plus-one'), character.characterId, makeValidationPlan({
      mode: 'DURATION',
      targetValue: '36001',
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('rejects oversized and non-canonical numeric target strings before they can overflow parsing', async () => {
    const { service } = makeService();
    const giantDigits = '9'.repeat(1000);

    await expect(service.preview(request('count-giant'), character.characterId, makeValidationPlan({
      mode: 'COUNT',
      targetValue: giantDigits,
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });

    await expect(service.preview(request('count-exp'), character.characterId, makeValidationPlan({
      mode: 'COUNT',
      targetValue: '1e6',
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });

    await expect(service.preview(request('count-decimal'), character.characterId, makeValidationPlan({
      mode: 'COUNT',
      targetValue: '12.5',
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });

    await expect(service.preview(request('count-negative'), character.characterId, makeValidationPlan({
      mode: 'COUNT',
      targetValue: '-1',
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });

    await expect(service.preview(request('duration-giant'), character.characterId, makeValidationPlan({
      mode: 'DURATION',
      targetValue: giantDigits,
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });

    await expect(service.preview(request('duration-exp'), character.characterId, makeValidationPlan({
      mode: 'DURATION',
      targetValue: '1e6',
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });

    await expect(service.preview(request('duration-decimal'), character.characterId, makeValidationPlan({
      mode: 'DURATION',
      targetValue: '12.5',
    }))).resolves.toMatchObject({ queue_version: 0 });

    await expect(service.preview(request('duration-negative'), character.characterId, makeValidationPlan({
      mode: 'DURATION',
      targetValue: '-1',
    }))).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('reserves inputs on save and releases them when the entry is replaced away', async () => {
    const { service, queueState, inventoryState, reservations, steps } = makeService(6n);
    const saveRequest = request('save-key');

    const saved = await service.save(saveRequest, character.characterId, materialPlan);
    expect(saved).toMatchObject({
      queue_version: 1,
      queue: {
        entries: [expect.objectContaining({ status: 'QUEUED' })],
      },
    });
    expect(queueState.current?.entries[0]?.status).toBe('QUEUED');
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ status: 'ACTIVE', quantity: '6' });
    expect(inventoryState.reserved).toBe(6n);
    expect(steps[0]).toBe('settlement:QUEUE_SAVE');
    expect(steps).toContain('queue.replaceQueue');
    expect(steps.indexOf('queue.replaceQueue')).toBeGreaterThan(steps.indexOf('settlement:QUEUE_SAVE'));

    steps.length = 0;
    const replacementPlan = {
      expected_queue_version: 1,
      entries: [],
      fallback: { action_id: freeAction.id, mode: 'INFINITE' },
    };
    const replaced = await service.save(request('replace-key'), character.characterId, replacementPlan);

    expect(replaced).toMatchObject({ queue_version: 2 });
    expect(queueState.current?.entries).toHaveLength(0);
    expect(reservations[0]).toMatchObject({ status: 'RELEASED' });
    expect(inventoryState.reserved).toBe(0n);
    expect(steps[0]).toBe('settlement:QUEUE_SAVE');
  });

  it('routes pause and resume through the settlement wrapper on the same transaction client', async () => {
    const { service, queueState, inventoryState, reservations, steps } = makeService(6n);
    await service.save(request('save-key'), character.characterId, materialPlan);

    steps.length = 0;
    const paused = await service.pause(request('pause-key'), character.characterId, {
      expected_queue_version: 1,
    });
    expect(paused).toMatchObject({ queue_version: 2, paused: true });
    expect(queueState.current?.paused).toBe(true);
    expect(steps[0]).toBe('settlement:QUEUE_PAUSE');
    expect(steps).toContain('queue.setPaused');

    steps.length = 0;
    const resumed = await service.resume(request('resume-key'), character.characterId, {
      expected_queue_version: 2,
    });
    expect(resumed).toMatchObject({ queue_version: 3, paused: false });
    expect(queueState.current?.paused).toBe(false);
    expect(steps[0]).toBe('settlement:QUEUE_RESUME');
    expect(steps).toContain('queue.setPaused');
    expect(steps).toContain('asset.getInventoryOnTransaction');
    expect(inventoryState.reserved).toBe(6n);
    expect(reservations).toHaveLength(1);
  });

  it('blocks on shortage and clears the block after inventory is replenished', async () => {
    const { service, queueState, inventoryState, reservations, steps } = makeService(5n);

    const blocked = await service.save(request('blocked-save'), character.characterId, materialPlan);
    expect(blocked).toMatchObject({ queue_version: 1 });
    expect(queueState.current?.entries[0]).toMatchObject({
      status: 'BLOCKED',
      blockedReason: expect.stringContaining('blocked_material:item.t1.qingling_herb'),
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ status: 'ACTIVE', quantity: '5' });
    expect(steps[0]).toBe('settlement:QUEUE_SAVE');
    expect(steps).toContain('queue.replaceQueue');

    inventoryState.quantity = 10n;
    steps.length = 0;
    const resumed = await service.resume(request('resume-key'), character.characterId, {
      expected_queue_version: 1,
    });

    expect(resumed).toMatchObject({ queue_version: 2, paused: false });
    expect(queueState.current?.entries[0]).toMatchObject({
      status: 'QUEUED',
      blockedReason: null,
    });
    expect(reservations[0]).toMatchObject({ status: 'ACTIVE', quantity: '5' });
    expect(reservations).toHaveLength(2);
    expect(inventoryState.reserved).toBe(6n);
    expect(steps[0]).toBe('settlement:QUEUE_RESUME');
    expect(steps).toContain('queue.setPaused');
    expect(steps).toContain('asset.getInventoryOnTransaction');
  });

  it('locks UNTIL_INVENTORY before foundation and accepts it at three slots', async () => {
    const mortal = makeService(0n);
    await expect(mortal.service.save(request('mortal-until'), character.characterId, {
      expected_queue_version: 0,
      entries: [{
        client_entry_id: 'tmp-until-locked',
        action_id: freeAction.id,
        mode: 'UNTIL_INVENTORY',
        target_value: '5',
        condition_item_id: inventoryConditionItem.id,
        condition_operator: '>=',
        on_blocked: 'FALLBACK',
      }],
      fallback: { action_id: freeAction.id, mode: 'INFINITE' },
    })).rejects.toMatchObject({
      response: { code: 'FEATURE_LOCKED' },
    });

    const foundation = makeService(5n, false, foundationCharacter);
    await expect(foundation.service.save(request('foundation-until'), foundationCharacter.characterId, {
      expected_queue_version: 0,
      entries: [{
        client_entry_id: 'tmp-until-foundation',
        action_id: freeAction.id,
        mode: 'UNTIL_INVENTORY',
        target_value: '5',
        condition_item_id: inventoryConditionItem.id,
        condition_operator: '>=',
        on_blocked: 'FALLBACK',
      }],
      fallback: { action_id: freeAction.id, mode: 'INFINITE' },
    })).resolves.toMatchObject({
      queue_version: 1,
      queue: {
        entries: [expect.objectContaining({ status: 'DONE_CONDITION_MET' })],
      },
    });
  });

  it('re-evaluates inventory conditions when the same plan is saved after stock changes', async () => {
    const { service, queueState, inventoryState, steps } = makeService(5n, false, foundationCharacter);

    const first = await service.save(request('until-ready'), foundationCharacter.characterId, {
      expected_queue_version: 0,
      entries: [{
        client_entry_id: 'tmp-until-recheck',
        action_id: freeAction.id,
        mode: 'UNTIL_INVENTORY',
        target_value: '5',
        condition_item_id: inventoryConditionItem.id,
        condition_operator: '>=',
        on_blocked: 'FALLBACK',
      }],
      fallback: { action_id: freeAction.id, mode: 'INFINITE' },
    });

    expect(first).toMatchObject({
      queue_version: 1,
      queue: {
        entries: [expect.objectContaining({ status: 'DONE_CONDITION_MET' })],
      },
    });
    expect(queueState.current?.entries[0]).toMatchObject({ status: 'DONE_CONDITION_MET' });

    inventoryState.quantity = 4n;
    steps.length = 0;

    const second = await service.save(request('until-recheck-again'), foundationCharacter.characterId, {
      expected_queue_version: 1,
      entries: [{
        client_entry_id: 'tmp-until-recheck',
        action_id: freeAction.id,
        mode: 'UNTIL_INVENTORY',
        target_value: '5',
        condition_item_id: inventoryConditionItem.id,
        condition_operator: '>=',
        on_blocked: 'FALLBACK',
      }],
      fallback: { action_id: freeAction.id, mode: 'INFINITE' },
    });

    expect(second).toMatchObject({
      queue_version: 2,
      queue: {
        entries: [expect.objectContaining({ status: 'QUEUED' })],
      },
    });
    expect(queueState.current?.entries[0]).toMatchObject({ status: 'QUEUED' });
    expect(steps).toContain('asset.getInventoryOnTransaction');
  });

  it('rejects inventory conditions on non-UNTIL_INVENTORY entries', async () => {
    const { service } = makeService(0n, false, foundationCharacter);

    await expect(service.save(request('invalid-condition'), foundationCharacter.characterId, {
      expected_queue_version: 0,
      entries: [{
        client_entry_id: 'tmp-condition-forbidden',
        action_id: freeAction.id,
        mode: 'INFINITE',
        condition_item_id: inventoryConditionItem.id,
        condition_operator: '>=',
        on_blocked: 'FALLBACK',
      }],
      fallback: { action_id: freeAction.id, mode: 'INFINITE' },
    })).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('rejects a write while settlement continuation is still in progress and does not duplicate retries', async () => {
    const blocked = makeService(0n, true);
    await expect(blocked.service.save(request('blocked-key'), character.characterId, materialPlan))
      .rejects.toMatchObject({
        response: { code: 'SETTLEMENT_CONTINUATION_IN_PROGRESS' },
      });
    expect(blocked.steps).toEqual(['settlement:QUEUE_SAVE']);
    expect(blocked.queueState.current).toBeNull();

    const replay = makeService(6n);
    const first = await replay.service.save(request('replay-key'), character.characterId, materialPlan);
    const second = await replay.service.save(request('replay-key'), character.characterId, materialPlan);
    expect(second).toEqual(first);
    expect(replay.queueState.current?.queueVersion).toBe(1n);
    expect(replay.steps.filter((step) => step === 'queue.replaceQueue')).toHaveLength(1);
    expect(replay.steps.filter((step) => step === 'settlement:QUEUE_SAVE')).toHaveLength(1);
    expect(replay.steps).toContain('replay:QUEUE_SAVE');
  });
});
