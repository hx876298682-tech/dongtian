import type { ActionCatalogEntry, SkillProgression } from '@dongtian/contracts';

export interface CultivationDirection {
  readonly id: 'qi' | 'body' | 'sword' | 'blade';
  readonly label: string;
  readonly description: string;
  readonly actionId: string | null;
  readonly unavailableReason: string;
}

export const CULTIVATION_DIRECTIONS: readonly CultivationDirection[] = [
  { id: 'qi', label: '练气', description: '吐纳灵气，稳定提升修为。', actionId: 'action.cultivation.qi', unavailableReason: '' },
] as const;

export function getCultivationDirections(): readonly CultivationDirection[] { return CULTIVATION_DIRECTIONS; }

export function findCultivationAction(direction: CultivationDirection, actions: readonly ActionCatalogEntry[]): ActionCatalogEntry | null {
  if (direction.actionId === null) return null;
  return actions.find((action) => action.action_id === direction.actionId) ?? null;
}

export function isCultivationDirectionAvailable(direction: CultivationDirection, actions: readonly ActionCatalogEntry[]): boolean {
  const action = findCultivationAction(direction, actions);
  return action !== null && action.enabled && action.unlocked && action.can_add_to_queue && action.allowed_queue_modes.includes('INFINITE');
}

export interface WeaponMastery {
  readonly id: 'sword' | 'blade' | 'spear' | 'staff';
  readonly label: string;
  readonly description: string;
  readonly skillId: string;
  readonly actionId: string;
  readonly weaponTag: string;
}

export const WEAPON_MASTERIES: readonly WeaponMastery[] = [
  { id: 'sword', label: '练剑', description: '磨砺剑意，提升装备剑类武器时的攻击。', skillId: 'skill.weapon_mastery.sword', actionId: 'action.weapon_mastery.sword', weaponTag: 'sword' },
  { id: 'blade', label: '练刀', description: '锤炼刀势，提升装备刀类武器时的攻击。', skillId: 'skill.weapon_mastery.blade', actionId: 'action.weapon_mastery.blade', weaponTag: 'blade' },
  { id: 'spear', label: '练枪', description: '凝练枪势，提升装备枪类武器时的攻击。', skillId: 'skill.weapon_mastery.spear', actionId: 'action.weapon_mastery.spear', weaponTag: 'spear' },
  { id: 'staff', label: '练杖', description: '感悟杖法，提升装备杖类武器时的攻击。', skillId: 'skill.weapon_mastery.staff', actionId: 'action.weapon_mastery.staff', weaponTag: 'staff' },
] as const;

export function getWeaponMasteries(): readonly WeaponMastery[] { return WEAPON_MASTERIES; }

export type CultivationChoice =
  | { readonly kind: 'direction'; readonly label: string; readonly direction: CultivationDirection }
  | { readonly kind: 'weapon'; readonly label: string; readonly mastery: WeaponMastery };

export function getCultivationChoices(): readonly CultivationChoice[] {
  return [
    ...CULTIVATION_DIRECTIONS.map((direction) => ({ kind: 'direction' as const, label: direction.label, direction })),
    ...WEAPON_MASTERIES.map((mastery) => ({ kind: 'weapon' as const, label: mastery.label, mastery })),
  ];
}

export function findWeaponMasteryAction(mastery: WeaponMastery, actions: readonly ActionCatalogEntry[]): ActionCatalogEntry | null {
  return actions.find((action) => action.action_id === mastery.actionId && action.skill_id === mastery.skillId) ?? null;
}

export function findWeaponMasteryProgression(mastery: WeaponMastery, skills: readonly SkillProgression[]): SkillProgression | null {
  return skills.find((skill) => skill.skill_id === mastery.skillId) ?? null;
}

export function isWeaponMasteryAvailable(mastery: WeaponMastery, actions: readonly ActionCatalogEntry[]): boolean {
  const action = findWeaponMasteryAction(mastery, actions);
  return action !== null && action.enabled && action.unlocked && action.can_add_to_queue && action.allowed_queue_modes.includes('INFINITE');
}
