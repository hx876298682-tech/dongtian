import type { EquipmentInstance, InventorySnapshot, TemperingAttemptResponse } from '@dongtian/contracts';

import { describeItemId, formatCount, summarizeInventoryAsset } from '../content/content-adapter.js';

export type EquipmentFilterMode = 'all' | 'bound' | 'unbound' | 'duplicates' | 'temperable';
export type EquipmentSortMode = 'recent' | 'item' | 'temper-level' | 'duplicates';

export interface TemperingLadderRow {
  readonly targetLevel: number;
  readonly successProbability: string;
  readonly temperingStoneCost: string;
  readonly spiritStoneCost: string;
  readonly sameEquipmentCost: string;
  readonly protectionMaterialCost: string;
  readonly locked: boolean;
  readonly conditionLabel: string;
}

export interface EquipmentLootSummary {
  readonly duplicates: number;
  readonly sameItemMaterialCount: number;
  readonly materialSummary: string;
  readonly stageSummary: string;
}

const LADDERS: readonly TemperingLadderRow[] = [
  {
    targetLevel: 1,
    successProbability: '0.95',
    temperingStoneCost: '1',
    spiritStoneCost: '20',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    locked: false,
    conditionLabel: '+1 可提交',
  },
  {
    targetLevel: 2,
    successProbability: '0.85',
    temperingStoneCost: '1',
    spiritStoneCost: '34',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    locked: false,
    conditionLabel: '+2 可提交',
  },
  {
    targetLevel: 3,
    successProbability: '0.72',
    temperingStoneCost: '2',
    spiritStoneCost: '57.8',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    locked: false,
    conditionLabel: '+3 可提交',
  },
  {
    targetLevel: 4,
    successProbability: '0.58',
    temperingStoneCost: '2',
    spiritStoneCost: '98.26',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    locked: false,
    conditionLabel: '+4 可提交',
  },
  {
    targetLevel: 5,
    successProbability: '0.45',
    temperingStoneCost: '3',
    spiritStoneCost: '167.04199999999997',
    sameEquipmentCost: '0',
    protectionMaterialCost: '0',
    locked: false,
    conditionLabel: '+5 可提交',
  },
  {
    targetLevel: 6,
    successProbability: '0.34',
    temperingStoneCost: '3',
    spiritStoneCost: '283.97139999999996',
    sameEquipmentCost: '100',
    protectionMaterialCost: '0',
    locked: false,
    conditionLabel: '+6 可提交',
  },
  {
    targetLevel: 7,
    successProbability: '0.25',
    temperingStoneCost: '4',
    spiritStoneCost: '482.7513799999999',
    sameEquipmentCost: '200',
    protectionMaterialCost: '0',
    locked: true,
    conditionLabel: '+7 以上锁定',
  },
];

export const TEMPERING_LADDER = LADDERS;

export function buildEquipmentLootSummary(instance: EquipmentInstance, duplicates: number): EquipmentLootSummary {
  return {
    duplicates,
    sameItemMaterialCount: Math.max(0, duplicates - 1),
    materialSummary: `${instance.item_id} · 同类 ${formatCount(Math.max(0, duplicates - 1))} 件可作为同类淬炼材料`,
    stageSummary: duplicates > 0 ? '+1~+6 可用，+7 以上锁定' : '暂无同类材料',
  };
}

export function summarizeTemperingResponse(response: TemperingAttemptResponse | null): string {
  if (response === null) {
    return '尚未提交淬炼';
  }

  const outcome = response.success ? '成功' : response.outcome === 'REJECTED' ? '被拒绝' : '失败';
  return `${outcome} · ${describeItemId(response.equipment.item_id)} · +${response.level_before} → +${response.level_after}`;
}

export function summarizeEquipmentAvailability(instance: EquipmentInstance, inventory: InventorySnapshot): string {
  const matched = inventory.items.find((item) => item.asset_id === instance.item_id) ?? null;
  if (matched === null) {
    return '这件装备没有对应的可堆叠物品库存，只能作为独立装备进行比较与淬炼。';
  }

  return summarizeInventoryAsset(matched);
}

export function filterEquipmentInstances(
  inventory: InventorySnapshot,
  options: {
    readonly query: string;
    readonly mode: EquipmentFilterMode;
    readonly sortMode: EquipmentSortMode;
  },
): readonly EquipmentInstance[] {
  const normalizedQuery = options.query.trim().toLowerCase();
  const duplicateCounts = new Map<string, number>();
  for (const instance of inventory.equipment_instances) {
    duplicateCounts.set(instance.item_id, (duplicateCounts.get(instance.item_id) ?? 0) + 1);
  }

  const filtered = inventory.equipment_instances.filter((instance) => {
    if (options.mode === 'bound' && !instance.bound) {
      return false;
    }
    if (options.mode === 'unbound' && instance.bound) {
      return false;
    }
    if (options.mode === 'duplicates' && (duplicateCounts.get(instance.item_id) ?? 0) < 2) {
      return false;
    }
    if (options.mode === 'temperable' && instance.temper_level >= 6) {
      return false;
    }
    if (normalizedQuery.length === 0) {
      return true;
    }
    return [
      instance.instance_id,
      instance.item_id,
      String(instance.temper_level),
      instance.bound ? 'bound' : 'unbound',
      String(duplicateCounts.get(instance.item_id) ?? 0),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  const sorted = [...filtered].sort((left, right) => {
    if (options.sortMode === 'item') {
      return left.item_id.localeCompare(right.item_id) || left.instance_id.localeCompare(right.instance_id);
    }
    if (options.sortMode === 'temper-level') {
      return right.temper_level - left.temper_level || left.instance_id.localeCompare(right.instance_id);
    }
    if (options.sortMode === 'duplicates') {
      const leftCount = duplicateCounts.get(left.item_id) ?? 0;
      const rightCount = duplicateCounts.get(right.item_id) ?? 0;
      return rightCount - leftCount || right.temper_level - left.temper_level || left.instance_id.localeCompare(right.instance_id);
    }
    return right.instance_id.localeCompare(left.instance_id);
  });

  return sorted;
}

export function getEquipmentDuplicateCount(inventory: InventorySnapshot, itemId: string): number {
  return inventory.equipment_instances.reduce((count, instance) => (instance.item_id === itemId ? count + 1 : count), 0);
}
