import { describe, expect, it } from 'vitest';

import {
  resolveCombatLevel,
  resolveDamageTakenMultiplier,
  resolveHitChance,
  simulateCombatEncounter,
  type CombatantInput,
} from './combat.js';

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

describe('combat rules', () => {
  it('derives core combat formulas at documented boundaries', () => {
    expect(resolveHitChance('0', '0')).toBe('0.5');
    expect(resolveHitChance('12', '0')).toBe('1');
    expect(Number(resolveHitChance('20', '10'))).toBeGreaterThan(Number(resolveHitChance('10', '10')));

    expect(resolveDamageTakenMultiplier('0', '0')).toBe('1');
    expect(resolveDamageTakenMultiplier('20', '0')).toBe('0.833333');
    expect(Number(resolveDamageTakenMultiplier('10', '0'))).toBeGreaterThan(Number(resolveDamageTakenMultiplier('20', '0')));

    expect(resolveCombatLevel(combatant({}))).toBe('15.9');
  });

  it('is deterministic for the same seed and same input', () => {
    const input = {
      seedHex,
      maxEvents: 64,
      maxRounds: 32,
      player: combatant({
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
      }),
      enemy: combatant({
        side: 'ENEMY',
        style: 'MELEE',
        staminaLevel: '14',
        intelligenceLevel: '2',
        attackLevel: '18',
        defenseLevel: '12',
        meleeLevel: '20',
        rangedLevel: '0',
        magicLevel: '0',
        equipmentHp: '80',
        baseAttackIntervalSeconds: '2.5',
        damageBonus: '0.05',
        penetration: '2',
      }),
    } satisfies Parameters<typeof simulateCombatEncounter>[0];

    const first = simulateCombatEncounter(input);
    const second = simulateCombatEncounter(input);

    expect(second).toEqual(first);
    expect(first.events.length).toBeGreaterThan(0);
  });

  it('supports simultaneous death resolution on the same tick', () => {
    const result = simulateCombatEncounter({
      seedHex,
      maxEvents: 16,
      maxRounds: 8,
      player: combatant({
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
      }),
      enemy: combatant({
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
      }),
    });

    expect(result.terminationReason).toBe('DOUBLE_KO');
    expect(result.winner).toBeNull();
    expect(result.player.hpRemaining).toBe('0');
    expect(result.enemy.hpRemaining).toBe('0');
    expect(result.events).toHaveLength(2);
  });

  it('stops at the event cap and reports truncation', () => {
    const result = simulateCombatEncounter({
      seedHex,
      maxEvents: 1,
      maxRounds: 16,
      player: combatant({
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
        maxHpOverride: '200',
        damageOverride: '10',
        accuracyOverride: '100',
        evasionOverride: '0',
        baseAttackIntervalSeconds: '1',
      }),
      enemy: combatant({
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
        maxHpOverride: '200',
        damageOverride: '10',
        accuracyOverride: '100',
        evasionOverride: '0',
        baseAttackIntervalSeconds: '1',
      }),
    });

    expect(result.terminationReason).toBe('EVENT_LIMIT_REACHED');
    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  it('stops at the round cap independently of the event cap', () => {
    const result = simulateCombatEncounter({
      seedHex,
      maxEvents: 64,
      maxRounds: 1,
      player: combatant({
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
        maxHpOverride: '200',
        damageOverride: '10',
        accuracyOverride: '100',
        evasionOverride: '0',
        baseAttackIntervalSeconds: '1',
      }),
      enemy: combatant({
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
        maxHpOverride: '200',
        damageOverride: '10',
        accuracyOverride: '100',
        evasionOverride: '0',
        baseAttackIntervalSeconds: '1',
      }),
    });

    expect(result.terminationReason).toBe('ROUND_LIMIT_REACHED');
    expect(result.truncated).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('uses consumables when the configured threshold and round gate are met', () => {
    const result = simulateCombatEncounter({
      seedHex,
      maxEvents: 32,
      maxRounds: 16,
      player: combatant({
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
        maxHpOverride: '100',
        damageOverride: '5',
        accuracyOverride: '100',
        evasionOverride: '0',
        baseAttackIntervalSeconds: '2',
        consumables: [
          {
            id: 'pill.heal.small',
            healHp: '40',
            hpThresholdRatio: '0.8',
            minRoundIndex: 1,
            maxUses: 1,
          },
        ],
      }),
      enemy: combatant({
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
        maxHpOverride: '200',
        damageOverride: '40',
        accuracyOverride: '100',
        evasionOverride: '0',
        baseAttackIntervalSeconds: '1',
      }),
    });

    expect(result.events.some((event) => event.actionType === 'CONSUMABLE')).toBe(true);
    const consumableEvent = result.events.find((event) => event.actionType === 'CONSUMABLE');
    expect(consumableEvent?.consumableId).toBe('pill.heal.small');
    expect(Number(consumableEvent?.healedHp ?? '0')).toBeGreaterThan(0);
  });
});
