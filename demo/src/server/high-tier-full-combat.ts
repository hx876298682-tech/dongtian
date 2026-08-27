import type { HighTierRealmCombatContract } from './high-tier-contract.ts';
import type { CombatEvent, CombatStats, HighTierFullCombatResult, HighTierFullCombatSnapshot, HighTierRealm } from './types.ts';

/**
 * Deterministic full_v1 combat runtime.
 *
 * The engine is intentionally parameter-only: no three-dungeon values are
 * read here. A caller must provide a validated realm contract and a start-time
 * player snapshot. Integer seconds are used as the authoritative simulation
 * clock so a settlement replay produces the same result on every instance.
 */
export const makeHighTierFullCombatSnapshot = (
  realm: HighTierRealm,
  contract: HighTierRealmCombatContract,
  combatSnapshot: CombatStats,
  bossMaxHp: number,
): HighTierFullCombatSnapshot => ({
  mode: 'full_v1',
  realm,
  contract: structuredClone(contract),
  bossMaxHp,
  combatSnapshot: structuredClone(combatSnapshot),
});

type ActiveEffect = { kind: 'damage_over_time' | 'control' | 'output_suppression'; endsAt: number; magnitude: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const hitChance = (accuracy: number, defence: number): number => clamp(0.5 + (accuracy - defence) / 200, 0.05, 0.95);
const elementMultiplier = (attacker: string, target: string): number => {
  if (attacker === 'neutral' || target === 'neutral' || attacker === target) return 1;
  const counter: Record<string, string> = { metal: 'wood', wood: 'earth', earth: 'water', water: 'fire', fire: 'metal' };
  if (counter[attacker] === target) return 1.2;
  if (counter[target] === attacker) return 0.85;
  return 1;
};

const combatResult = (input: Partial<HighTierFullCombatResult> & Pick<HighTierFullCombatResult, 'status' | 'elapsedSeconds' | 'bossHp' | 'playerHealth'>): HighTierFullCombatResult => ({
  status: input.status,
  failureReason: input.failureReason ?? null,
  elapsedSeconds: input.elapsedSeconds,
  bossHp: Math.max(0, input.bossHp),
  playerHealth: Math.max(0, input.playerHealth),
  pillUses: input.pillUses ?? 0,
  skillCasts: input.skillCasts ?? 0,
  controlSeconds: input.controlSeconds ?? 0,
  damageOverTimeDamage: input.damageOverTimeDamage ?? 0,
  outputSuppressedSeconds: input.outputSuppressedSeconds ?? 0,
  bossAttacks: input.bossAttacks ?? 0,
  bossDamageTaken: input.bossDamageTaken ?? 0,
  combatEvents: input.combatEvents ?? [],
});

export const simulateHighTierFullCombat = (
  snapshot: HighTierFullCombatSnapshot,
  requestedElapsedSeconds: number,
): HighTierFullCombatResult => {
  if (!Number.isFinite(requestedElapsedSeconds) || requestedElapsedSeconds < 0) throw new Error('requestedElapsedSeconds must be finite and non-negative');
  const elapsedLimit = Math.floor(requestedElapsedSeconds);
  const { contract, combatSnapshot } = snapshot;
  let bossHp = snapshot.bossMaxHp;
  let playerHealth = combatSnapshot.health;
  let playerAttackClock = 0;
  let bossAttackClock = 0;
  let pillUses = 0;
  let skillCasts = 0;
  let controlSeconds = 0;
  let damageOverTimeDamage = 0;
  let outputSuppressedSeconds = 0;
  let bossAttacks = 0;
  let bossDamageTaken = 0;
  const combatEvents: CombatEvent[] = [];
  let eventsTruncated = false;
  const event = (entry: CombatEvent): void => {
    if (combatEvents.length < 4095) combatEvents.push(entry);
    else if (!eventsTruncated) {
      eventsTruncated = true;
      combatEvents.push({ second: entry.second, actor: 'system', kind: 'trace_truncated', state: { maxEvents: 4096 } });
    } else if (entry.kind === 'combat_end') {
      combatEvents[combatEvents.length - 1] = entry;
    }
  };
  const nextSkillAt = new Map<string, number>(contract.skills.map((skill) => [skill.id, 0]));
  const activeEffects: ActiveEffect[] = [];
  const playerDamagePerAttack = combatSnapshot.attack
    * 100 / Math.max(1, 100 + contract.bossDefence)
    * hitChance(combatSnapshot.accuracy, contract.bossAccuracy)
    * elementMultiplier(combatSnapshot.element, contract.bossElement)
    * Math.max(0, combatSnapshot.outgoingSpecial);

  for (let second = 1; second <= elapsedLimit; second += 1) {
    // Skills are scheduled from the start of the attempt. A duration is
    // resistance-adjusted at cast time and remains frozen in the attempt.
    for (const skill of contract.skills) {
      let next = nextSkillAt.get(skill.id) ?? Number.POSITIVE_INFINITY;
      // A contract may use fractional cooldowns. Process every event due in
      // this one-second bucket, with a hard guard against pathological input.
      let castsThisSecond = 0;
      while (second + 1e-9 >= next && castsThisSecond < 100_000) {
        const effectiveDuration = skill.durationSeconds * (1 - (skill.kind === 'control'
          ? contract.resistances.controlPercent
          : skill.kind === 'damage_over_time'
            ? contract.resistances.damageOverTimePercent
            : skill.kind === 'output_suppression'
              ? contract.resistances.outputSuppressionPercent
              : 0) / 100);
        skillCasts += 1;
        castsThisSecond += 1;
        event({ second, actor: 'boss', kind: 'skill_cast', state: { skillId: skill.id, skillKind: skill.kind } });
        next += skill.cooldownSeconds;
        if (skill.kind === 'damage') {
          const damage = skill.magnitude * 100 / Math.max(1, 100 + combatSnapshot.defence)
            * elementMultiplier(contract.bossElement, combatSnapshot.element)
            * Math.max(0, combatSnapshot.incomingSpecial);
          playerHealth -= damage;
          bossDamageTaken += damage;
          event({ second, actor: 'boss', kind: 'skill_damage', amount: damage, state: { target: 'player', skillId: skill.id } });
        } else if (effectiveDuration > 0) {
          activeEffects.push({ kind: skill.kind, endsAt: second + effectiveDuration, magnitude: skill.magnitude });
          event({ second, actor: 'boss', kind: 'effect_applied', state: { effect: skill.kind, durationSeconds: effectiveDuration, skillId: skill.id } });
        }
      }
      nextSkillAt.set(skill.id, next);
    }

    let controlActive = false;
    let suppressionPercent = 0;
    for (let index = activeEffects.length - 1; index >= 0; index -= 1) {
      const effect = activeEffects[index];
      if (!effect || second >= effect.endsAt) {
        activeEffects.splice(index, 1);
        continue;
      }
      if (effect.kind === 'control') controlActive = true;
      else if (effect.kind === 'output_suppression') suppressionPercent += effect.magnitude;
      else {
        const damage = effect.magnitude * (1 - contract.resistances.damageOverTimePercent / 100)
          * 100 / Math.max(1, 100 + combatSnapshot.defence)
          * elementMultiplier(contract.bossElement, combatSnapshot.element)
          * Math.max(0, combatSnapshot.incomingSpecial);
        playerHealth -= damage;
        bossDamageTaken += damage;
        damageOverTimeDamage += damage;
        event({ second, actor: 'boss', kind: 'damage_over_time', amount: damage, state: { target: 'player' } });
      }
    }
    suppressionPercent = clamp(suppressionPercent * (1 - contract.resistances.outputSuppressionPercent / 100), 0, 100);
    if (controlActive) controlSeconds += 1;
    if (suppressionPercent > 0) outputSuppressedSeconds += 1;

    bossAttackClock += 1;
    while (bossAttackClock + 1e-9 >= contract.bossAttackIntervalSeconds) {
      bossAttackClock -= contract.bossAttackIntervalSeconds;
      bossAttacks += 1;
      if (hitChance(contract.bossAccuracy, combatSnapshot.evasion) >= 0.5) {
        const damage = contract.bossAttack * 100 / Math.max(1, 100 + combatSnapshot.defence)
          * elementMultiplier(contract.bossElement, combatSnapshot.element)
          * Math.max(0, combatSnapshot.incomingSpecial);
        playerHealth -= damage;
        bossDamageTaken += damage;
        event({ second, actor: 'boss', kind: 'attack', amount: damage, state: { target: 'player' } });
      }
    }

    if (playerHealth > 0 && !controlActive) {
      playerAttackClock += 1;
      const attacks = Math.floor(playerAttackClock / Math.max(0.001, combatSnapshot.attackInterval));
      playerAttackClock -= attacks * Math.max(0.001, combatSnapshot.attackInterval);
      const outgoingMultiplier = 1 - suppressionPercent / 100;
      const damage = attacks * playerDamagePerAttack * outgoingMultiplier;
      bossHp -= damage;
      if (attacks > 0) event({ second, actor: 'player', kind: 'attack', amount: damage, state: { target: 'boss', attacks } });
    }

    if (playerHealth > 0 && playerHealth / Math.max(1, combatSnapshot.health) * 100 <= contract.autoPill.thresholdPercent && pillUses < contract.autoPill.maxUses) {
      const targetHealth = combatSnapshot.health * contract.autoPill.targetPercent / 100;
      const heal = Math.max(contract.autoPill.healPerUse * Math.max(0, combatSnapshot.pillHealMultiplier), targetHealth - playerHealth);
      playerHealth = Math.min(combatSnapshot.health, playerHealth + heal);
      pillUses += 1;
      event({ second, actor: 'player', kind: 'auto_pill', amount: heal, state: { uses: pillUses } });
    }

    if (bossHp <= 0) { const end = { second, actor: 'system' as const, kind: 'combat_end', state: { status: 'succeeded', bossHp, playerHealth } }; if (eventsTruncated) combatEvents.push(end); else event(end); return combatResult({ status: 'succeeded', elapsedSeconds: second, bossHp, playerHealth, pillUses, skillCasts, controlSeconds, damageOverTimeDamage, outputSuppressedSeconds, bossAttacks, bossDamageTaken, combatEvents }); }
    if (playerHealth <= 0) { const end = { second, actor: 'system' as const, kind: 'combat_end', state: { status: 'failed', failureReason: 'player_defeated', bossHp, playerHealth } }; if (eventsTruncated) combatEvents.push(end); else event(end); return combatResult({ status: 'failed', failureReason: 'player_defeated', elapsedSeconds: second, bossHp, playerHealth, pillUses, skillCasts, controlSeconds, damageOverTimeDamage, outputSuppressedSeconds, bossAttacks, bossDamageTaken, combatEvents }); }
  }

  const end = { second: elapsedLimit, actor: 'system' as const, kind: 'combat_end', state: { status: 'active', bossHp, playerHealth } };
  if (eventsTruncated) combatEvents.push(end); else event(end);
  return combatResult({ status: 'active', elapsedSeconds: elapsedLimit, bossHp, playerHealth, pillUses, skillCasts, controlSeconds, damageOverTimeDamage, outputSuppressedSeconds, bossAttacks, bossDamageTaken, combatEvents });
};

export const findHighTierFullCombatClearTime = (snapshot: HighTierFullCombatSnapshot, maxSeconds = 10_000_000): number => {
  const result = simulateHighTierFullCombat(snapshot, maxSeconds);
  if (result.status !== 'succeeded') throw new Error(`full_v1 combat did not clear within ${maxSeconds} seconds`);
  return result.elapsedSeconds;
};
