import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from './types.ts';
import { GameService } from './service.ts';
import { MemoryRepository } from './repository.ts';

const base = new Date('2026-08-26T00:00:00.000Z');
const at = (seconds: number): Date => new Date(base.getTime() + seconds * 1000);

test('global_single_slot_v1 switches training to alchemy and deposits output directly', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(60));
  await service.createPlayer('single-slot-alchemy', base);
  const started = await service.startAction({ playerId: 'single-slot-alchemy', actionId: 'training', expectedRevision: 0, now: base, idempotencyKey: 'training' });
  const switched = await service.startAction({ playerId: 'single-slot-alchemy', actionId: 'alchemy_basic', expectedRevision: started.stateRevision, now: at(60), idempotencyKey: 'alchemy' });
  assert.equal(switched.data.actionId, 'alchemy_basic');
  assert.equal((await repository.getPlayer('single-slot-alchemy')).primaryAction.modelVersion, 'global_single_slot_v1');
  const settled = await service.offlineSettlement({ playerId: 'single-slot-alchemy', settlementId: 'alchemy-settlement', requestedStartedAt: at(60).toISOString(), requestedEndedAt: at(120).toISOString(), expectedRevision: switched.stateRevision, now: at(120) });
  assert.equal(settled.data.productionDelta?.pill, 2);
  const after = await repository.getPlayer('single-slot-alchemy');
  assert.equal(after.cultivationXp, 70, 'switch must settle one training batch before starting alchemy');
  assert.equal(after.resources.pill.amount, 8);
  assert.equal(after.resources.spirit_herb.amount, 124, 'sequence production consumes inputs directly');
  assert.equal(after.resources.spirit_stone.amount, 5618, 'sequence production consumes inputs directly');
  assert.equal(after.buildings.alchemy_room.queuedJobIds.length, 0, 'sequence production must not create a legacy queue job');
});

test('selectable production actions persist their target and forge writes a canonical equipment instance', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(60));
  const playerId = 'selectable-production-target';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'seed_forge_materials', payload: {}, at: base }, (draft) => {
    draft.resources.spirit_wood.amount = 2;
  });
  const templateId = 'equip.bai_cao_valley.weapon.normal.001';
  const started = await service.startAction({ playerId, actionId: 'forge', recipeId: 'forge_basic', equipmentTemplateId: templateId, expectedRevision: 1, now: base, idempotencyKey: 'forge-selected' });
  const active = await repository.getPlayer(playerId);
  assert.equal(active.primaryAction.actionId, 'forge');
  assert.equal(active.primaryAction.targetId, `forge_basic:${templateId}`);
  const settled = await service.offlineSettlement({ playerId, settlementId: 'forge-selected-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: started.stateRevision, now: at(60) });
  assert.equal(settled.data.productionDelta?.equipment, 1);
  const after = await repository.getPlayer(playerId);
  assert.equal(after.equipmentCount, 2);
  const instance = Object.values(after.equipmentInstances).find((candidate) => candidate.templateId === templateId);
  assert.equal(instance?.templateId, templateId);
  assert.equal(instance?.slot, 'weapon');
  assert.equal(after.resources.spirit_ore.amount, 42);
  assert.equal(after.resources.spirit_wood.amount, 0);
});

test('selectable forge fails closed for an unknown equipment template', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  const playerId = 'selectable-production-unknown-template';
  await service.createPlayer(playerId, base);
  await assert.rejects(() => service.startAction({ playerId, actionId: 'forge', recipeId: 'forge_basic', equipmentTemplateId: 'equipment.unknown', expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'CONTENT_LOCKED');
});

test('switching between production sequences settles the old recipe exactly once', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(120));
  const playerId = 'single-slot-production-switch';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_seed_forge_inputs', payload: {}, at: base }, (draft) => {
    draft.resources.spirit_wood.amount = 4;
  });
  const alchemy = await service.startAction({ playerId, actionId: 'alchemy_basic', expectedRevision: 1, now: base, idempotencyKey: 'alchemy-start' });
  const forge = await service.startAction({ playerId, actionId: 'forge_basic', expectedRevision: alchemy.stateRevision, now: at(60), idempotencyKey: 'forge-start' });
  const afterSwitch = await repository.getPlayer(playerId);
  assert.equal(afterSwitch.primaryAction.actionId, 'forge_basic');
  assert.equal(afterSwitch.resources.pill.amount, 8, 'the old alchemy sequence produced two batches before switching');
  assert.equal(afterSwitch.resources.spirit_herb.amount, 124);
  assert.equal(afterSwitch.resources.spirit_stone.amount, 5618);
  const forgeSettlement = await service.offlineSettlement({ playerId, settlementId: 'forge-settlement', requestedStartedAt: at(60).toISOString(), requestedEndedAt: at(120).toISOString(), expectedRevision: forge.stateRevision, now: at(120) });
  assert.equal(forgeSettlement.data.productionDelta?.equipment, 1);
  assert.equal((await repository.getPlayer(playerId)).equipmentCount, 2);
});

