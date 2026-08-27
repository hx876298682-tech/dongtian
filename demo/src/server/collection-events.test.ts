import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHttpServer } from './http.ts';
import { MemoryRepository, hashPayload } from './repository.ts';
import { GameService } from './service.ts';
import type { CollectionEvent } from './types.ts';

const base = new Date('2026-01-01T00:00:00.000Z');
const at = (seconds: number): Date => new Date(base.getTime() + seconds * 1000);

test('collection mutations emit durable before/after events and idempotent replay emits once', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(10));
  const playerId = 'collection-events-player';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'collection_seed', payload: { source: 'test' }, at: base }, (draft) => {
    draft.collection.collectionMarks = 1;
    draft.collection.duplicateBalances.qing_lian_lamp = 1;
  });
  const first = await service.collectionAction({ playerId, action: 'treasure_upgrade', treasureId: 'qing_lian_lamp', expectedRevision: 1, now: at(1), idempotencyKey: 'upgrade-once' });
  const repeated = await service.collectionAction({ playerId, action: 'treasure_upgrade', treasureId: 'qing_lian_lamp', expectedRevision: 999, now: at(2), idempotencyKey: 'upgrade-once' });
  assert.deepEqual(repeated, first);

  const events = await repository.listCollectionEvents(playerId, 10);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => [event.beforeRevision, event.afterRevision]), [[1, 2], [0, 1]]);
  const upgrade = events[0] as CollectionEvent;
  assert.equal(upgrade.eventType, 'collection_treasure_upgrade');
  assert.equal(upgrade.payloadHash, hashPayload(upgrade.payload));
  assert.deepEqual((upgrade.payload as { before: unknown; after: unknown }).after, first.data.collectionState);
  assert.equal((await repository.listCollectionEvents(playerId, 10)).length, 2, 'idempotent action must not append a second collection event');
});

test('collection event pagination is deterministic and player-scoped', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  await service.createPlayer('collection-page-a', base);
  await service.createPlayer('collection-page-b', base);
  for (let index = 0; index < 3; index += 1) {
    await repository.transaction('collection-page-a', index, { eventType: `collection_test_${index}`, payload: { index }, at: at(1) }, (draft) => { draft.collection.collectionMarks = index + 1; });
  }
  await repository.transaction('collection-page-b', 0, { eventType: 'collection_test_other', payload: {}, at: at(1) }, (draft) => { draft.collection.collectionMarks = 99; });
  const first = await service.collectionEvents({ playerId: 'collection-page-a', limit: 2, now: at(5) });
  assert.equal(first.data.events.length, 2);
  assert.ok(first.data.nextBefore);
  const second = await service.collectionEvents({ playerId: 'collection-page-a', limit: 2, before: first.data.nextBefore!, now: at(5) });
  assert.equal(second.data.events.length, 1);
  const allEvents = await repository.listCollectionEvents('collection-page-a', 10);
  const pagedEvents = [...first.data.events, ...second.data.events];
  assert.equal(new Set(pagedEvents.map((event) => event.eventId)).size, 3);
  assert.deepEqual(pagedEvents.map((event) => event.eventId), allEvents.map((event) => event.eventId));
  const other = await service.collectionEvents({ playerId: 'collection-page-b', limit: 10, now: at(5) });
  assert.equal(other.data.events.length, 1);
  await assert.rejects(() => service.collectionEvents({ playerId: 'collection-page-a', limit: 0, now: at(5) }), { code: 'VALIDATION_FAILED' });
});

test('HTTP collection event endpoint returns immutable snapshots and rejects invalid cursors', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  const playerId = 'collection-http-player';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'collection_http_seed', payload: {}, at: base }, (draft) => { draft.collection.collectionMarks = 4; });
  const server = createGameHttpServer(service, { authProvider: { backend: 'insecure', authenticate: async (token) => ({ subject: token, roles: [] }) } });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  try {
    const url = `http://127.0.0.1:${address.port}/v1/collection/events?limit=1`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${playerId}` } });
    assert.equal(response.status, 200);
    const payload = await response.json() as { data: { events: CollectionEvent[]; nextBefore: string | null } };
    assert.equal(payload.data.events.length, 1);
    assert.equal(payload.data.events[0]?.payloadHash, hashPayload(payload.data.events[0]?.payload));
    assert.ok(payload.data.nextBefore);
    const invalid = await fetch(`${url}&before=not-a-date`, { headers: { authorization: `Bearer ${playerId}` } });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { error: { code: string } }).error.code, 'VALIDATION_FAILED');
    const unauthorizedPlayer = await fetch(url, { headers: { authorization: 'Bearer collection-http-other' } });
    assert.equal(unauthorizedPlayer.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
