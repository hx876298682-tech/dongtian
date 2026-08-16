import Decimal from 'decimal.js';

export type LootEquipmentSlot = 'WEAPON' | 'ARMOR' | 'ACCESSORY' | 'TOOL';
export type LootDecisionAction = 'EQUIP' | 'KEEP' | 'VIEW';
export type LootSlotCompatibility = 'MATCH' | 'ADAPTABLE' | 'MISMATCH' | 'NOT_APPLICABLE';
export type LootComparisonVerdict = 'BETTER' | 'SAME' | 'WORSE' | 'NOT_COMPARABLE';
export type LootMaterialSourceKind = 'production' | 'cave' | 'breakthrough' | 'tempering' | 'market';
export type LootTemperingAvailabilityStatus = 'AVAILABLE' | 'LOCKED';

export type LootItemConfigLike = {
  readonly id: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly realm_required: string;
  readonly enabled: boolean;
  readonly deprecated: boolean;
  readonly stackable: boolean;
  readonly trade_policy: string;
  readonly npc_floor_price?: string | null | undefined;
  readonly market_reference_price?: string | null | undefined;
};

export type LootEquipmentConfigLike = {
  readonly item_id: string;
  readonly slot: LootEquipmentSlot;
  readonly attack?: number;
  readonly defense?: number;
  readonly hp?: number;
  readonly speed?: number;
  readonly power_index?: number;
  readonly equip_requirements?: {
    readonly required_realm: string | null;
    readonly required_tags: readonly string[];
  } | undefined;
  readonly modifier_ids?: readonly string[] | undefined;
  readonly temperable?: boolean | undefined;
  readonly max_temper_level?: number | undefined;
  readonly tool_effects?: readonly unknown[] | undefined;
  readonly npc_floor_price?: string | null | undefined;
  readonly market_reference_price?: string | null | undefined;
};

export type LootEquipmentInstanceLike = {
  readonly instance_id: string;
  readonly item_id: string;
  readonly temper_level?: number;
  readonly bound?: boolean;
  readonly created_transaction_id?: string | null;
};

export type LootPresetSnapshotLike = {
  readonly preset_id: string;
  readonly active: boolean;
  readonly weapon_instance_id: string | null;
  readonly armor_instance_id: string | null;
  readonly accessory_instance_id: string | null;
};

export type LootMaterialUseInput = {
  readonly itemId: string;
  readonly sourceKind: LootMaterialSourceKind;
  readonly sourceId: string;
  readonly quantity?: string | number | bigint;
  readonly lockedReasonKey?: string | null;
  readonly stageId?: string | null;
};

export type LootMaterialUse = {
  readonly itemId: string;
  readonly sourceKind: Exclude<LootMaterialSourceKind, 'market'>;
  readonly sourceId: string;
  readonly quantity: string;
  readonly lockedReasonKey: string | null;
  readonly stageId: string | null;
};

export type LootMaterialUseSummary = {
  readonly itemId: string;
  readonly uses: readonly LootMaterialUse[];
  readonly sourceIds: readonly string[];
};

export type LootTemperingFutureUse = {
  readonly useId: 'tempering_same_item_material';
  readonly itemId: string;
  readonly sourceInstanceId: string | null;
  readonly status: LootTemperingAvailabilityStatus;
  readonly requiredFeatureId: 'feature.tempering';
  readonly requiredStageId: string;
  readonly lockedReasonKey: string | null;
};

export type LootEquipmentStatSnapshot = {
  readonly itemId: string;
  readonly slot: LootEquipmentSlot;
  readonly attack: number;
  readonly defense: number;
  readonly hp: number;
  readonly speed: string;
  readonly powerIndex: number;
  readonly equipRequiredRealm: string | null;
  readonly equipRequiredTags: readonly string[];
  readonly temperable: boolean;
  readonly maxTemperLevel: number;
  readonly missingAttributes: readonly LootEquipmentAttribute[];
  readonly ignoredMarketFields: readonly string[];
};

export type LootEquipmentAttribute = 'attack' | 'defense' | 'hp' | 'speed' | 'power_index';

