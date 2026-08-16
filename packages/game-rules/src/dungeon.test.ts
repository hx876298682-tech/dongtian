import { describe, expect, it } from 'vitest';

import type { CombatantInput } from './combat.js';
import {
  enterDungeonRun,
  finalizeDungeonRun,
  prepareDungeonRun,
  resolveDungeonTimeout,
  restoreDungeonRunState,
  submitDungeonChoice,
  type DungeonConfig,
} from './dungeon.js';

const configVersion = '2026.08.16.1';
const formulaVersion = 1;
const seedHex = '0123456789abcdef0123456789abcdef';

function combatant(overrides: Partial<CombatantInput>): CombatantInput {
  return {
    side: 'PLAYER',
    style: 'MELEE',
    staminaLevel: '10',
    intelligenceLevel: '4',
    attackLevel: '15',
    defenseLevel: '10',
    meleeLevel: '20',
    rangedLevel: '0',
    magicLevel: '0',
    equipmentHp: '50',
    baseAttackIntervalSeconds: '2',
    accuracyBonus: '0',
    damageBonus: '0',
    evasionBonus: '0',
    attackSpeedBonus: '0',
    critRateBonus: '0',
    critDamageBonus: '0.5',
    penetration: '0',
    ...overrides,
  };
}

function qingsheConfig(enemy: CombatantInput): DungeonConfig {
  return {
    id: 'dungeon.t1.qingshe_cave',
    realmRequired: 'realm.qi.early',
    opportunityCost: 1,
    entryItems: [],
    choiceTimeoutSeconds: 60,
    defaultSafeChoiceId: 'choice.t1.qingshe_cave.safe_exit',
    prepareNodeId: 'node.t1.qingshe_cave.prepare',
    entryNodeId: 'node.t1.qingshe_cave.entry',
    choiceNodeId: 'node.t1.qingshe_cave.choice',
    battleNodeId: 'node.t1.qingshe_cave.battle',
    rewardNodeId: 'node.t1.qingshe_cave.reward',
    nodes: [
      { id: 'node.t1.qingshe_cave.prepare', type: 'PREPARE', nextNodeId: 'node.t1.qingshe_cave.entry' },
      { id: 'node.t1.qingshe_cave.entry', type: 'ENTRY', nextNodeId: 'node.t1.qingshe_cave.choice' },
      { id: 'node.t1.qingshe_cave.choice', type: 'CHOICE', nextNodeId: 'node.t1.qingshe_cave.battle' },
      { id: 'node.t1.qingshe_cave.battle', type: 'BATTLE', nextNodeId: 'node.t1.qingshe_cave.reward' },
      { id: 'node.t1.qingshe_cave.reward', type: 'REWARD', nextNodeId: null },
    ],
    choices: [
      {
        id: 'choice.t1.qingshe_cave.safe_exit',
        routeId: 'route.t1.qingshe_cave.safe_exit',
        risk: 'SAFE',
        labelKey: 'dungeon.qingshe_cave.route.safe',
        battleEnemy: enemy,
        successRewardTableId: 'reward.t1.qingshe_cave.success',
        failureRewardTableId: 'reward.t1.qingshe_cave.failure',
        maxEvents: 64,
        maxRounds: 32,
      },
      {
        id: 'choice.t1.qingshe_cave.deep_den',
        routeId: 'route.t1.qingshe_cave.deep_den',
        risk: 'HIGH_RISK',
        labelKey: 'dungeon.qingshe_cave.route.risk',
        battleEnemy: enemy,
        successRewardTableId: 'reward.t1.qingshe_cave.success',
        failureRewardTableId: 'reward.t1.qingshe_cave.failure',
        maxEvents: 64,
        maxRounds: 32,
      },
    ],
    rewardTables: [
      {
        id: 'reward.t1.qingshe_cave.success',
        cultivationXp: '250',
        entries: [
          { itemId: 'item.t2.lingsui', minQuantity: '1', maxQuantity: '1', probability: '0.18', rolls: 1 },
          { itemId: 'item.t1.qingyu_pei', minQuantity: '1', maxQuantity: '1', probability: '0.05', rolls: 1 },
        ],
      },
      {
        id: 'reward.t1.qingshe_cave.failure',
        cultivationXp: '0',
        entries: [],
      },
    ],
    failureRewardTableId: 'reward.t1.qingshe_cave.failure',
    successModel: {
      baseSuccessRate: '0.9',
      recommendedPower: '80',
      powerElasticity: '0.5',
      minSuccessRate: '0.2',
      maxSuccessRate: '0.95',
    },
    scope: 'MVP',
  };
}

