import type { PlayerState } from './types.ts';

/**
 * Proposal-v1 cumulative curve. Level 1 starts at zero XP; reaching level N
 * requires 100 * (N - 1)^2 total XP. XP remains the durable source of truth.
 */
export const skillXpForLevel = (level: number): number => {
  if (!Number.isSafeInteger(level) || level < 1) throw new RangeError('skill level must be a positive integer');
  const required = 100 * (level - 1) ** 2;
  if (!Number.isSafeInteger(required)) throw new RangeError('skill level threshold exceeds safe integer range');
  return required;
};

export const levelFromXp = (xp: number): number => {
  if (!Number.isFinite(xp) || xp < 0) return 1;
  const boundedXp = Math.min(Math.floor(xp), Number.MAX_SAFE_INTEGER);
  return Math.max(1, Math.floor(Math.sqrt(boundedXp / 100)) + 1);
};

export type SkillLevelSnapshot = {
  technique: Record<string, number>;
  herbalism: number;
  mining: number;
  alchemy: number;
  forge: number;
};

export const skillXpTotal = (player: Pick<PlayerState, 'skillProgress'>, type: 'technique' | 'herbalism' | 'mining' | 'alchemy' | 'forge'): number => {
  if (type === 'technique') return Object.values(player.skillProgress.techniqueXp).reduce((sum, xp) => sum + Math.max(0, Number(xp) || 0), 0);
  return Math.max(0, Number(player.skillProgress[`${type}Xp` as 'herbalismXp' | 'miningXp' | 'alchemyXp' | 'forgeXp']) || 0);
};

export const skillLevelsFromProgress = (progress: PlayerState['skillProgress']): SkillLevelSnapshot => ({
  technique: Object.fromEntries(Object.entries(progress.techniqueXp).map(([id, xp]) => [id, levelFromXp(xp)])),
  herbalism: levelFromXp(progress.herbalismXp),
  mining: levelFromXp(progress.miningXp),
  alchemy: levelFromXp(progress.alchemyXp),
  forge: levelFromXp(progress.forgeXp),
});
