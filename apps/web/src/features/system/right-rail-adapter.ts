import type { CaveResponse, CharacterProgression, InventorySnapshot, LoadoutPreset, SkillToolAssignmentsResponse } from '@dongtian/contracts';

import { describeItemId, describeSkillId, formatCount } from '../content/content-adapter.js';

export interface InventoryRailSummary { readonly items: ReadonlyArray<{ readonly key: string; readonly label: string; readonly quantity: string }>; readonly count: number }
export interface EquipmentRailSummary { readonly slots: ReadonlyArray<{ readonly label: string; readonly value: string }> }
export interface SkillsRailSummary { readonly skills: ReadonlyArray<{ readonly label: string; readonly value: string }>; readonly cultivation: string }
export interface CaveRailSummary { readonly facilities: ReadonlyArray<{ readonly label: string; readonly value: string }> }
export interface LoadoutRailSummary { readonly name: string; readonly status: string; readonly consumables: string }

const slotLabels = [
  ['武器', 'weapon_instance_id'],
  ['防具', 'armor_instance_id'],
  ['饰品', 'accessory_instance_id'],
] as const;

function findEquipment(inventory: InventorySnapshot, instanceId: string | null) {
  return instanceId === null ? null : inventory.equipment_instances.find((instance) => instance.instance_id === instanceId) ?? null;
}

function itemLabel(id: string, fallback = '未知物品'): string {
  const suffix = id.split('.').at(-1) ?? id;
  const labels: Record<string, string> = { iron_sword: '铁剑', qi_gathering_pill: '聚气丹' };
  if (labels[suffix] !== undefined) return labels[suffix];
  const known = describeItemId(id);
  return known !== '未鉴定物品' ? known : fallback;
}

export function buildInventoryRailSummary(inventory: InventorySnapshot): InventoryRailSummary {
  const assets = [...inventory.items.map((asset, index) => ({ asset, index })), ...inventory.currencies.map((asset, index) => ({ asset, index }))].slice(0, 12);
  return { items: assets.map(({ asset, index }) => ({ key: `${asset.asset_type}:${asset.asset_id}:${index}`, label: asset.asset_type === 'CURRENCY' && asset.asset_id === 'currency.spirit_stone' ? '灵石' : itemLabel(asset.asset_id), quantity: formatCount(asset.available_quantity) })), count: inventory.total_count };
}

export function buildEquipmentRailSummary(preset: LoadoutPreset, inventory: InventorySnapshot): EquipmentRailSummary {
  return { slots: slotLabels.map(([label, key]) => {
    const instance = findEquipment(inventory, preset[key]);
    return { label, value: instance === null ? '未装备' : `${itemLabel(instance.item_id, '未鉴定装备')} · +${instance.temper_level}` };
  }) };
}

export function buildSkillsRailSummary(progression: CharacterProgression, assignments: SkillToolAssignmentsResponse | null): SkillsRailSummary {
  const skills = progression.skills.length > 0
    ? progression.skills
    : (assignments?.assignments.map((assignment) => ({ skill_id: assignment.skill_id, level: 0, xp: '0', xp_to_next: '0' })) ?? []);
  return {
    skills: skills.slice(0, 4).map((skill) => {
      const label = describeSkillId(skill.skill_id);
      return { label: label === skill.skill_id ? '未知技能' : label, value: `Lv.${skill.level} · XP ${formatCount(skill.xp)}/${formatCount(skill.xp_to_next)}` };
    }),
    cultivation: `${progression.cultivation.realm_stage_id === 'realm.mortal.entry' ? '炼气入门' : '修行中'} · 修为 ${formatCount(progression.cultivation.stage_progress_xp)}/${formatCount(progression.cultivation.stage_required_xp)}`,
  };
}

export function buildCaveRailSummary(response: CaveResponse): CaveRailSummary {
  const facilityLabels: Record<string, string> = {
    JULING_ROOM: '聚灵室',
    ALCHEMY_ROOM: '炼丹房',
    FORGING_ROOM: '炼器房',
    'facility.juling': '聚灵室',
    'facility.alchemy': '炼丹房',
    'facility.forging': '炼器房',
  };
  return { facilities: response.cave.facilities.slice(0, 4).map((facility) => {
    const buildStatus = facility.build_task?.status;
    const statusLabel = buildStatus === undefined || buildStatus === null
      ? '运行中'
      : buildStatus === 'RUNNING'
        ? '建设中'
        : buildStatus === 'COMPLETED'
          ? '已完成'
          : '状态未知';
    return { label: facilityLabels[facility.facility_kind] ?? facilityLabels[facility.facility_config_id] ?? '未识别设施', value: `Lv.${facility.level} · ${statusLabel}` };
  }) };
}

export function buildLoadoutRailSummary(preset: LoadoutPreset): LoadoutRailSummary {
  const missingLabels = [preset.weapon_instance_id === null ? '武器' : null, preset.armor_instance_id === null ? '防具' : null, preset.accessory_instance_id === null ? '饰品' : null].filter((label): label is string => label !== null);
  const status = preset.active ? '当前生效' : '未启用';
  return { name: preset.name, status: `${status} · ${missingLabels.length === 0 ? '配置完整' : `缺少${missingLabels.join('和')}`}`, consumables: preset.combat_consumables.length === 0 ? '无补给' : preset.combat_consumables.map((item) => `${itemLabel(item.item_id)} × ${formatCount(item.quantity)}`).join(' · ') };
}
