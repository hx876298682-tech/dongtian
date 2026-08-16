import Decimal from 'decimal.js';

import { seedFromHex, Xoshiro128StarStar } from './random.js';
import { microseconds, type Microseconds } from './time.js';

const CombatDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });

export type CombatSide = 'PLAYER' | 'ENEMY';
export type CombatStyle = 'MELEE' | 'RANGED' | 'MAGIC';

export type CombatConsumable = {
  readonly id: string;
  readonly healHp: string;
  readonly hpThresholdRatio: string;
  readonly minRoundIndex?: number;
  readonly maxUses?: number;
  readonly priority?: number;
};

export type CombatantInput = {
  readonly side: CombatSide;
  readonly style: CombatStyle;
  readonly staminaLevel: string;
  readonly intelligenceLevel: string;
  readonly attackLevel: string;
  readonly defenseLevel: string;
  readonly meleeLevel: string;
  readonly rangedLevel: string;
  readonly magicLevel: string;
  readonly equipmentHp: string;
  readonly baseAttackIntervalSeconds: string;
  readonly accuracyBonus?: string;
  readonly damageBonus?: string;
  readonly evasionBonus?: string;
  readonly attackSpeedBonus?: string;
  readonly critRateBonus?: string;
  readonly critDamageBonus?: string;
  readonly penetration?: string;
  readonly maxHpOverride?: string;
  readonly accuracyOverride?: string;
  readonly evasionOverride?: string;
  readonly damageOverride?: string;
  readonly attackIntervalOverrideSeconds?: string;
  readonly consumables?: readonly CombatConsumable[];
};

export type CombatantSnapshot = {
  readonly side: CombatSide;
  readonly style: CombatStyle;
  readonly combatLevel: string;
  readonly attackLevel: string;
  readonly defenseLevel: string;
  readonly maxHp: string;
  readonly maxMp: string;
  readonly accuracy: string;
  readonly evasion: string;
  readonly damage: string;
  readonly attackIntervalUs: string;
  readonly penetration: string;
  readonly critRateBonus: string;
  readonly critDamageBonus: string;
};

export type CombatEvent = {
  readonly eventIndex: number;
  readonly roundIndex: number;
  readonly timeUs: string;
  readonly actorSide: CombatSide;
  readonly actionType: 'CONSUMABLE' | 'ATTACK';
  readonly targetSide: CombatSide | null;
  readonly consumableId: string | null;
  readonly hitChance: string | null;
  readonly critChance: string | null;
  readonly damageTakenMultiplier: string | null;
  readonly hit: boolean | null;
  readonly critical: boolean | null;
  readonly damage: string;
  readonly healedHp: string;
  readonly actorHpAfter: string;
  readonly targetHpAfter: string;
};

export type CombatTerminationReason =
  | 'PLAYER_DEFEATED'
  | 'ENEMY_DEFEATED'
  | 'DOUBLE_KO'
  | 'EVENT_LIMIT_REACHED'
  | 'ROUND_LIMIT_REACHED';

export type CombatSimulationInput = {
  readonly seedHex: string;
  readonly player: CombatantInput;
  readonly enemy: CombatantInput;
  readonly maxEvents?: number;
  readonly maxRounds?: number;
};

export type CombatSimulationResult = {
  readonly seedHex: string;
  readonly terminationReason: CombatTerminationReason;
  readonly winner: CombatSide | null;
  readonly truncated: boolean;
  readonly eventLimit: number;
  readonly roundLimit: number;
  readonly events: readonly CombatEvent[];
  readonly elapsedUs: Microseconds;
  readonly player: CombatantSnapshot & {
    readonly hpRemaining: string;
    readonly consumablesUsed: number;
  };
  readonly enemy: CombatantSnapshot & {
    readonly hpRemaining: string;
    readonly consumablesUsed: number;
  };
};

type ParsedCombatant = {
  readonly input: CombatantInput;
  readonly snapshot: CombatantSnapshot;
  hp: Decimal;
  nextActionUs: Microseconds;
  readonly consumables: readonly CombatConsumable[];
  readonly consumableUses: Map<string, number>;
};