test('single-slot production shortage never partially charges a batch and remains replayable', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(60));
  const playerId = 'single-slot-production-shortage';
  await service.createPlayer(playerId, base);
  await repository.transaction(playerId, 0, { eventType: 'test_seed_exact_alchemy_inputs', payload: {}, at: base }, (draft) => {
    draft.resources.spirit_herb.amount = 2;
    draft.resources.spirit_stone.amount = 1;
  });
  const started = await service.startAction({ playerId, actionId: 'alchemy_basic', expectedRevision: 1, now: base });
  const before = await repository.getPlayer(playerId);
  const settled = await service.offlineSettlement({ playerId, settlementId: 'alchemy-shortage', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: started.stateRevision, now: at(60) });
  assert.equal(settled.data.productionDelta?.pill, 1);
  const after = await repository.getPlayer(playerId);
  assert.equal(after.resources.spirit_herb.amount, 0);
  assert.equal(after.resources.spirit_stone.amount, 0);
  assert.equal(after.resources.pill.amount, before.resources.pill.amount + 1);
  assert.ok(Object.values(after.resources).every((resource) => resource.amount >= 0 && resource.reservedAmount >= 0));
  const replay = await service.offlineSettlement({ playerId, settlementId: 'alchemy-shortage', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 999, now: at(61) });
  assert.deepEqual(replay, settled, 'settlement idempotency must replay the first response without a second batch');
});

test('starting an already active sequence is idempotent and stale revisions are rejected', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  const playerId = 'single-slot-action-cas';
  await service.createPlayer(playerId, base);
  const first = await service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: base, idempotencyKey: 'same-start' });
  const replay = await service.startAction({ playerId, actionId: 'training', expectedRevision: 999, now: at(1), idempotencyKey: 'same-start' });
  assert.deepEqual(replay, first);
  await assert.rejects(() => service.startAction({ playerId, actionId: 'forge_basic', expectedRevision: 0, now: at(1), idempotencyKey: 'stale-start' }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'STALE_REVISION');
  assert.equal((await repository.getPlayer(playerId)).primaryAction.actionId, 'training');
});

test('legacy building queue is rejected while a global sequence owns the slot', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  await service.createPlayer('single-slot-queue', base);
  await service.startAction({ playerId: 'single-slot-queue', actionId: 'training', expectedRevision: 0, now: base });
  await assert.rejects(() => service.queueBuildingJob({ playerId: 'single-slot-queue', buildingId: 'alchemy_room', recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 1, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('spirit farm remains outside the action slot and matures during an active sequence', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(7200));
  await service.createPlayer('single-slot-farm', base);
  const started = await service.startAction({ playerId: 'single-slot-farm', actionId: 'training', expectedRevision: 0, now: base });
  const settled = await service.offlineSettlement({ playerId: 'single-slot-farm', settlementId: 'farm-maturity', requestedStartedAt: base.toISOString(), requestedEndedAt: at(7200).toISOString(), expectedRevision: started.stateRevision, now: at(7200) });
  assert.equal(settled.data.productionDelta?.spirit_herb, 480);
  assert.equal((await repository.getPlayer('single-slot-farm')).primaryAction.actionId, 'training');
});

test('explicit spirit farm planting persists outside the action slot and harvests once at maturity', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(7200));
  const playerId = 'single-slot-explicit-farm';
  await service.createPlayer(playerId, base);
  const started = await service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: base });
  const planted = await service.plantSpiritFarm({ playerId, plots: 2, expectedRevision: started.stateRevision, now: base, idempotencyKey: 'plant-1' });
  assert.equal(planted.data.buildingId, 'spirit_farm');
  assert.equal(planted.data.plots, 2);
  assert.equal(planted.data.matureAt, at(7200).toISOString());
  const plantedState = await repository.getPlayer(playerId);
  assert.equal(plantedState.primaryAction.actionId, 'training');
  assert.equal(plantedState.buildings.spirit_farm.plantedPlots, 2);
  const settled = await service.offlineSettlement({ playerId, settlementId: 'explicit-farm-maturity', requestedStartedAt: base.toISOString(), requestedEndedAt: at(7200).toISOString(), expectedRevision: planted.stateRevision, now: at(7200) });
  assert.equal(settled.data.productionDelta?.spirit_herb, 240);
  const harvested = await repository.getPlayer(playerId);
  assert.equal(harvested.resources.spirit_herb.amount, 368);
  assert.equal(harvested.buildings.spirit_farm.plantedPlots, 0);
  assert.equal(harvested.buildings.spirit_farm.matureAt, null);
  assert.equal(harvested.primaryAction.actionId, 'training');
  const replay = await service.plantSpiritFarm({ playerId, plots: 2, expectedRevision: 999, now: at(7201), idempotencyKey: 'plant-1' });
  assert.deepEqual(replay, planted);
});

