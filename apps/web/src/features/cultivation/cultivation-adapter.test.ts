import { describe, expect, it } from 'vitest';
import type { ActionCatalogEntry, SkillProgression } from '@dongtian/contracts';
import { findCultivationAction, getCultivationChoices, getCultivationDirections, getWeaponMasteries, findWeaponMasteryAction, findWeaponMasteryProgression, isCultivationDirectionAvailable, isWeaponMasteryAvailable } from './cultivation-adapter.js';

const action = { action_id: 'action.cultivation.qi', enabled: true, unlocked: true, can_add_to_queue: true, allowed_queue_modes: ['INFINITE'] } as unknown as ActionCatalogEntry;

describe('cultivation catalog', () => {
  it('exposes the non-weapon directions and maps the configured qi action', () => {
    const directions = getCultivationDirections();
    expect(directions.map((direction) => direction.label)).toEqual(['练气']);
    expect(findCultivationAction(directions[0]!, [action])).toBe(action);
    expect(isCultivationDirectionAvailable(directions[0]!, [action])).toBe(true);
  });

  it('only presents cultivation routes backed by real actions', () => {
    const choices = getCultivationChoices();
    expect(choices.map((choice) => choice.label)).toEqual(['练气', '练剑', '练刀', '练枪', '练杖']);
    expect(choices.map((choice) => choice.kind)).toEqual(['direction', 'weapon', 'weapon', 'weapon', 'weapon']);
  });

  it('maps all weapon masteries to their real infinite actions and progression', () => {
    const masteries = getWeaponMasteries();
    expect(masteries.map((mastery) => mastery.label)).toEqual(['练剑', '练刀', '练枪', '练杖']);
    const swordAction = { action_id: 'action.weapon_mastery.sword', skill_id: 'skill.weapon_mastery.sword', enabled: true, unlocked: true, can_add_to_queue: true, allowed_queue_modes: ['INFINITE'] } as unknown as ActionCatalogEntry;
    const swordProgression = { skill_id: 'skill.weapon_mastery.sword', level: 3, xp: '206', attack_bonus_per_level: '0.02' } as unknown as SkillProgression;
    expect(findWeaponMasteryAction(masteries[0]!, [swordAction])).toBe(swordAction);
    expect(findWeaponMasteryProgression(masteries[0]!, [swordProgression])).toBe(swordProgression);
    expect(isWeaponMasteryAvailable(masteries[0]!, [swordAction])).toBe(true);
    expect(isWeaponMasteryAvailable(masteries[1]!, [swordAction])).toBe(false);
  });
});
