import type {
  EquipmentInstance,
  EquipmentSlot,
  InventorySnapshot,
  LoadoutPreset,
} from '@dongtian/contracts';

export const EQUIPMENT_SLOT_ORDER: readonly EquipmentSlot[] = ['WEAPON', 'ARMOR', 'ACCESSORY'];

const EQUIPMENT_SLOT_LABELS: Record<EquipmentSlot, string> = {
  WEAPON: '武器',
  ARMOR: '防具',
  ACCESSORY: '饰品',
};

export interface EquipmentSlotComparisonRow {
  readonly slot: EquipmentSlot;
  readonly label: string;
  readonly currentInstanceId: string | null;
  readonly compareInstanceId: string | null;
  readonly currentInstance: EquipmentInstance | null;
  readonly compareInstance: EquipmentInstance | null;
  readonly summary: string;
  readonly diffSummary: string;
  readonly changed: boolean;
}

export interface EquipmentInventorySelectionView {
  readonly instance: EquipmentInstance | null;
  readonly summary: string;
  readonly slotHint: string;
  readonly compareSummary: string;
}

function buildInstanceSummary(instance: EquipmentInstance | null): string {
  if (instance === null) {
    return '未配置';
  }

  const boundLabel = instance.bound ? '已绑定' : '未绑定';
  return `装备 · 强化 +${instance.temper_level} · ${boundLabel}`;
}

function buildInstanceDiff(currentInstance: EquipmentInstance | null, compareInstance: EquipmentInstance | null): string {
  if (currentInstance === null && compareInstance === null) {
    return '当前和比较方案都未装备';
  }

  if (currentInstance === null || compareInstance === null) {
    return currentInstance === null ? '当前未装备，比较方案有装备' : '当前有装备，比较方案未装备';
  }

  const parts = [
    currentInstance.instance_id === compareInstance.instance_id ? '装备相同' : '装备不同',
    currentInstance.temper_level === compareInstance.temper_level
      ? `强化相同 +${currentInstance.temper_level}`
      : `强化差 ${currentInstance.temper_level} / ${compareInstance.temper_level}`,
    currentInstance.bound === compareInstance.bound ? (currentInstance.bound ? '均已绑定' : '均未绑定') : '绑定状态不同',
  ];

  return parts.join(' · ');
}

function buildSlotInstanceMap(preset: LoadoutPreset | null): Map<EquipmentSlot, string | null> {
  const mapping = new Map<EquipmentSlot, string | null>();
  mapping.set('WEAPON', preset?.weapon_instance_id ?? null);
  mapping.set('ARMOR', preset?.armor_instance_id ?? null);
  mapping.set('ACCESSORY', preset?.accessory_instance_id ?? null);
  return mapping;
}

function buildInstanceMap(inventory: InventorySnapshot): Map<string, EquipmentInstance> {
  return new Map(inventory.equipment_instances.map((instance) => [instance.instance_id, instance] as const));
}

export function formatEquipmentSlotLabel(slot: EquipmentSlot): string {
  return EQUIPMENT_SLOT_LABELS[slot];
}

export function summarizeLoadoutPreset(preset: LoadoutPreset | null): string {
  if (preset === null) {
    return '暂无装备方案';
  }

  const completeness = preset.complete ? '完整' : '缺位';
  const effective = preset.effective_next_cycle ? '下周期生效' : '当前生效';
  const active = preset.active ? '已启用' : '未启用';
  return `${preset.name} · ${completeness} · ${effective} · ${active}`;
}

export function buildEquipmentSlotComparisonRows(
  currentPreset: LoadoutPreset | null,
  comparePreset: LoadoutPreset | null,
  inventory: InventorySnapshot,
): ReadonlyArray<EquipmentSlotComparisonRow> {
  const instances = buildInstanceMap(inventory);
  const currentSlotMap = buildSlotInstanceMap(currentPreset);
  const compareSlotMap = buildSlotInstanceMap(comparePreset);

  return EQUIPMENT_SLOT_ORDER.map((slot) => {
    const currentInstanceId = currentSlotMap.get(slot) ?? null;
    const compareInstanceId = compareSlotMap.get(slot) ?? null;
    const currentInstance = currentInstanceId === null ? null : (instances.get(currentInstanceId) ?? null);
    const compareInstance = compareInstanceId === null ? null : (instances.get(compareInstanceId) ?? null);
    return {
      slot,
      label: formatEquipmentSlotLabel(slot),
      currentInstanceId,
      compareInstanceId,
      currentInstance,
      compareInstance,
      summary: `${buildInstanceSummary(currentInstance)} ↔ ${buildInstanceSummary(compareInstance)}`,
      diffSummary: buildInstanceDiff(currentInstance, compareInstance),
      changed: currentInstanceId !== compareInstanceId,
    };
  });
}

export function buildEquipmentSelectionView(
  instanceId: string | null,
  inventory: InventorySnapshot,
  currentPreset: LoadoutPreset | null,
  comparePreset: LoadoutPreset | null,
): EquipmentInventorySelectionView {
  const instances = buildInstanceMap(inventory);
  const instance = instanceId === null ? null : (instances.get(instanceId) ?? null);
  const currentSlots = buildSlotInstanceMap(currentPreset);
  const compareSlots = buildSlotInstanceMap(comparePreset);

  let slotHint = '尚未选中装备';
  if (instance !== null) {
    const currentSlot = EQUIPMENT_SLOT_ORDER.find((slot) => currentSlots.get(slot) === instance.instance_id);
    const compareSlot = EQUIPMENT_SLOT_ORDER.find((slot) => compareSlots.get(slot) === instance.instance_id);
    const hints = [
      currentSlot ? `当前预设中是${formatEquipmentSlotLabel(currentSlot)}` : '当前预设未使用',
      compareSlot ? `比较预设中是${formatEquipmentSlotLabel(compareSlot)}` : '比较预设未使用',
    ];
    slotHint = hints.join(' · ');
  }

  const currentSlot = instance === null ? null : EQUIPMENT_SLOT_ORDER.find((slot) => currentSlots.get(slot) === instance.instance_id) ?? null;
  const compareSlot = currentSlot ?? (instance === null ? null : EQUIPMENT_SLOT_ORDER.find((slot) => compareSlots.get(slot) === instance.instance_id) ?? null);
  const currentSlotInstance = currentSlot === null ? instance : (currentSlots.get(currentSlot) === null ? null : instances.get(currentSlots.get(currentSlot) ?? '') ?? null);
  const compareSlotInstance = compareSlot === null ? null : (compareSlots.get(compareSlot) === null ? null : instances.get(compareSlots.get(compareSlot) ?? '') ?? null);

  return {
    instance,
    summary: buildInstanceSummary(instance),
    slotHint,
    compareSummary: currentSlot === null
      ? buildInstanceDiff(instance, compareSlotInstance)
      : buildInstanceDiff(currentSlotInstance, compareSlotInstance),
  };
}

export function summarizeEquipmentError(status: number, _code: string | undefined, _details: unknown): string {
  if (status === 404) {
    return '预设或装备不存在，或不属于当前角色。';
  }

  if (status === 403) {
    return '当前会话已认证，但没有读取或修改该预设的权限。';
  }

  if (status === 409) {
    return '当前状态已变化，请刷新后重试。';
  }

  if (status === 422) {
    return '当前装备选择未能生效，请稍后重试。';
  }

  if (status === 400) {
    return '请求参数不合法。';
  }

  return status >= 500 ? '暂时无法读取装备状态，请稍后重试。' : '装备操作暂时未完成，请检查条件后重试。';
}
