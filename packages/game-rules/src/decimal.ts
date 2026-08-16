import Decimal from 'decimal.js';

const PreciseDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN });

export type DecimalInput = DecimalValue | Decimal | string | bigint;
export type DecimalRoundingMode = 'DOWN' | 'FLOOR' | 'CEIL' | 'HALF_UP' | 'HALF_EVEN';

function valueOf(input: DecimalInput): Decimal {
  return input instanceof DecimalValue ? input.value : new PreciseDecimal(input);
}

function roundingOf(mode: DecimalRoundingMode): Decimal.Rounding {
  switch (mode) {
    case 'DOWN':
      return PreciseDecimal.ROUND_DOWN;
    case 'FLOOR':
      return PreciseDecimal.ROUND_FLOOR;
    case 'CEIL':
      return PreciseDecimal.ROUND_CEIL;
    case 'HALF_UP':
      return PreciseDecimal.ROUND_HALF_UP;
    case 'HALF_EVEN':
      return PreciseDecimal.ROUND_HALF_EVEN;
  }
}

export class DecimalValue {
  public readonly value: Decimal;

  public constructor(input: DecimalInput) {
    const value = valueOf(input);
    if (!value.isFinite()) {
      throw new Error('DECIMAL_VALUE_INVALID');
    }
    this.value = value;
  }

  public add(input: DecimalInput): DecimalValue {
    return new DecimalValue(this.value.plus(valueOf(input)));
  }

  public subtract(input: DecimalInput): DecimalValue {
    return new DecimalValue(this.value.minus(valueOf(input)));
  }

  public multiply(input: DecimalInput): DecimalValue {
    return new DecimalValue(this.value.times(valueOf(input)));
  }

  public divide(input: DecimalInput): DecimalValue {
    const divisor = valueOf(input);
    if (divisor.isZero()) {
      throw new Error('DECIMAL_DIVISION_BY_ZERO');
    }
    return new DecimalValue(this.value.dividedBy(divisor));
  }

  public max(input: DecimalInput): DecimalValue {
    return new DecimalValue(PreciseDecimal.max(this.value, valueOf(input)));
  }

  public min(input: DecimalInput): DecimalValue {
    return new DecimalValue(PreciseDecimal.min(this.value, valueOf(input)));
  }

  public round(scale: number, mode: DecimalRoundingMode = 'DOWN'): DecimalValue {
    if (!Number.isInteger(scale) || scale < 0 || scale > 30) {
      throw new Error('DECIMAL_SCALE_INVALID');
    }
    return new DecimalValue(this.value.toDecimalPlaces(scale, roundingOf(mode)));
  }

  public isNegative(): boolean {
    return this.value.isNegative();
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public toString(): string {
    return this.value.toFixed();
  }

  public toJSON(): string {
    return this.toString();
  }
}

export function decimal(input: DecimalInput): DecimalValue {
  return new DecimalValue(input);
}

export function roundDecimal(
  input: DecimalInput,
  scale: number,
  mode: DecimalRoundingMode = 'DOWN',
): DecimalValue {
  return decimal(input).round(scale, mode);
}
