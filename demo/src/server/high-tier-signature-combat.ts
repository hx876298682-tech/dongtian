import type { CombatEvent, CombatStats, HighTierRealm, HighTierSkillSummary } from './types.ts';

/**
 * The signature-only trace is an audit summary, not a second combat engine.
 * It deliberately uses only values already frozen on HighTierAttempt and has
 * a fixed-size output so an old attempt cannot grow its JSONB value linearly
 * with elapsed time.
 */
export const HIGH_TIER_SIGNATURE_TRACE_MAX_EVENTS = 7;

type SignatureCombatTraceInput = {
  attemptId: string;
  realm: HighTierRealm;
  seed: number;
  elapsedSeconds: number;
  targetClearTime: number;
  bossMaxHp: number;
  combatSnapshot: CombatStats;
  skill: HighTierSkillSummary;
  status: 'succeeded' | 'failed' | 'active';
  failureReason?: string | null;
};

const finiteNonNegative = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
const integerSeconds = (value: number): number => Math.floor(finiteNonNegative(value));

// FNV-1a keeps the trace tied to the frozen input without introducing a new
// random stream or a formal combat parameter.
const fingerprint = (input: SignatureCombatTraceInput): number => {
  const snapshot = input.combatSnapshot;
  const canonical = [
    input.attemptId,
    input.realm,
    input.seed,
    snapshot.attack,
    snapshot.defence,
    snapshot.health,
    snapshot.accuracy,
    snapshot.evasion,
    snapshot.attackInterval,
    snapshot.element,
    snapshot.outgoingSpecial,
    snapshot.incomingSpecial,
    input.skill.cooldownSeconds,
    input.skill.durationSeconds,
    input.skill.attackSuppressionPercent,
  ].join('|');
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const suppressionSchedule = (elapsedSeconds: number, skill: HighTierSkillSummary) => {
  const elapsed = integerSeconds(elapsedSeconds);
  const cooldown = integerSeconds(skill.cooldownSeconds);
  const duration = Math.min(cooldown, integerSeconds(skill.durationSeconds));
  const suppressionPercent = Math.min(100, finiteNonNegative(skill.attackSuppressionPercent));
  if (elapsed === 0 || cooldown <= 0 || duration <= 0 || suppressionPercent <= 0) {
    return { elapsed, cooldown, duration, suppressionPercent, windowCount: 0, suppressedSeconds: 0, firstWindowEnd: 0, lastWindowStart: 0 };
  }
  const fullCycles = Math.floor(elapsed / cooldown);
  const remainder = elapsed % cooldown;
  const suppressedSeconds = fullCycles * duration + Math.min(remainder, duration);
  const windowCount = Math.ceil(elapsed / cooldown);
  const lastWindowStart = (windowCount - 1) * cooldown + 1;
  const firstWindowEnd = Math.min(elapsed, duration);
  return { elapsed, cooldown, duration, suppressionPercent, windowCount, suppressedSeconds, firstWindowEnd, lastWindowStart };
};

export const makeHighTierSignatureCombatEvents = (input: SignatureCombatTraceInput): CombatEvent[] => {
  const schedule = suppressionSchedule(input.elapsedSeconds, input.skill);
  const seedFingerprint = fingerprint(input);
  const effectiveAttackSeconds = schedule.elapsed - schedule.suppressedSeconds * schedule.suppressionPercent / 100;
  const status = input.status;
  const failureReason = input.failureReason ?? null;
  // The event count and event ordering are fixed. Values are summaries so a
  // million-second settlement still produces the same bounded JSON shape.
  const events: CombatEvent[] = [
    {
      second: 0,
      actor: 'system',
      kind: 'combat_start',
      state: {
        schema: 'signature_only_v1',
        attemptId: input.attemptId,
        realm: input.realm,
        seed: input.seed,
        seedFingerprint,
        bossMaxHp: input.bossMaxHp,
        targetClearTime: input.targetClearTime,
        playerSnapshot: {
          attack: input.combatSnapshot.attack,
          defence: input.combatSnapshot.defence,
          health: input.combatSnapshot.health,
        },
      },
    },
  ];
  if (schedule.windowCount > 0) {
    events.push({
      second: 1,
      actor: 'boss',
      kind: 'skill_suppression_window',
      state: {
        windowIndex: 1,
        startSecond: 1,
        endSecond: schedule.firstWindowEnd,
        durationSeconds: schedule.duration,
        attackSuppressionPercent: schedule.suppressionPercent,
      },
    });
  }
  events.push({
    second: schedule.elapsed,
    actor: 'boss',
    kind: 'skill_suppression_summary',
    state: {
      cooldownSeconds: schedule.cooldown,
      durationSeconds: schedule.duration,
      attackSuppressionPercent: schedule.suppressionPercent,
      windowCount: schedule.windowCount,
      suppressedSeconds: schedule.suppressedSeconds,
      lastWindowStartSecond: schedule.lastWindowStart,
    },
  });
  events.push({
    second: schedule.elapsed,
    actor: 'player',
    kind: 'damage_phase',
    amount: effectiveAttackSeconds,
    state: {
      phase: 'player_output',
      effectiveAttackSeconds,
      suppressedSeconds: schedule.suppressedSeconds,
      attackSuppressionPercent: schedule.suppressionPercent,
      targetClearTime: input.targetClearTime,
      seedFingerprint,
    },
  });
  events.push({
    second: schedule.elapsed,
    actor: 'system',
    kind: status === 'succeeded' ? 'combat_success' : status === 'failed' ? 'combat_failure' : 'combat_progress',
    state: {
      status,
      failureReason,
      elapsedSeconds: schedule.elapsed,
      bossMaxHp: input.bossMaxHp,
      seedFingerprint,
    },
  });
  events.push({
    second: schedule.elapsed,
    actor: 'system',
    kind: 'combat_end',
    state: {
      status,
      failureReason,
      elapsedSeconds: schedule.elapsed,
      seedFingerprint,
    },
  });
  return events.slice(0, HIGH_TIER_SIGNATURE_TRACE_MAX_EVENTS);
};

export const makeHighTierSignatureCombatStartEvents = (input: Omit<SignatureCombatTraceInput, 'status' | 'failureReason' | 'elapsedSeconds'>): CombatEvent[] => makeHighTierSignatureCombatEvents({ ...input, elapsedSeconds: 0, status: 'active' }).slice(0, 1);
