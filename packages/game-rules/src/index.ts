import Decimal from 'decimal.js';

export * from './cycles.js';
export * from './buffs.js';
export * from './breakthrough.js';
export * from './cave.js';
export * from './combat.js';
export * from './decimal.js';
export * from './dungeon.js';
export * from './loot.js';
export * from './modifiers.js';
export * from './random.js';
export * from './queue.js';
export * from './settlement.js';
export * from './tempering.js';
export * from './time.js';
export * from './tools.js';
export * from './tutorial.js';

export const packageName = '@dongtian/game-rules' as const;

export type RealmStageRule = {
  readonly id: string;
  readonly stage_order: number;
  readonly cultivation_xp_start: string;
  readonly cultivation_xp_required: string;
};

export type SkillXpLevelRule = {
  readonly level: number;
  readonly xp_to_next: string;
  readonly cumulative_xp: string;
  readonly speed_modifier: string;
  readonly efficiency_modifier: string;
  readonly stage_node: boolean;
};

export type SkillXpCurveRule = {
  readonly levels: readonly SkillXpLevelRule[];
};

export type CultivationStageProgress = {
  readonly realmStageId: string;
  readonly stageStartXp: string;
  readonly stageRequiredXp: string;
  readonly stageProgressXp: string;
  readonly remainingXp: string;
  readonly progressRatio: string;
};

export type SkillProgress = {
  readonly level: number;
  readonly xp: string;
  readonly xpToNext: string;
  readonly remainingXp: string;
  readonly nextLevel: number | null;
  readonly speedModifier: string;
  readonly efficiencyModifier: string;
  readonly stageNode: boolean;
};

function decimalString(value: Decimal): string {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

export function mapCultivationStage(
  stages: readonly RealmStageRule[],
  cultivationXp: string,
): CultivationStageProgress {
  if (stages.length === 0) {
    throw new Error('REALM_STAGES_EMPTY');
  }

  const xp = new Decimal(cultivationXp);
  const ordered = [...stages].sort((left, right) => left.stage_order - right.stage_order);
  const first = ordered[0];
  if (first === undefined) {
    throw new Error('REALM_STAGES_EMPTY');
  }
  let selected = first;

  for (const stage of ordered) {
    if (xp.gte(new Decimal(stage.cultivation_xp_start))) {
      selected = stage;
    } else {
      break;
    }
  }

  const start = new Decimal(selected.cultivation_xp_start);
  const required = new Decimal(selected.cultivation_xp_required);
  const end = start.plus(required);
  const progress = Decimal.max(0, Decimal.min(required, xp.minus(start)));
  const remaining = Decimal.max(0, end.minus(xp));

  return {
    realmStageId: selected.id,
    stageStartXp: decimalString(start),
    stageRequiredXp: decimalString(required),
    stageProgressXp: decimalString(progress),
    remainingXp: decimalString(remaining),
    progressRatio: decimalString(required.isZero() ? new Decimal(0) : progress.div(required)),
  };
}

export function mapSkillProgress(curve: SkillXpCurveRule, skillXp: string): SkillProgress {
  if (curve.levels.length === 0) {
    throw new Error('SKILL_XP_CURVE_EMPTY');
  }

  const xp = new Decimal(skillXp);
  const ordered = [...curve.levels].sort((left, right) => left.level - right.level);
  const last = ordered[ordered.length - 1];
  if (last === undefined) {
    throw new Error('SKILL_XP_CURVE_EMPTY');
  }
  let selected = last;

  for (const level of ordered) {
    if (xp.lt(new Decimal(level.cumulative_xp))) {
      selected = level;
      break;
    }
  }

  const threshold = new Decimal(selected.cumulative_xp);
  const remaining = Decimal.max(0, threshold.minus(xp));
  const next = selected.level < last.level ? selected.level + 1 : null;

  return {
    level: selected.level,
    xp: decimalString(xp),
    xpToNext: next === null ? '0' : selected.xp_to_next,
    remainingXp: next === null ? '0' : decimalString(remaining),
    nextLevel: next,
    speedModifier: selected.speed_modifier,
    efficiencyModifier: selected.efficiency_modifier,
    stageNode: selected.stage_node,
  };
}