export type LootEquipmentComparisonInput = {
  readonly candidateItem: LootItemConfigLike;
  readonly candidateEquipment: LootEquipmentConfigLike;
  readonly currentItem?: LootItemConfigLike | null;
  readonly currentEquipment?: LootEquipmentConfigLike | null;
  readonly currentPreset?: LootPresetSnapshotLike | null;
  readonly candidateInstance?: LootEquipmentInstanceLike | null;
  readonly currentInstance?: LootEquipmentInstanceLike | null;
  readonly duplicateInstanceCount?: number;
};

export type LootEquipmentComparison = {
  readonly candidateItemId: string;
  readonly candidateInstanceId: string | null;
  readonly currentItemId: string | null;
  readonly currentInstanceId: string | null;
  readonly currentPresetId: string | null;
  readonly slot: LootEquipmentSlot;
  readonly slotCompatibility: LootSlotCompatibility;
  readonly verdict: LootComparisonVerdict;
  readonly action: LootDecisionAction;
  readonly comparisonTargetItemId: string | null;
  readonly comparisonTargetInstanceId: string | null;
  readonly attackDelta: number;
  readonly defenseDelta: number;
  readonly hpDelta: number;
  readonly speedDelta: string;
  readonly powerIndexDelta: number;
  readonly candidate: LootEquipmentStatSnapshot;
  readonly target: LootEquipmentStatSnapshot | null;
  readonly duplicateInstanceCount: number;
  readonly reasons: readonly string[];
};

export type LootTemperingAvailabilityInput = {
  readonly enabled: boolean;
  readonly requiredStageId: string;
  readonly lockedReasonKey?: string | null;
};

export type LootDecisionInput = {
  readonly item: LootItemConfigLike;
  readonly equipment?: LootEquipmentConfigLike | null;
  readonly currentItem?: LootItemConfigLike | null;
  readonly currentEquipment?: LootEquipmentConfigLike | null;
  readonly currentPreset?: LootPresetSnapshotLike | null;
  readonly candidateInstance?: LootEquipmentInstanceLike | null;
  readonly currentInstance?: LootEquipmentInstanceLike | null;
  readonly duplicateInstanceCount?: number;
  readonly materialUses?: readonly LootMaterialUseInput[];
  readonly temperingAvailability?: LootTemperingAvailabilityInput | null;
};

export type LootDecision = {
  readonly itemId: string;
  readonly category: string;
  readonly action: LootDecisionAction;
  readonly reasons: readonly string[];
  readonly equipmentComparison: LootEquipmentComparison | null;
  readonly futureTemperingUse: LootTemperingFutureUse | null;
  readonly materialUseSummary: LootMaterialUseSummary | null;
  readonly ignoredMarketFields: readonly string[];
};

const MAX_SMALL_DECIMAL_SCALE = 6;

type NormalizedLootItemConfig = {
  readonly id: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly realm_required: string;
  readonly enabled: boolean;
  readonly deprecated: boolean;
  readonly stackable: boolean;
  readonly trade_policy: string;
  readonly npc_floor_price: string | null;
  readonly market_reference_price: string | null;
};

type NormalizedLootEquipmentConfig = {
  readonly item_id: string;
  readonly slot: LootEquipmentSlot;
  readonly attack: number;
  readonly defense: number;
  readonly hp: number;
  readonly speed: number;
  readonly power_index: number;
  readonly equip_requirements: {
    readonly required_realm: string | null;
    readonly required_tags: readonly string[];
  } | null;
  readonly modifier_ids: readonly string[];
  readonly temperable: boolean;
  readonly max_temper_level: number;
  readonly tool_effects: readonly unknown[] | undefined;
  readonly npc_floor_price: string | null;
  readonly market_reference_price: string | null;
};

function fail(code: string): never {
  throw new Error(code);
}

function requireTrimmedString(value: string, field: string): string {
  if (value.trim().length === 0) {
    fail(`LOOT_${field}_REQUIRED`);
  }
  return value;
}