test('explicit spirit farm planting rejects overlapping crops without guessing seed costs', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(1));
  const playerId = 'single-slot-farm-overlap';
  await service.createPlayer(playerId, base);
  const planted = await service.plantSpiritFarm({ playerId, plots: 1, expectedRevision: 0, now: base });
  const before = await repository.getPlayer(playerId);
  await assert.rejects(() => service.plantSpiritFarm({ playerId, plots: 1, expectedRevision: planted.stateRevision, now: at(1) }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  assert.deepEqual(await repository.getPlayer(playerId), before);
});

test('spirit farm plot planting allows independent plots and harvests each mature crop once', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(7200));
  const playerId = 'single-slot-farm-plots';
  await service.createPlayer(playerId, base);
  const first = await service.plantSpiritFarmPlot({ playerId, plotId: 'plot_1', plantId: 'spirit_lotus', expectedRevision: 0, now: base, idempotencyKey: 'plot-1' });
  const second = await service.plantSpiritFarmPlot({ playerId, plotId: 'plot_2', plantId: 'moon_grass', expectedRevision: first.stateRevision, now: base, idempotencyKey: 'plot-2' });
  assert.equal(first.data.plotId, 'plot_1');
  assert.equal(second.data.plotId, 'plot_2');
  assert.equal((await repository.getPlayer(playerId)).buildings.spirit_farm.spiritFarmPlots?.plot_1?.plantId, 'spirit_lotus');
  const settled = await service.offlineSettlement({ playerId, settlementId: 'explicit-farm-plots-maturity', requestedStartedAt: base.toISOString(), requestedEndedAt: at(7200).toISOString(), expectedRevision: second.stateRevision, now: at(7200) });
  assert.equal(settled.data.productionDelta?.spirit_herb, 240);
  assert.deepEqual((await repository.getPlayer(playerId)).buildings.spirit_farm.spiritFarmPlots, {});
  assert.deepEqual(await service.plantSpiritFarmPlot({ playerId, plotId: 'plot_1', plantId: 'spirit_lotus', expectedRevision: 999, now: at(7201), idempotencyKey: 'plot-1' }), first);
});

