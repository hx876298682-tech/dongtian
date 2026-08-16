import { decimal, type DecimalInput } from './decimal.js';
import type { SettlementActionSnapshot } from './settlement.js';

export type SettlementBuffModifier = {
  readonly stat: 'cultivation_xp' | 'skill_xp';
  readonly operation: 'ADD' | 'MULTIPLY';
  readonly value: DecimalInput;
  readonly tags: readonly string[];
};

export type SettlementBuffEffect = {
  readonly buffConfigId: string;
  readonly sourceItemId: string;
  readonly stackGroup: string;
  readonly stackRule: 'REPLACE' | 'STACK';
  readonly applicableTags: readonly string[];
  readonly modifiers: readonly SettlementBuffModifier[];
};

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return left.some((value) => right.includes(value));
}

function applyDecimalAdjustments(
  base: DecimalInput,
  modifiers: readonly SettlementBuffModifier[],
  stat: SettlementBuffModifier['stat'],
): string {
  let add = decimal('0');
  let multiply = decimal('1');
  for (const modifier of modifiers) {
    if (modifier.stat !== stat) {
      continue;
    }
    if (modifier.operation === 'ADD') {
      add = add.add(modifier.value);
    } else {
      multiply = multiply.multiply(modifier.value);
    }
  }
  return decimal(base).add(add).multiply(multiply).toString();
}

export function buffAppliesToAction(
  buff: SettlementBuffEffect,
  actionTags: readonly string[],
): boolean {
  return intersects(buff.applicableTags, actionTags);
}

export function applyBuffsToActionSnapshot(input: {
  readonly snapshot: SettlementActionSnapshot;
  readonly actionTags: readonly string[];
  readonly buffs: readonly SettlementBuffEffect[];
}): SettlementActionSnapshot {
  const applicableBuffs = input.buffs.filter((buff) => buffAppliesToAction(buff, input.actionTags));
  if (applicableBuffs.length === 0) {
    return input.snapshot;
  }

  return {
    ...input.snapshot,
    cultivationXpPerCycle: applyDecimalAdjustments(
      input.snapshot.cultivationXpPerCycle,
      applicableBuffs.flatMap((buff) => buff.modifiers),
      'cultivation_xp',
    ),
    skillXpPerCycle: applyDecimalAdjustments(
      input.snapshot.skillXpPerCycle,
      applicableBuffs.flatMap((buff) => buff.modifiers),
      'skill_xp',
    ),
  };
}