function toDecimalString(value: Decimal): string {
  return value.toFixed(MAX_SMALL_DECIMAL_SCALE).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function normalizeDecimal(value: unknown, field: string, allowNegative = false): Decimal {
  const parsed = new Decimal(String(value));
  if (!parsed.isFinite() || (!allowNegative && parsed.isNegative())) {
    fail(`LOOT_${field}_INVALID`);
  }
  return parsed;
}

function normalizeInteger(value: unknown, field: string, allowNegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || (!allowNegative && value < 0)) {
    fail(`LOOT_${field}_INVALID`);
  }
  return value;
}

function normalizeOptionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return normalizeInteger(value, field);
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const stringValue = String(value).trim();
  return stringValue.length === 0 ? null : stringValue;
}

function readSlotTag(slot: LootEquipmentSlot): string {
  switch (slot) {
    case 'WEAPON':
      return 'weapon';
    case 'ARMOR':
      return 'armor';
    case 'ACCESSORY':
      return 'accessory';
    case 'TOOL':
      return 'tool';
  }
}

function normalizeItemConfig(item: LootItemConfigLike): NormalizedLootItemConfig {
  const id = requireTrimmedString(item.id, 'ITEM_ID');
  const category = requireTrimmedString(item.category, 'ITEM_CATEGORY');
  const tags = Array.from(item.tags ?? [], (tag) => requireTrimmedString(tag, 'ITEM_TAG'));
  const realmRequired = requireTrimmedString(item.realm_required, 'ITEM_REALM_REQUIRED');
  const enabled = Boolean(item.enabled);
  const deprecated = Boolean(item.deprecated);
  const stackable = Boolean(item.stackable);
  const tradePolicy = requireTrimmedString(item.trade_policy, 'ITEM_TRADE_POLICY');

  return {
    id,
    category,
    tags,
    realm_required: realmRequired,
    enabled,
    deprecated,
    stackable,
    trade_policy: tradePolicy,
    npc_floor_price: normalizeOptionalString(item.npc_floor_price),
    market_reference_price: normalizeOptionalString(item.market_reference_price),
  };
}

function normalizeEquipmentConfig(equipment: LootEquipmentConfigLike): NormalizedLootEquipmentConfig {
  const itemId = requireTrimmedString(equipment.item_id, 'EQUIPMENT_ITEM_ID');
  const slot = equipment.slot;
  if (slot !== 'WEAPON' && slot !== 'ARMOR' && slot !== 'ACCESSORY' && slot !== 'TOOL') {
    fail(`LOOT_EQUIPMENT_SLOT_INVALID:${slot}`);
  }
  const equipRequirements = equipment.equip_requirements;
  const attack = normalizeOptionalInteger(equipment.attack, 'EQUIPMENT_ATTACK') ?? 0;
  const defense = normalizeOptionalInteger(equipment.defense, 'EQUIPMENT_DEFENSE') ?? 0;
  const hp = normalizeOptionalInteger(equipment.hp, 'EQUIPMENT_HP') ?? 0;
  const speed = equipment.speed === undefined || equipment.speed === null
    ? 0
    : normalizeDecimal(equipment.speed, 'EQUIPMENT_SPEED', true).toNumber();
  const powerIndex = normalizeOptionalInteger(equipment.power_index, 'EQUIPMENT_POWER_INDEX') ?? 0;
  const temperable = equipment.temperable === undefined ? true : Boolean(equipment.temperable);
  const maxTemperLevel = normalizeOptionalInteger(equipment.max_temper_level, 'EQUIPMENT_MAX_TEMPER_LEVEL') ?? 0;
  const modifierIds = Array.from(equipment.modifier_ids ?? [], (modifierId) => requireTrimmedString(modifierId, 'EQUIPMENT_MODIFIER_ID'));
  const toolEffects = equipment.tool_effects === undefined ? undefined : [...equipment.tool_effects];

  return {
    item_id: itemId,
    slot,
    attack,
    defense,
    hp,
    speed,
    power_index: powerIndex,
    equip_requirements: equipRequirements === undefined || equipRequirements === null
      ? null
      : {
          required_realm: normalizeOptionalString(equipRequirements.required_realm),
          required_tags: Array.from(equipRequirements.required_tags ?? [], (tag) => requireTrimmedString(tag, 'EQUIPMENT_REQUIRED_TAG')),
        },
    modifier_ids: modifierIds,
    temperable,
    max_temper_level: maxTemperLevel,
    tool_effects: toolEffects,
    npc_floor_price: normalizeOptionalString(equipment.npc_floor_price),
    market_reference_price: normalizeOptionalString(equipment.market_reference_price),
  };
}