test('spirit farm plot planting rejects duplicate plots and invalid plot identifiers', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => base);
  const playerId = 'single-slot-farm-plot-validation';
  await service.createPlayer(playerId, base);
  const planted = await service.plantSpiritFarmPlot({ playerId, plotId: 'plot_1', plantId: 'spirit_lotus', expectedRevision: 0, now: base });
  await assert.rejects(() => service.plantSpiritFarmPlot({ playerId, plotId: 'plot_1', plantId: 'moon_grass', expectedRevision: planted.stateRevision, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  await assert.rejects(() => service.plantSpiritFarmPlot({ playerId, plotId: 'plot_99', plantId: 'moon_grass', expectedRevision: planted.stateRevision, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});

test('forge sequence consumes materials and writes equipment without a claim step', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(60));
  await service.createPlayer('single-slot-forge', base);
  await repository.transaction('single-slot-forge', 0, { eventType: 'seed_forge_materials', payload: {}, at: base }, (draft) => {
    draft.resources.spirit_wood.amount = 4;
    draft.resources.spirit_ore.amount = 8;
  });
  const started = await service.startAction({ playerId: 'single-slot-forge', actionId: 'forge_basic', expectedRevision: 1, now: base });
  const settled = await service.offlineSettlement({ playerId: 'single-slot-forge', settlementId: 'forge-sequence-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: started.stateRevision, now: at(60) });
  assert.equal(settled.data.productionDelta?.equipment, 1);
  assert.equal((await repository.getPlayer('single-slot-forge')).equipmentCount, 2);
});

test('global slot disables passive technique research while active or idle', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(60));
  const playerId = 'single-slot-technique-passive';
  await service.createPlayer(playerId, base);
  const started = await service.startAction({ playerId, actionId: 'training', expectedRevision: 0, now: base });
  const before = await repository.getPlayer(playerId);
  const activeSettlement = await service.offlineSettlement({ playerId, settlementId: 'technique-passive-active', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: started.stateRevision, now: at(60) });
  const active = await repository.getPlayer(playerId);
  assert.equal(active.collection.techniqueResearchXp, before.collection.techniqueResearchXp);
  await service.stopAction({ playerId, settlementId: 'technique-passive-stop', requestedStartedAt: at(60).toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: activeSettlement.stateRevision, now: at(60) });
  const idleBefore = await repository.getPlayer(playerId);
  await service.offlineSettlement({ playerId, settlementId: 'technique-passive-idle', requestedStartedAt: at(60).toISOString(), requestedEndedAt: at(120).toISOString(), expectedRevision: idleBefore.stateRevision, now: at(120) });
  assert.equal((await repository.getPlayer(playerId)).collection.techniqueResearchXp, idleBefore.collection.techniqueResearchXp);
});

test('global slot rejects legacy queue creation and does not settle seeded legacy queues', async () => {
  const repository = new MemoryRepository();
  const service = new GameService(repository, () => at(60));
  const playerId = 'single-slot-legacy-queue-idle';
  await service.createPlayer(playerId, base);
  await assert.rejects(() => service.queueBuildingJob({ playerId, buildingId: 'alchemy_room', recipeId: 'alchemy_basic', quantity: 1, expectedRevision: 0, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  await repository.transaction(playerId, 0, { eventType: 'legacy_queue_fixture', payload: {}, at: base }, (draft) => {
    draft.buildingJobs['legacy-queue'] = { jobId: 'legacy-queue', buildingId: 'alchemy_room', recipeId: 'alchemy_basic', remainingQuantity: 1, queuedAt: base.toISOString() };
    draft.buildings.alchemy_room.queuedJobIds = ['legacy-queue'];
    draft.buildings.alchemy_room.activeJobId = 'legacy-queue';
  });
  const settled = await service.offlineSettlement({ playerId, settlementId: 'legacy-queue-idle-settlement', requestedStartedAt: base.toISOString(), requestedEndedAt: at(60).toISOString(), expectedRevision: 1, now: at(60) });
  assert.equal(settled.data.productionDelta?.pill, undefined);
  assert.equal((await repository.getPlayer(playerId)).buildingJobs['legacy-queue']?.remainingQuantity, 1);
});

test('dungeon and high-tier attempts share the global slot with action sequences', async () => {
  const active = new MemoryRepository();
  const service = new GameService(active, () => base);
  await service.createPlayer('single-slot-dungeon-gate', base);
  const training = await service.startAction({ playerId: 'single-slot-dungeon-gate', actionId: 'training', expectedRevision: 0, now: base });
  await assert.rejects(() => service.startDungeon({ playerId: 'single-slot-dungeon-gate', dungeonId: 'qing_feng', expectedRevision: training.stateRevision, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');

  const dungeonRepository = new MemoryRepository();
  const dungeonService = new GameService(dungeonRepository, () => base);
  await dungeonService.createPlayer('single-slot-dungeon-owner', base);
  const dungeon = await dungeonService.startDungeon({ playerId: 'single-slot-dungeon-owner', dungeonId: 'qing_feng', expectedRevision: 0, now: base });
  await assert.rejects(() => dungeonService.startAction({ playerId: 'single-slot-dungeon-owner', actionId: 'training', expectedRevision: dungeon.stateRevision, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');

  const highTierRepository = new MemoryRepository();
  const highTierService = new GameService(highTierRepository, () => base);
  await highTierService.createPlayer('single-slot-high-tier-owner', base);
  await highTierRepository.transaction('single-slot-high-tier-owner', 0, { eventType: 'seed_high_tier_gate', payload: {}, at: base }, (draft) => {
    draft.realmId = 'nascent_soul';
    draft.collection.collectionMarks = 10;
    draft.resources.pill.amount = 100;
  });
  const highTier = await highTierService.startHighTier({ playerId: 'single-slot-high-tier-owner', realm: 'nascent_soul', expectedRevision: 1, now: base });
  await assert.rejects(() => highTierService.startAction({ playerId: 'single-slot-high-tier-owner', actionId: 'training', expectedRevision: highTier.stateRevision, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
  await assert.rejects(() => highTierService.startDungeon({ playerId: 'single-slot-high-tier-owner', dungeonId: 'qing_feng', expectedRevision: highTier.stateRevision, now: base }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
});
