import { decimal, type DecimalInput, DecimalValue, type DecimalRoundingMode } from './decimal.js';

export type ModifierOperation = 'ADD' | 'MULTIPLY';

export type Modifier = {
  readonly stat: string;
  readonly operation: ModifierOperation;
  readonly value: DecimalInput;
  readonly group?: string;
  readonly tags?: readonly string[];
};

export type ModifierContext = {
  readonly stat: string;
  readonly activeTags?: readonly string[];
  readonly softCap?: (value: DecimalValue) => DecimalValue;
  readonly rounding?: {
    readonly scale: number;
    readonly mode?: DecimalRoundingMode;
  };
};

function matches(modifier: Modifier, context: ModifierContext): boolean {
  if (modifier.stat !== context.stat) {
    return false;
  }
  const activeTags = new Set(context.activeTags ?? []);
  return (modifier.tags ?? []).every((tag) => activeTags.has(tag));
}

export function applyModifiers(
  baseValue: DecimalInput,
  modifiers: readonly Modifier[],
  context: ModifierContext,
): DecimalValue {
  const applicable = modifiers.filter((modifier) => matches(modifier, context));
  const additions = applicable
    .filter((modifier) => modifier.operation === 'ADD')
    .reduce((value, modifier) => value.add(modifier.value), decimal('0'));
  let result = decimal(baseValue).add(additions);

  const groupMultipliers = new Map<string, DecimalValue>();
  let globalMultiplier = decimal('1');
  for (const modifier of applicable.filter((entry) => entry.operation === 'MULTIPLY')) {
    const multiplier = decimal('1').add(modifier.value);
    if (modifier.group) {
      groupMultipliers.set(
        modifier.group,
        (groupMultipliers.get(modifier.group) ?? decimal('1')).multiply(multiplier),
      );
    } else {
      globalMultiplier = globalMultiplier.multiply(multiplier);
    }
  }

  for (const multiplier of groupMultipliers.values()) {
    result = result.multiply(multiplier);
  }
  result = result.multiply(globalMultiplier);
  if (context.softCap) {
    result = context.softCap(result);
  }
  return context.rounding ? result.round(context.rounding.scale, context.rounding.mode) : result;
}