function normalizeEquipmentInstance(instance: LootEquipmentInstanceLike | null | undefined): LootEquipmentInstanceLike | null {
  if (instance === null || instance === undefined) {
    return null;
  }
  return {
    instance_id: requireTrimmedString(instance.instance_id, 'INSTANCE_ID'),
    item_id: requireTrimmedString(instance.item_id, 'INSTANCE_ITEM_ID'),
    temper_level: normalizeOptionalInteger(instance.temper_level, 'TEMPER_LEVEL') ?? 0,
    bound: instance.bound === undefined ? false : Boolean(instance.bound),
    created_transaction_id: normalizeOptionalString(instance.created_transaction_id),
  };
}

function normalizePreset(preset: LootPresetSnapshotLike | null | undefined): LootPresetSnapshotLike | null {
  if (preset === null || preset === undefined) {
    return null;
  }
  return {
    preset_id: requireTrimmedString(preset.preset_id, 'PRESET_ID'),
    active: Boolean(preset.active),
    weapon_instance_id: normalizeOptionalString(preset.weapon_instance_id),
    armor_instance_id: normalizeOptionalString(preset.armor_instance_id),
    accessory_instance_id: normalizeOptionalString(preset.accessory_instance_id),
  };
}

function equipmentSnapshot(
  item: LootItemConfigLike,
  equipment: LootEquipmentConfigLike,
): LootEquipmentStatSnapshot {
  const normalizedItem = normalizeItemConfig(item);
  const normalizedEquipment = normalizeEquipmentConfig(equipment);
  const missingAttributes: LootEquipmentAttribute[] = [];

  if (equipment.attack === undefined) {
    missingAttributes.push('attack');
  }
  if (equipment.defense === undefined) {
    missingAttributes.push('defense');
  }
  if (equipment.hp === undefined) {
    missingAttributes.push('hp');
  }
  if (equipment.speed === undefined) {
    missingAttributes.push('speed');
  }
  if (equipment.power_index === undefined) {
    missingAttributes.push('power_index');
  }

  const marketFields = new Set<string>();
  if (item.npc_floor_price !== undefined) {
    marketFields.add('npc_floor_price');
  }
  if (item.market_reference_price !== undefined) {
    marketFields.add('market_reference_price');
  }
  if (equipment.npc_floor_price !== undefined) {
    marketFields.add('npc_floor_price');
  }
  if (equipment.market_reference_price !== undefined) {
    marketFields.add('market_reference_price');
  }

  return {
    itemId: normalizedItem.id,
    slot: normalizedEquipment.slot,
    attack: normalizedEquipment.attack,
    defense: normalizedEquipment.defense,
    hp: normalizedEquipment.hp,
    speed: toDecimalString(new Decimal(normalizedEquipment.speed)),
    powerIndex: normalizedEquipment.power_index,
    equipRequiredRealm: normalizedEquipment.equip_requirements?.required_realm ?? null,
    equipRequiredTags: normalizedEquipment.equip_requirements?.required_tags ?? [],
    temperable: normalizedEquipment.temperable,
    maxTemperLevel: normalizedEquipment.max_temper_level,
    missingAttributes,
    ignoredMarketFields: [...marketFields],
  };
}

