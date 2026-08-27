import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from './types.ts';
import { MemoryRepository } from './repository.ts';
import { GameService } from './service.ts';

const base = new Date('2026-01-01T00:00:00.000Z');
const at = (seconds: number) => new Date(base.getTime() + seconds * 1000);
const enableFormalParameter = (service: GameService) => {
  const internal = service as unknown as { parameters: Record<string, { value: unknown; status?: string }> };
  internal.parameters['schedule.equipment.auto_promotion.enabled'] = { value: 1, status: 'frozen_v1' };
};

test('auto-promotion remains fail-closed while formal enable parameter is absent', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  await service.createPlayer('promotion-locked', base);
  await assert.rejects(() => service.setAutoPromotionPolicy({ playerId: 'promotion-locked', enabled: true, targetInstanceIds: [], expectedRevision: 0, idempotencyKey: 'policy-locked' }), (error: unknown) => error instanceof ApiError && error.code === 'CONTENT_LOCKED');
});

test('auto-promotion commits an all-or-nothing explicit target batch and replays the cycle', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  enableFormalParameter(service);
  await service.createPlayer('promotion-player', base);
  await repository.transaction('promotion-player', 0, { eventType: 'seed_promotion', payload: {}, at: base }, (draft) => {
    draft.equipmentInstances.target = { ...draft.equipmentInstances['equipment.iron_saber.initial']!, instanceId: 'target', templateId: 'iron_saber', quality: 'normal', isEquipped: false, lockedSlots: [], createdAt: at(1).toISOString() };
    draft.equipmentInstances.duplicate = { ...draft.equipmentInstances['equipment.iron_saber.initial']!, instanceId: 'duplicate', templateId: 'iron_saber', quality: 'normal', isEquipped: false, lockedSlots: [], createdAt: at(2).toISOString() };
    draft.equipmentCount = 3;
    draft.resources.spirit_stone.amount = 1000;
    draft.resources.millennium_herb.amount = 10;
    draft.resources.meteor_iron.amount = 20;
  });
  const policy = await service.setAutoPromotionPolicy({ playerId: 'promotion-player', enabled: true, targetInstanceIds: ['target'], resourceReserve: { spirit_stone: 100, millennium_herb: 1, meteor_iron: 1 }, expectedRevision: 1, idempotencyKey: 'policy', now: at(3) });
  const first = await service.autoPromotionCycle({ playerId: 'promotion-player', expectedRevision: policy.stateRevision, cycleId: '1', idempotencyKey: 'cycle', now: at(4) });
  assert.equal(first.data.status, 'committed');
  assert.equal(first.data.operations.length, 1);
  assert.equal(first.data.operations[0]?.toQuality, 'fine');
  assert.equal((await repository.getPlayer('promotion-player')).equipmentInstances.target?.quality, 'fine');
  assert.equal((await repository.getPlayer('promotion-player')).equipmentInstances.duplicate, undefined);
  const replay = await service.autoPromotionCycle({ playerId: 'promotion-player', expectedRevision: first.stateRevision, cycleId: '1', idempotencyKey: 'cycle', now: at(99) });
  assert.deepEqual(replay, first);
});
