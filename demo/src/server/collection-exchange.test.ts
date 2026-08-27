import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, CONFIG_VERSION } from './types.ts';
import { MemoryRepository } from './repository.ts';
import { GameService } from './service.ts';

const base = new Date('2026-01-01T00:00:00.000Z');
const at = (seconds: number) => new Date(base.getTime() + seconds * 1000);

test('collection exchange spends only the selected starter pool and grants one star', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(1));
  await service.createPlayer('exchange-player', base);
  await repository.transaction('exchange-player', 0, { eventType: 'seed_exchange', payload: {}, at: base }, (draft) => {
    draft.collection.collectionMarks = 10;
    draft.collectionMarkBalances = { starter: 10, nascent_soul: 50 };
  });
  const result = await service.collectionExchange({ playerId: 'exchange-player', poolId: 'starter', targetTreasureId: 'qing_lian_lamp', expectedRevision: 1, idempotencyKey: 'exchange-1', now: at(2), configVersion: CONFIG_VERSION });
  assert.equal(result.data.marksSpent, 10);
  assert.equal(result.data.marksRemaining, 0);
  assert.equal(result.data.toStars, 1);
  const state = await repository.getPlayer('exchange-player');
  assert.deepEqual(state.collectionMarkBalances, { starter: 0, nascent_soul: 50 });
  assert.equal(state.collection.collectionMarks, 0);
  assert.equal(state.collection.treasureStars.qing_lian_lamp, 1);
});

test('collection exchange rejects nonzero target, locked pool, and full pool without mutation', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  await service.createPlayer('exchange-errors', base);
  await repository.transaction('exchange-errors', 0, { eventType: 'seed_exchange', payload: {}, at: base }, (draft) => {
    draft.realmId = 'qi_refining';
    draft.collectionMarkBalances = { starter: 20 };
    draft.collection.collectionMarks = 20;
    draft.collection.treasureStars.qing_lian_lamp = 1;
  });
  await assert.rejects(() => service.collectionExchange({ playerId: 'exchange-errors', poolId: 'starter', targetTreasureId: 'qing_lian_lamp', expectedRevision: 1, idempotencyKey: 'nonzero', now: at(1) }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  const before = await repository.getPlayer('exchange-errors');
  await assert.rejects(() => service.collectionExchange({ playerId: 'exchange-errors', poolId: 'nascent_soul', targetTreasureId: 'missing', expectedRevision: 1, idempotencyKey: 'locked', now: at(1) }), (error: unknown) => error instanceof ApiError && (error.code === 'VALIDATION_FAILED' || error.code === 'COLLECTION_POOL_LOCKED'));
  assert.deepEqual(await repository.getPlayer('exchange-errors'), before);
  await repository.transaction('exchange-errors', 1, { eventType: 'fill_pool', payload: {}, at: at(2) }, (draft) => { for (const id of ['qing_lian_lamp', 'shan_he_seal', 'heaven_bag', 'zhu_que_feather', 'xuan_gui_shell', 'tai_xu_mirror']) draft.collection.treasureStars[id] = 10; });
  await assert.rejects(() => service.collectionExchange({ playerId: 'exchange-errors', poolId: 'starter', targetTreasureId: 'shan_he_seal', expectedRevision: 2, idempotencyKey: 'full', now: at(3) }), (error: unknown) => error instanceof ApiError && error.code === 'COLLECTION_POOL_COMPLETE');
  assert.equal((await repository.getPlayer('exchange-errors')).stateRevision, 2);
});

test('collection exchange replays the first response and rejects a different canonical command', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  await service.createPlayer('exchange-replay', base);
  await repository.transaction('exchange-replay', 0, { eventType: 'seed_exchange', payload: {}, at: base }, (draft) => { draft.collection.collectionMarks = 20; draft.collectionMarkBalances = { starter: 20 }; });
  const request = { playerId: 'exchange-replay', poolId: 'starter' as const, targetTreasureId: 'qing_lian_lamp', expectedRevision: 1, idempotencyKey: 'same-key', now: at(1) };
  const first = await service.collectionExchange(request);
  const replay = await service.collectionExchange({ ...request, now: at(99) });
  assert.deepEqual(replay, first);
  await assert.rejects(() => service.collectionExchange({ ...request, targetTreasureId: 'shan_he_seal' }), (error: unknown) => error instanceof ApiError && (error.code === 'DUPLICATE_REQUEST' || error.code === 'STALE_REVISION'));
  assert.equal((await repository.getPlayer('exchange-replay')).collectionMarkBalances?.starter, 10);
});