function compareStats(current: LootEquipmentStatSnapshot | null, candidate: LootEquipmentStatSnapshot): {
  readonly verdict: LootComparisonVerdict;
  readonly attackDelta: number;
  readonly defenseDelta: number;
  readonly hpDelta: number;
  readonly speedDelta: string;
  readonly powerIndexDelta: number;
} {
  if (current === null) {
    return {
      verdict: 'NOT_COMPARABLE',
      attackDelta: candidate.attack,
      defenseDelta: candidate.defense,
      hpDelta: candidate.hp,
      speedDelta: candidate.speed,
      powerIndexDelta: candidate.powerIndex,
    };
  }

  const attackDelta = candidate.attack - current.attack;
  const defenseDelta = candidate.defense - current.defense;
  const hpDelta = candidate.hp - current.hp;
  const speedDelta = toDecimalString(new Decimal(candidate.speed).minus(current.speed));
  const powerIndexDelta = candidate.powerIndex - current.powerIndex;

  if (powerIndexDelta > 0) {
    return {
      verdict: 'BETTER',
      attackDelta,
      defenseDelta,
      hpDelta,
      speedDelta,
      powerIndexDelta,
    };
  }
  if (powerIndexDelta < 0) {
    return {
      verdict: 'WORSE',
      attackDelta,
      defenseDelta,
      hpDelta,
      speedDelta,
      powerIndexDelta,
    };
  }

  if (attackDelta === 0 && defenseDelta === 0 && hpDelta === 0 && new Decimal(speedDelta).isZero()) {
    return {
      verdict: 'SAME',
      attackDelta,
      defenseDelta,
      hpDelta,
      speedDelta,
      powerIndexDelta,
    };
  }

  const statDeltaScore = new Decimal(attackDelta).plus(defenseDelta).plus(hpDelta).plus(new Decimal(speedDelta));
  return {
    verdict: statDeltaScore.gte(0) ? 'BETTER' : 'WORSE',
    attackDelta,
    defenseDelta,
    hpDelta,
    speedDelta,
    powerIndexDelta,
  };
}

function isSlotCompatible(item: LootItemConfigLike, equipment: LootEquipmentConfigLike): LootSlotCompatibility {
  if (equipment.slot === 'TOOL') {
    return 'NOT_APPLICABLE';
  }
  const expectedTag = readSlotTag(equipment.slot);
  return item.tags.includes(expectedTag) ? 'MATCH' : 'MISMATCH';
}

function buildTargetSnapshot(
  currentItem: LootItemConfigLike | null | undefined,
  currentEquipment: LootEquipmentConfigLike | null | undefined,
): LootEquipmentStatSnapshot | null {
  if (currentItem === null || currentItem === undefined || currentEquipment === null || currentEquipment === undefined) {
    return null;
  }
  return equipmentSnapshot(currentItem, currentEquipment);
}

function buildCandidateAndTargetComparison(input: LootEquipmentComparisonInput): LootEquipmentComparison {
  const candidateItem = normalizeItemConfig(input.candidateItem);
  const candidateEquipment = input.candidateEquipment;
  const candidateInstance = normalizeEquipmentInstance(input.candidateInstance);
  const currentInstance = normalizeEquipmentInstance(input.currentInstance);
  const currentPreset = normalizePreset(input.currentPreset);
  const targetSnapshot = buildTargetSnapshot(input.currentItem ?? null, input.currentEquipment ?? null);
  const candidateSnapshot = equipmentSnapshot(input.candidateItem, candidateEquipment);
  const slotCompatibility = isSlotCompatible(candidateItem, candidateEquipment);
  const statComparison = compareStats(targetSnapshot, candidateSnapshot);
  const duplicateInstanceCount = input.duplicateInstanceCount === undefined
    ? 0
    : normalizeInteger(input.duplicateInstanceCount, 'DUPLICATE_INSTANCE_COUNT', true);

  const reasons: string[] = [];
  if (candidateSnapshot.ignoredMarketFields.length > 0) {
    reasons.push('MARKET_FIELDS_IGNORED');
  }
  if (candidateSnapshot.missingAttributes.length > 0) {
    reasons.push('MISSING_ATTRIBUTES');
  }
  if (candidateInstance !== null && currentInstance !== null && candidateInstance.instance_id === currentInstance.instance_id) {
    reasons.push('SELF_REFERENCE');
  }
  if (candidateItem.id === currentInstance?.item_id && candidateInstance?.instance_id !== currentInstance?.instance_id) {
    reasons.push('DUPLICATE_INSTANCE');
  }

  if (slotCompatibility === 'NOT_APPLICABLE') {
    reasons.push('SLOT_NOT_APPLICABLE');
  } else if (slotCompatibility === 'MISMATCH') {
    reasons.push('SLOT_MISMATCH');
  }

  let action: LootDecisionAction = 'VIEW';
  if (slotCompatibility === 'MATCH') {
    if (targetSnapshot === null) {
      action = 'EQUIP';
      reasons.push('NO_CURRENT_EQUIPMENT');
    } else if (statComparison.verdict === 'BETTER') {
      action = 'EQUIP';
      reasons.push('STRICTLY_BETTER');
    } else if (statComparison.verdict === 'SAME') {
      action = 'KEEP';
      reasons.push('SAME_POWER');
    } else {
      action = 'KEEP';
      reasons.push('CURRENT_PRESET_STRONGER');
    }
  } else if (slotCompatibility === 'MISMATCH') {
    action = 'VIEW';
  } else {
    action = 'VIEW';
  }

  if (duplicateInstanceCount > 1 && candidateEquipment.slot !== 'TOOL') {
    action = 'KEEP';
    reasons.push('DUPLICATE_MATERIAL_CANDIDATE');
  }

  if (candidateEquipment.slot === 'TOOL') {
    action = 'VIEW';
    reasons.push('TOOL_NOT_IN_COMBAT_PRESET');
  }

  return {
    candidateItemId: candidateItem.id,
    candidateInstanceId: candidateInstance?.instance_id ?? null,
    currentItemId: input.currentItem?.id ?? null,
    currentInstanceId: currentInstance?.instance_id ?? null,
    currentPresetId: currentPreset?.preset_id ?? null,
    slot: candidateEquipment.slot,
    slotCompatibility,
    verdict: statComparison.verdict,
    action,
    comparisonTargetItemId: input.currentItem?.id ?? null,
    comparisonTargetInstanceId: currentInstance?.instance_id ?? null,
    attackDelta: statComparison.attackDelta,
    defenseDelta: statComparison.defenseDelta,
    hpDelta: statComparison.hpDelta,
    speedDelta: statComparison.speedDelta,
    powerIndexDelta: statComparison.powerIndexDelta,
    candidate: candidateSnapshot,
    target: targetSnapshot,
    duplicateInstanceCount,
    reasons,
  };
}