function decimal(input: string | number | bigint): Decimal {
  const value = new CombatDecimal(input);
  if (!value.isFinite()) {
    throw new Error('COMBAT_DECIMAL_INVALID');
  }
  return value;
}

function decimalString(input: Decimal): string {
  return input.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function requirePositiveInteger(value: number | undefined, field: string, defaultValue: number): number {
  const candidate = value ?? defaultValue;
  if (!Number.isInteger(candidate) || candidate < 1) {
    throw new Error(`COMBAT_${field}_INVALID`);
  }
  return candidate;
}

function requireDecimalField(input: string | undefined, field: string): Decimal {
  if (input === undefined) {
    throw new Error(`COMBAT_${field}_REQUIRED`);
  }
  return decimal(input);
}

function requireNonNegativeDecimalField(input: string | undefined, field: string): Decimal {
  const value = requireDecimalField(input, field);
  if (value.isNegative()) {
    throw new Error(`COMBAT_${field}_NEGATIVE`);
  }
  return value;
}

function clampDecimal(input: Decimal, min: Decimal, max: Decimal): Decimal {
  return Decimal.max(min, Decimal.min(max, input));
}

function chooseStyleSkill(input: CombatantInput): Decimal {
  switch (input.style) {
    case 'MELEE':
      return decimal(input.meleeLevel);
    case 'RANGED':
      return decimal(input.rangedLevel);
    case 'MAGIC':
      return decimal(input.magicLevel);
  }
}

export function resolveCombatLevel(input: CombatantInput): string {
  const stamina = decimal(input.staminaLevel);
  const intelligence = decimal(input.intelligenceLevel);
  const attack = decimal(input.attackLevel);
  const defense = decimal(input.defenseLevel);
  const melee = decimal(input.meleeLevel);
  const ranged = decimal(input.rangedLevel);
  const magic = decimal(input.magicLevel);
  const highestSkill = Decimal.max(melee, Decimal.max(ranged, magic));
  const highestCombatStat = Decimal.max(attack, Decimal.max(defense, Decimal.max(melee, Decimal.max(ranged, magic))));
  const combatLevel = stamina
    .plus(intelligence)
    .plus(attack)
    .plus(defense)
    .plus(highestSkill)
    .times(0.1)
    .plus(highestCombatStat.times(0.5));
  return decimalString(combatLevel);
}

export function resolveHitChance(accuracy: string | number | bigint, evasion: string | number | bigint): string {
  const accuracyValue = decimal(accuracy);
  const evasionValue = decimal(evasion);
  if (accuracyValue.isNegative() || evasionValue.isNegative()) {
    throw new Error('COMBAT_HIT_STAT_NEGATIVE');
  }
  if (accuracyValue.isZero() && evasionValue.isZero()) {
    return '0.5';
  }
  if (accuracyValue.isZero()) {
    return '0';
  }
  if (evasionValue.isZero()) {
    return '1';
  }
  const hitPower = accuracyValue.pow(1.4);
  const evadePower = evasionValue.pow(1.4);
  return decimalString(hitPower.div(hitPower.plus(evadePower)));
}

export function resolveDamageTakenMultiplier(
  defense: string | number | bigint,
  penetration: string | number | bigint = 0,
): string {
  const defenseValue = decimal(defense);
  const penetrationValue = decimal(penetration);
  if (defenseValue.isNaN() || penetrationValue.isNaN()) {
    throw new Error('COMBAT_DEFENSE_INVALID');
  }
  const effectiveDefense = defenseValue.minus(penetrationValue);
  if (effectiveDefense.gte(0)) {
    return decimalString(decimal(100).div(decimal(100).plus(effectiveDefense)));
  }
  return decimalString(decimal(100).minus(effectiveDefense).div(100));
}

export function resolveCritChance(
  style: CombatStyle,
  hitChance: string | number | bigint,
  critRateBonus: string | number | bigint = 0,
): string {
  const hitChanceValue = decimal(hitChance);
  const critRateBonusValue = decimal(critRateBonus);
  const baseCrit = style === 'RANGED' ? hitChanceValue.times(0.3) : decimal(0);
  return decimalString(clampDecimal(baseCrit.plus(critRateBonusValue), decimal(0), decimal(1)));
}

function resolveMaxHp(input: CombatantInput): Decimal {
  if (input.maxHpOverride !== undefined) {
    return requireNonNegativeDecimalField(input.maxHpOverride, 'MAX_HP_OVERRIDE');
  }
  const stamina = requireNonNegativeDecimalField(input.staminaLevel, 'STAMINA_LEVEL');
  const equipmentHp = requireNonNegativeDecimalField(input.equipmentHp, 'EQUIPMENT_HP');
  return decimal(10).times(decimal(10).plus(stamina)).plus(equipmentHp);
}

function resolveMaxMp(input: CombatantInput): Decimal {
  const intelligence = requireNonNegativeDecimalField(input.intelligenceLevel, 'INTELLIGENCE_LEVEL');
  return decimal(100).plus(intelligence.times(10));
}

function resolveAccuracy(input: CombatantInput): Decimal {
  if (input.accuracyOverride !== undefined) {
    return requireNonNegativeDecimalField(input.accuracyOverride, 'ACCURACY_OVERRIDE');
  }
  const attack = requireNonNegativeDecimalField(input.attackLevel, 'ATTACK_LEVEL');
  const accuracyBonus = decimal(input.accuracyBonus ?? '0');
  const value = decimal(10).plus(attack).times(decimal(1).plus(accuracyBonus));
  if (value.lte(0)) {
    throw new Error('COMBAT_ACCURACY_INVALID');
  }
  return value;
}

function resolveEvasion(input: CombatantInput): Decimal {
  if (input.evasionOverride !== undefined) {
    return requireNonNegativeDecimalField(input.evasionOverride, 'EVASION_OVERRIDE');
  }
  const defense = requireNonNegativeDecimalField(input.defenseLevel, 'DEFENSE_LEVEL');
  const evasionBonus = decimal(input.evasionBonus ?? '0');
  const value = decimal(10).plus(defense).times(decimal(1).plus(evasionBonus));
  if (value.lte(0)) {
    throw new Error('COMBAT_EVASION_INVALID');
  }
  return value;
}

function resolveDamage(input: CombatantInput): Decimal {
  if (input.damageOverride !== undefined) {
    return requireNonNegativeDecimalField(input.damageOverride, 'DAMAGE_OVERRIDE');
  }
  const styleSkill = chooseStyleSkill(input);
  if (styleSkill.isNegative()) {
    throw new Error('COMBAT_STYLE_SKILL_NEGATIVE');
  }
  const damageBonus = decimal(input.damageBonus ?? '0');
  const value = decimal(10).plus(styleSkill).times(decimal(1).plus(damageBonus));
  if (value.lte(0)) {
    throw new Error('COMBAT_DAMAGE_INVALID');
  }
  return value;
}

function resolveAttackIntervalUs(input: CombatantInput): Microseconds {
  if (input.attackIntervalOverrideSeconds !== undefined) {
    const overridden = requireNonNegativeDecimalField(input.attackIntervalOverrideSeconds, 'ATTACK_INTERVAL_OVERRIDE_SECONDS');
    if (overridden.lte(0)) {
      throw new Error('COMBAT_ATTACK_INTERVAL_INVALID');
    }
    return microseconds(overridden.times(1_000_000).toDecimalPlaces(0, Decimal.ROUND_CEIL).toString());
  }
  const baseInterval = requireNonNegativeDecimalField(input.baseAttackIntervalSeconds, 'BASE_ATTACK_INTERVAL_SECONDS');
  if (baseInterval.lte(0)) {
    throw new Error('COMBAT_ATTACK_INTERVAL_INVALID');
  }
  const attack = requireNonNegativeDecimalField(input.attackLevel, 'ATTACK_LEVEL');
  const attackSpeedBonus = decimal(input.attackSpeedBonus ?? '0');
  const speedMultiplier = decimal(1)
    .plus(attack.div(2000))
    .times(decimal(1).plus(attackSpeedBonus));
  if (speedMultiplier.lte(0)) {
    throw new Error('COMBAT_ATTACK_SPEED_INVALID');
  }
  const intervalSeconds = baseInterval.div(speedMultiplier);
  if (intervalSeconds.lte(0)) {
    throw new Error('COMBAT_ATTACK_INTERVAL_INVALID');
  }
  return microseconds(intervalSeconds.times(1_000_000).toDecimalPlaces(0, Decimal.ROUND_CEIL).toString());
}

function normalizeConsumables(consumables: readonly CombatConsumable[] | undefined): readonly CombatConsumable[] {
  const list = [...(consumables ?? [])];
  list.forEach((consumable, index) => {
    if (consumable.id.trim().length === 0) {
      throw new Error(`COMBAT_CONSUMABLE_ID_REQUIRED:${index}`);
    }
    const healHp = requireNonNegativeDecimalField(consumable.healHp, `CONSUMABLE_HEAL_HP:${consumable.id}`);
    if (healHp.isZero()) {
      throw new Error(`COMBAT_CONSUMABLE_HEAL_HP_ZERO:${consumable.id}`);
    }
    const threshold = decimal(consumable.hpThresholdRatio);
    if (threshold.lt(0) || threshold.gt(1)) {
      throw new Error(`COMBAT_CONSUMABLE_THRESHOLD_INVALID:${consumable.id}`);
    }
    if (consumable.minRoundIndex !== undefined && (!Number.isInteger(consumable.minRoundIndex) || consumable.minRoundIndex < 0)) {
      throw new Error(`COMBAT_CONSUMABLE_MIN_ROUND_INVALID:${consumable.id}`);
    }
    if (consumable.maxUses !== undefined && (!Number.isInteger(consumable.maxUses) || consumable.maxUses < 1)) {
      throw new Error(`COMBAT_CONSUMABLE_MAX_USES_INVALID:${consumable.id}`);
    }
  });
  return list.sort((left, right) => {
    const leftPriority = left.priority ?? 0;
    const rightPriority = right.priority ?? 0;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.id.localeCompare(right.id);
  });
}

function deriveCombatant(input: CombatantInput): ParsedCombatant {
  const snapshot: CombatantSnapshot = {
    side: input.side,
    style: input.style,
    combatLevel: resolveCombatLevel(input),
    attackLevel: requireNonNegativeDecimalField(input.attackLevel, 'ATTACK_LEVEL').toString(),
    defenseLevel: requireNonNegativeDecimalField(input.defenseLevel, 'DEFENSE_LEVEL').toString(),
    maxHp: decimalString(resolveMaxHp(input)),
    maxMp: decimalString(resolveMaxMp(input)),
    accuracy: decimalString(resolveAccuracy(input)),
    evasion: decimalString(resolveEvasion(input)),
    damage: decimalString(resolveDamage(input)),
    attackIntervalUs: resolveAttackIntervalUs(input).toString(),
    penetration: requireNonNegativeDecimalField(input.penetration ?? '0', 'PENETRATION').toString(),
    critRateBonus: decimal(input.critRateBonus ?? '0').toString(),
    critDamageBonus: decimal(input.critDamageBonus ?? '0').toString(),
  };

  if (decimal(1).plus(decimal(snapshot.critDamageBonus)).lte(0)) {
    throw new Error('COMBAT_CRIT_DAMAGE_INVALID');
  }

  const consumables = normalizeConsumables(input.consumables);

  return {
    input,
    snapshot,
    hp: decimal(snapshot.maxHp),
    nextActionUs: microseconds(0n),
    consumables,
    consumableUses: new Map<string, number>(),
  };
}

function firstAvailableConsumable(
  state: ParsedCombatant,
  roundIndex: number,
): CombatConsumable | null {
  for (const consumable of state.consumables) {
    const threshold = decimal(consumable.hpThresholdRatio);
    if (roundIndex < (consumable.minRoundIndex ?? 0)) {
      continue;
    }
    const uses = state.consumableUses.get(consumable.id) ?? 0;
    if (uses >= (consumable.maxUses ?? Number.POSITIVE_INFINITY)) {
      continue;
    }
    const hpRatio = state.hp.div(decimal(state.snapshot.maxHp));
    if (hpRatio.lte(threshold)) {
      return consumable;
    }
  }
  return null;
}

function scheduleNextAction(state: ParsedCombatant, currentTimeUs: Microseconds): void {
  state.nextActionUs = microseconds(currentTimeUs + microseconds(state.snapshot.attackIntervalUs));
}

function applyConsumable(
  state: ParsedCombatant,
  roundIndex: number,
  currentTimeUs: Microseconds,
  eventIndex: number,
): { readonly event: CombatEvent; readonly used: boolean } {
  const consumable = firstAvailableConsumable(state, roundIndex);
  if (!consumable) {
    return {
      used: false,
      event: {
        eventIndex,
        roundIndex,
        timeUs: currentTimeUs.toString(),
        actorSide: state.input.side,
        actionType: 'ATTACK',
        targetSide: null,
        consumableId: null,
        hitChance: null,
        critChance: null,
        damageTakenMultiplier: null,
        hit: null,
        critical: null,
        damage: '0',
        healedHp: '0',
        actorHpAfter: state.hp.toString(),
        targetHpAfter: '0',
      },
    };
  }

  const healAmount = requireNonNegativeDecimalField(consumable.healHp, `CONSUMABLE_HEAL_HP:${consumable.id}`);
  const before = state.hp;
  state.hp = Decimal.min(decimal(state.snapshot.maxHp), state.hp.plus(healAmount));
  state.consumableUses.set(consumable.id, (state.consumableUses.get(consumable.id) ?? 0) + 1);
  if (state.hp.gt(0)) {
    scheduleNextAction(state, currentTimeUs);
  }
  return {
    used: true,
    event: {
      eventIndex,
      roundIndex,
      timeUs: currentTimeUs.toString(),
      actorSide: state.input.side,
      actionType: 'CONSUMABLE',
      targetSide: null,
      consumableId: consumable.id,
      hitChance: null,
      critChance: null,
      damageTakenMultiplier: null,
      hit: null,
      critical: null,
      damage: '0',
      healedHp: decimalString(state.hp.minus(before)),
      actorHpAfter: state.hp.toString(),
      targetHpAfter: '0',
    },
  };
}

function attackEvent(
  attacker: ParsedCombatant,
  defender: ParsedCombatant,
  roundIndex: number,
  currentTimeUs: Microseconds,
  eventIndex: number,
  rng: Xoshiro128StarStar,
): CombatEvent {
  const hitChance = decimal(resolveHitChance(attacker.snapshot.accuracy, defender.snapshot.evasion));
  const hit = rng.nextUnit().value.lt(hitChance);
  let critical = false;
  let damage = decimal(0);
  const damageTakenMultiplier = decimal(resolveDamageTakenMultiplier(defender.input.defenseLevel, attacker.snapshot.penetration));
  if (hit) {
    const critChance = decimal(resolveCritChance(attacker.snapshot.style, hitChance.toString(), attacker.snapshot.critRateBonus));
    critical = rng.nextUnit().value.lt(critChance);
    const critMultiplier = decimal(1).plus(decimal(attacker.snapshot.critDamageBonus));
    const baseDamage = decimal(attacker.snapshot.damage);
    const rawDamage = critical ? baseDamage.times(critMultiplier) : baseDamage;
    const effectiveMultiplier = damageTakenMultiplier;
    damage = rawDamage.times(effectiveMultiplier);
    if (damage.lt(0)) {
      damage = decimal(0);
    }
    defender.hp = Decimal.max(decimal(0), defender.hp.minus(damage));
  }
  const attackEvent: CombatEvent = {
    eventIndex,
    roundIndex,
    timeUs: currentTimeUs.toString(),
    actorSide: attacker.input.side,
    actionType: 'ATTACK',
    targetSide: defender.input.side,
    consumableId: null,
    hitChance: decimalString(hitChance),
    critChance: decimalString(decimal(resolveCritChance(attacker.snapshot.style, hitChance.toString(), attacker.snapshot.critRateBonus))),
    damageTakenMultiplier: decimalString(damageTakenMultiplier),
    hit,
    critical,
    damage: decimalString(damage),
    healedHp: '0',
    actorHpAfter: attacker.hp.toString(),
    targetHpAfter: defender.hp.toString(),
  };
  if (attacker.hp.gt(0)) {
    scheduleNextAction(attacker, currentTimeUs);
  }
  return attackEvent;
}

export function simulateCombatEncounter(input: CombatSimulationInput): CombatSimulationResult {
  const eventLimit = requirePositiveInteger(input.maxEvents, 'EVENT_LIMIT', 256);
  const roundLimit = requirePositiveInteger(input.maxRounds, 'ROUND_LIMIT', 128);
  const seedBytes = seedFromHex(input.seedHex);
  const rng = new Xoshiro128StarStar(seedBytes);
  const player = deriveCombatant(input.player);
  const enemy = deriveCombatant(input.enemy);

  const events: CombatEvent[] = [];
  let roundIndex = 0;
  let currentTimeUs = microseconds(0n);
  let terminationReason: CombatTerminationReason = 'ROUND_LIMIT_REACHED';

  if (player.hp.lte(0) && enemy.hp.lte(0)) {
    terminationReason = 'DOUBLE_KO';
  } else if (player.hp.lte(0)) {
    terminationReason = 'PLAYER_DEFEATED';
  } else if (enemy.hp.lte(0)) {
    terminationReason = 'ENEMY_DEFEATED';
  } else {
    while (events.length < eventLimit && roundIndex < roundLimit) {
      const dueTime = Decimal.min(
        new CombatDecimal(player.nextActionUs.toString()),
        new CombatDecimal(enemy.nextActionUs.toString()),
      );
      currentTimeUs = microseconds(dueTime.toFixed(0));

      const playerDue = !player.hp.lte(0) && player.nextActionUs === currentTimeUs;
      const enemyDue = !enemy.hp.lte(0) && enemy.nextActionUs === currentTimeUs;
      if (!playerDue && !enemyDue) {
        break;
      }

      const batchOrder: ParsedCombatant[] = [];
      if (playerDue) {
        batchOrder.push(player);
      }
      if (enemyDue) {
        batchOrder.push(enemy);
      }

      for (const actor of batchOrder) {
        if (events.length >= eventLimit) {
          break;
        }

        const defender = actor.input.side === 'PLAYER' ? enemy : player;
        const consumableEvent = applyConsumable(actor, roundIndex, currentTimeUs, events.length);
        if (consumableEvent.used) {
          events.push(consumableEvent.event);
          continue;
        }

        const attack = attackEvent(actor, defender, roundIndex, currentTimeUs, events.length, rng);
        events.push(attack);
      }

      if (player.hp.lte(0) && enemy.hp.lte(0)) {
        terminationReason = 'DOUBLE_KO';
        break;
      }
      if (player.hp.lte(0)) {
        terminationReason = 'PLAYER_DEFEATED';
        break;
      }
      if (enemy.hp.lte(0)) {
        terminationReason = 'ENEMY_DEFEATED';
        break;
      }

      roundIndex += 1;
    }

    if (terminationReason === 'ROUND_LIMIT_REACHED' && events.length >= eventLimit) {
      terminationReason = 'EVENT_LIMIT_REACHED';
    } else if (terminationReason === 'ROUND_LIMIT_REACHED' && roundIndex >= roundLimit) {
      terminationReason = 'ROUND_LIMIT_REACHED';
    }
  }

  const winner: CombatSide | null =
    terminationReason === 'PLAYER_DEFEATED'
      ? 'ENEMY'
      : terminationReason === 'ENEMY_DEFEATED'
        ? 'PLAYER'
        : null;

  const truncated = terminationReason === 'EVENT_LIMIT_REACHED' || terminationReason === 'ROUND_LIMIT_REACHED';

  return {
    seedHex: input.seedHex,
    terminationReason,
    winner,
    truncated,
    eventLimit,
    roundLimit,
    events,
    elapsedUs: currentTimeUs,
    player: {
      ...player.snapshot,
      hpRemaining: decimalString(Decimal.max(decimal(0), player.hp)),
      consumablesUsed: [...player.consumableUses.values()].reduce((sum, value) => sum + value, 0),
    },
    enemy: {
      ...enemy.snapshot,
      hpRemaining: decimalString(Decimal.max(decimal(0), enemy.hp)),
      consumablesUsed: [...enemy.consumableUses.values()].reduce((sum, value) => sum + value, 0),
    },
  };
}