function enterFixture(enemy: CombatantInput, player: CombatantInput = combatant({ side: 'PLAYER' })) {
  const dungeon = qingsheConfig(enemy);
  const preview = prepareDungeonRun({
    dungeon,
    configVersion,
    formulaVersion,
    playerPower: '80',
  });
  const run = enterDungeonRun({
    runId: '0198dungeonrun000000000000000001',
    characterId: '0198character000000000000000001',
    dungeon,
    configVersion,
    formulaVersion,
    seedHex,
    startedAtUs: '0',
    loadoutSnapshot: {
      weapon: 'item.t1.cuizhi_jian',
      armor: 'item.t1.buyi',
      accessory: 'item.t1.qingyu_pei',
    },
    buffSnapshot: { active: [] },
    strategySnapshot: { mode: 'SAFE' },
    playerCombatSnapshot: player,
    preview,
  });
  return { dungeon, preview, run };
}

describe('dungeon rules', () => {
  it('previews the Qing She Cave with fixed config-driven values', () => {
    const preview = prepareDungeonRun({
      dungeon: qingsheConfig(combatant({
        side: 'ENEMY',
        staminaLevel: '10',
        intelligenceLevel: '0',
        attackLevel: '12',
        defenseLevel: '4',
        meleeLevel: '0',
        equipmentHp: '20',
        baseAttackIntervalSeconds: '2.5',
      })),
      configVersion,
      formulaVersion,
      playerPower: '80',
    });

    expect(preview.dungeonId).toBe('dungeon.t1.qingshe_cave');
    expect(preview.baseSuccessRate).toBe('0.9');
    expect(preview.estimatedSuccessRate).toBe('0.9');
    expect(preview.coreRewards).toEqual(['item.t2.lingsui', 'item.t1.qingyu_pei']);
    expect(preview.choices).toHaveLength(2);
  });

  it('enters, resolves combat, and keeps repeated same-choice retries stable', () => {
    const { run } = enterFixture(combatant({
      side: 'ENEMY',
      staminaLevel: '10',
      intelligenceLevel: '0',
      attackLevel: '12',
      defenseLevel: '4',
      meleeLevel: '0',
      equipmentHp: '20',
      baseAttackIntervalSeconds: '2.5',
    }), combatant({
      side: 'PLAYER',
      style: 'MELEE',
      staminaLevel: '18',
      intelligenceLevel: '6',
      attackLevel: '24',
      defenseLevel: '14',
      meleeLevel: '28',
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: '120',
      baseAttackIntervalSeconds: '2',
      accuracyBonus: '0.15',
      damageBonus: '0.1',
      evasionBonus: '0.05',
      attackSpeedBonus: '0.08',
      critRateBonus: '0.05',
      critDamageBonus: '0.5',
      penetration: '4',
    }));

    const choice = submitDungeonChoice({
      run,
      choiceId: 'choice.t1.qingshe_cave.safe_exit',
      expectedRunVersion: 0,
      chosenAtUs: '1000000',
    });

    expect(choice.phase).toBe('REWARD_CANDIDATE');
    expect(choice.outcome).toBe('SUCCESS');
    expect(choice.selectedRouteRisk).toBe('SAFE');
    expect(choice.combatResult?.terminationReason).toBe('ENEMY_DEFEATED');
    expect(choice.rewardCandidate?.cultivationXp).toBe('250');

    const repeated = submitDungeonChoice({
      run: choice,
      choiceId: 'choice.t1.qingshe_cave.safe_exit',
      expectedRunVersion: 0,
      chosenAtUs: '1000000',
    });

    expect(repeated).toBe(choice);
  });

  it('rejects illegal transitions and stale choices', () => {
    const { run } = enterFixture(combatant({
      side: 'ENEMY',
      staminaLevel: '10',
      intelligenceLevel: '0',
      attackLevel: '12',
      defenseLevel: '4',
      meleeLevel: '0',
      equipmentHp: '20',
      baseAttackIntervalSeconds: '2.5',
    }));

    expect(() => finalizeDungeonRun({ run, finalizedAtUs: '2000000' })).toThrow('DUNGEON_FINALIZE_INVALID_TRANSITION');

    const chosen = submitDungeonChoice({
      run,
      choiceId: 'choice.t1.qingshe_cave.safe_exit',
      expectedRunVersion: 0,
      chosenAtUs: '1000000',
    });

    expect(() => submitDungeonChoice({
      run: chosen,
      choiceId: 'choice.t1.qingshe_cave.deep_den',
      expectedRunVersion: 1,
      chosenAtUs: '1000001',
    })).toThrow('DUNGEON_CHOICE_LOCKED');
  });

  it('auto-selects the safe route after timeout', () => {
    const { run } = enterFixture(combatant({
      side: 'ENEMY',
      staminaLevel: '10',
      intelligenceLevel: '0',
      attackLevel: '12',
      defenseLevel: '4',
      meleeLevel: '0',
      equipmentHp: '20',
      baseAttackIntervalSeconds: '2.5',
    }));

    const timedOut = resolveDungeonTimeout({
      run,
      chosenAtUs: '61000000',
    });

    expect(timedOut.selectedChoiceId).toBe('choice.t1.qingshe_cave.safe_exit');
    expect(timedOut.selectedRouteRisk).toBe('SAFE');
    expect(timedOut.phase).toBe('REWARD_CANDIDATE');
  });

  it('restores a serialized run and finalizes it without re-running combat', () => {
    const { run } = enterFixture(combatant({
      side: 'ENEMY',
      staminaLevel: '10',
      intelligenceLevel: '0',
      attackLevel: '12',
      defenseLevel: '4',
      meleeLevel: '0',
      equipmentHp: '20',
      baseAttackIntervalSeconds: '2.5',
    }));
    const chosen = submitDungeonChoice({
      run,
      choiceId: 'choice.t1.qingshe_cave.safe_exit',
      expectedRunVersion: 0,
      chosenAtUs: '1000000',
    });

    const restored = restoreDungeonRunState(JSON.parse(JSON.stringify(chosen)) as typeof chosen);
    const finalized = finalizeDungeonRun({
      run: restored,
      finalizedAtUs: '2000000',
    });

    expect(finalized.phase).toBe('FINALIZED');
    expect(finalized.finalization?.reward.choiceId).toBe('choice.t1.qingshe_cave.safe_exit');
    expect(finalized.finalization?.reward.combat.terminationReason).toBe('ENEMY_DEFEATED');
    expect(finalized.events.at(-1)?.eventType).toBe('FINALIZED');
  });

  it('covers success, failure, and double-KO combat outcomes', () => {
    const successRun = enterFixture(combatant({
      side: 'ENEMY',
      style: 'MELEE',
      staminaLevel: '0',
      intelligenceLevel: '0',
      attackLevel: '0',
      defenseLevel: '0',
      meleeLevel: '0',
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: '0',
      maxHpOverride: '30',
      damageOverride: '1',
      accuracyOverride: '100',
      evasionOverride: '0',
      baseAttackIntervalSeconds: '1',
    }), combatant({
      side: 'PLAYER',
      style: 'MELEE',
      staminaLevel: '0',
      intelligenceLevel: '0',
      attackLevel: '0',
      defenseLevel: '0',
      meleeLevel: '0',
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: '0',
      maxHpOverride: '30',
      damageOverride: '40',
      accuracyOverride: '100',
      evasionOverride: '0',
      baseAttackIntervalSeconds: '1',
    }));
    const success = submitDungeonChoice({
      run: successRun.run,
      choiceId: 'choice.t1.qingshe_cave.safe_exit',
      expectedRunVersion: 0,
      chosenAtUs: '1000000',
    });
    expect(success.outcome).toBe('SUCCESS');

    const failureRun = enterFixture(combatant({
      side: 'ENEMY',
      style: 'MELEE',
      staminaLevel: '0',
      intelligenceLevel: '0',
      attackLevel: '0',
      defenseLevel: '0',
      meleeLevel: '0',
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: '0',
      maxHpOverride: '30',
      damageOverride: '40',
      accuracyOverride: '100',
      evasionOverride: '0',
      baseAttackIntervalSeconds: '1',
    }), combatant({
      side: 'PLAYER',
      style: 'MELEE',
      staminaLevel: '0',
      intelligenceLevel: '0',
      attackLevel: '0',
      defenseLevel: '0',
      meleeLevel: '0',
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: '0',
      maxHpOverride: '30',
      damageOverride: '1',
      accuracyOverride: '100',
      evasionOverride: '0',
      baseAttackIntervalSeconds: '1',
    }));
    const failure = submitDungeonChoice({
      run: failureRun.run,
      choiceId: 'choice.t1.qingshe_cave.safe_exit',
      expectedRunVersion: 0,
      chosenAtUs: '1000000',
    });
    expect(failure.outcome).toBe('FAILURE');
    expect(failure.rewardCandidate?.cultivationXp).toBe('0');

    const doubleKoRun = enterFixture(combatant({
      side: 'ENEMY',
      style: 'MELEE',
      staminaLevel: '0',
      intelligenceLevel: '0',
      attackLevel: '0',
      defenseLevel: '0',
      meleeLevel: '0',
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: '0',
      maxHpOverride: '30',
      damageOverride: '40',
      accuracyOverride: '100',
      evasionOverride: '0',
      baseAttackIntervalSeconds: '1',
    }), combatant({
      side: 'PLAYER',
      style: 'MELEE',
      staminaLevel: '0',
      intelligenceLevel: '0',
      attackLevel: '0',
      defenseLevel: '0',
      meleeLevel: '0',
      rangedLevel: '0',
      magicLevel: '0',
      equipmentHp: '0',
      maxHpOverride: '30',
      damageOverride: '40',
      accuracyOverride: '100',
      evasionOverride: '0',
      baseAttackIntervalSeconds: '1',
    }));
    const doubleKo = submitDungeonChoice({
      run: doubleKoRun.run,
      choiceId: 'choice.t1.qingshe_cave.safe_exit',
      expectedRunVersion: 0,
      chosenAtUs: '1000000',
    });
    expect(doubleKo.outcome).toBe('DOUBLE_KO');
    expect(doubleKo.combatResult?.terminationReason).toBe('DOUBLE_KO');
  });
});