export function compareLootEquipment(input: LootEquipmentComparisonInput): LootEquipmentComparison {
  return buildCandidateAndTargetComparison(input);
}

export function groupLootMaterialUses(input: {
  readonly itemId: string;
  readonly uses: readonly LootMaterialUseInput[];
}): LootMaterialUseSummary {
  const itemId = requireTrimmedString(input.itemId, 'ITEM_ID');
  const filtered = input.uses
    .filter((use) => use.sourceKind !== 'market')
    .map((use) => {
      const sourceKind = use.sourceKind;
      if (sourceKind !== 'production' && sourceKind !== 'cave' && sourceKind !== 'breakthrough' && sourceKind !== 'tempering') {
        fail(`LOOT_MATERIAL_SOURCE_KIND_INVALID:${sourceKind}`);
      }
      return {
        itemId: requireTrimmedString(use.itemId, 'MATERIAL_ITEM_ID'),
        sourceKind,
        sourceId: requireTrimmedString(use.sourceId, 'MATERIAL_SOURCE_ID'),
        quantity: use.quantity === undefined ? '1' : toDecimalString(normalizeDecimal(use.quantity, 'MATERIAL_QUANTITY')),
        lockedReasonKey: normalizeOptionalString(use.lockedReasonKey),
        stageId: normalizeOptionalString(use.stageId),
      } satisfies LootMaterialUse;
    })
    .sort((left, right) => {
      if (left.sourceKind !== right.sourceKind) {
        return left.sourceKind.localeCompare(right.sourceKind);
      }
      return left.sourceId.localeCompare(right.sourceId);
    });

  const sourceIds = Array.from(new Set(filtered.map((use) => use.sourceId)));

  return {
    itemId,
    uses: filtered,
    sourceIds,
  };
}

