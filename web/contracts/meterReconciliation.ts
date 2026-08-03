const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A money totalizer can differ slightly from liters x the current price because
 * each sale is rounded independently. This limit is intentionally generous:
 * it catches shifted/misread digits without rejecting normal accumulated
 * rounding differences.
 */
export const METER_IMPLAUSIBLE_MIN_DIFF = 100;
export const METER_IMPLAUSIBLE_RATIO = 0.1;

export type MeterReadingAssessment = {
  liters: number;
  amountFromLiters: number;
  moneyFromMeter: number | null;
  difference: number | null;
  implausible: boolean;
  allowedDifference: number;
  suggestedCloseMoney: number | null;
};

function decimalPlaces(value: number) {
  const text = String(value);
  const exponentIndex = text.toLowerCase().indexOf("e-");
  if (exponentIndex >= 0) {
    return Math.min(3, Number(text.slice(exponentIndex + 2)) || 0);
  }
  return Math.min(3, text.split(".")[1]?.length ?? 0);
}

function suggestSingleDigitCloseMoney(input: {
  openMoney: number;
  closeMoney: number;
  expectedMoney: number;
  allowedDifference: number;
}): number | null {
  const precision = Math.max(
    decimalPlaces(input.openMoney),
    decimalPlaces(input.closeMoney),
    1
  );
  const original = input.closeMoney.toFixed(precision);
  const originalDifference = Math.abs(
    input.closeMoney - input.openMoney - input.expectedMoney
  );
  let best: { value: number; difference: number } | null = null;

  for (let index = 0; index < original.length; index += 1) {
    if (original[index] === "." || original[index] === "-") continue;
    for (let digit = 0; digit <= 9; digit += 1) {
      if (String(digit) === original[index]) continue;
      if (index === 0 && digit === 0) continue;
      const candidate = Number(
        `${original.slice(0, index)}${digit}${original.slice(index + 1)}`
      );
      if (!Number.isFinite(candidate) || candidate < input.openMoney) continue;
      const difference = Math.abs(
        candidate - input.openMoney - input.expectedMoney
      );
      if (!best || difference < best.difference) {
        best = { value: candidate, difference };
      }
    }
  }

  if (
    !best ||
    best.difference > input.allowedDifference ||
    best.difference >= originalDifference * 0.2
  ) {
    return null;
  }
  return best.value;
}

export function assessMeterReading(input: {
  openMeter: number;
  closeMeter: number;
  openMoney: number;
  closeMoney: number;
  pricePerLiter: number;
  priceChangedDuringShift?: boolean;
}): MeterReadingAssessment {
  const liters = round3(input.closeMeter - input.openMeter);
  const amountFromLiters = round2(liters * input.pricePerLiter);
  const moneyFromMeter =
    input.openMoney > 0 ? round2(input.closeMoney - input.openMoney) : null;
  const difference =
    moneyFromMeter == null ? null : round2(moneyFromMeter - amountFromLiters);
  const allowedDifference = round2(
    Math.max(
      METER_IMPLAUSIBLE_MIN_DIFF,
      Math.abs(amountFromLiters) * METER_IMPLAUSIBLE_RATIO
    )
  );
  const implausible =
    !input.priceChangedDuringShift &&
    difference != null &&
    Math.abs(difference) > allowedDifference;

  return {
    liters,
    amountFromLiters,
    moneyFromMeter,
    difference,
    implausible,
    allowedDifference,
    suggestedCloseMoney: implausible
      ? suggestSingleDigitCloseMoney({
          openMoney: input.openMoney,
          closeMoney: input.closeMoney,
          expectedMoney: amountFromLiters,
          allowedDifference,
        })
      : null,
  };
}