export function buildTemperingSameItemMaterialUse(input: {
  readonly itemId: string;
  readonly sourceInstanceId?: string | null;
  readonly temperingAvailability?: LootTemperingAvailabilityInput | null;
}): LootTemperingFutureUse {
  const itemId = requireTrimmedString(input.itemId, 'ITEM_ID');
  const availability = input.temperingAvailability;
  const enabled = availability?.enabled ?? false;
  const requiredStageId = availability?.requiredStageId ?? 'realm.qi.late';
  const lockedReasonKey = normalizeOptionalString(availability?.lockedReasonKey);

  return {
    useId: 'tempering_same_item_material',
    itemId,
    sourceInstanceId: normalizeOptionalString(input.sourceInstanceId),
    status: enabled ? 'AVAILABLE' : 'LOCKED',
    requiredFeatureId: 'feature.tempering',
    requiredStageId,
    lockedReasonKey: enabled ? null : lockedReasonKey ?? 'feature.locked.realm',
  };
}

export function buildLootDecision(input: LootDecisionInput): LootDecision {
  const item = normalizeItemConfig(input.item);
  const ignoredMarketFields = new Set<string>();
  if (input.item.npc_floor_price !== undefined) {
    ignoredMarketFields.add('npc_floor_price');
  }
  if (input.item.market_reference_price !== undefined) {
    ignoredMarketFields.add('market_reference_price');
  }
  if (input.equipment?.npc_floor_price !== undefined) {
    ignoredMarketFields.add('npc_floor_price');
  }
  if (input.equipment?.market_reference_price !== undefined) {
    ignoredMarketFields.add('market_reference_price');
  }
  const reasons: string[] = [];
  let equipmentComparison: LootEquipmentComparison | null = null;
  let futureTemperingUse: LootTemperingFutureUse | null = null;
  let materialUseSummary: LootMaterialUseSummary | null = null;
  let action: LootDecisionAction = 'VIEW';

  if (item.category === 'EQUIPMENT' && input.equipment !== undefined && input.equipment !== null) {
    equipmentComparison = buildCandidateAndTargetComparison({
      candidateItem: item,
      candidateEquipment: input.equipment,
      currentItem: input.currentItem ?? null,
      currentEquipment: input.currentEquipment ?? null,
      currentPreset: input.currentPreset ?? null,
      candidateInstance: input.candidateInstance ?? null,
      currentInstance: input.currentInstance ?? null,
      ...(input.duplicateInstanceCount === undefined ? {} : { duplicateInstanceCount: input.duplicateInstanceCount }),
    });
    action = equipmentComparison.action;
    reasons.push(...equipmentComparison.reasons);

    const duplicateCount = input.duplicateInstanceCount ?? 0;
    if (duplicateCount > 1 || equipmentComparison.currentItemId === equipmentComparison.candidateItemId) {
      futureTemperingUse = buildTemperingSameItemMaterialUse({
        itemId: item.id,
        sourceInstanceId: input.candidateInstance?.instance_id ?? null,
        temperingAvailability: input.temperingAvailability ?? null,
      });
      reasons.push('FUTURE_TEMPERING_MATERIAL');
      if (futureTemperingUse.status === 'LOCKED' && futureTemperingUse.lockedReasonKey !== null) {
        reasons.push(futureTemperingUse.lockedReasonKey);
      }
    }
  } else if (item.category === 'EQUIPMENT') {
    action = 'VIEW';
    reasons.push('EQUIPMENT_CONTEXT_REQUIRED');
  } else {
    action = 'VIEW';
    if (input.materialUses !== undefined) {
      materialUseSummary = groupLootMaterialUses({
        itemId: item.id,
        uses: input.materialUses,
      });
      reasons.push('MATERIAL_USAGE_AVAILABLE');
    }
  }

  if (input.materialUses !== undefined && materialUseSummary === null) {
    materialUseSummary = groupLootMaterialUses({
      itemId: item.id,
      uses: input.materialUses,
    });
  }

  if (ignoredMarketFields.size > 0) {
    reasons.push('MARKET_FIELDS_IGNORED');
  }

  if (equipmentComparison?.slotCompatibility === 'NOT_APPLICABLE') {
    action = 'VIEW';
  }

  return {
    itemId: item.id,
    category: item.category,
    action,
    reasons,
    equipmentComparison,
    futureTemperingUse,
    materialUseSummary,
    ignoredMarketFields: [...ignoredMarketFields],
  };
}

export function compareLootEquipmentByPreset(input: LootEquipmentComparisonInput & {
  readonly currentPreset: LootPresetSnapshotLike;
}): LootEquipmentComparison {
  return compareLootEquipment(input);
}
