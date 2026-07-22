export type FuelLiquidTone = {
  color: string;
  light: string;
};

const DEFAULT_FUEL_TONE: FuelLiquidTone = {
  color: "#6d5df4",
  light: "#22d3ee",
};

function normalizeFuelLabel(value: string) {
  return value.toUpperCase().replace(/[\s_.\-/()]+/g, "");
}

export function getFuelLiquidTone(
  ...labels: Array<string | null | undefined>
): FuelLiquidTone {
  const fuel = normalizeFuelLabel(labels.filter(Boolean).join(" "));

  if (
    fuel.includes("GSH95") ||
    fuel.includes("GASOHOL95") ||
    fuel.includes("แก๊สโซฮอล์95") ||
    fuel.includes("แกสโซฮอล์95")
  ) {
    return { color: "#f97316", light: "#fdba74" };
  }

  if (
    fuel.includes("DB7") ||
    fuel.includes("DIESELB7") ||
    fuel.includes("ดีเซลB7") ||
    fuel.includes("B7")
  ) {
    return { color: "#eab308", light: "#fde047" };
  }

  if (
    fuel.includes("GSH91") ||
    fuel.includes("GASOHOL91") ||
    fuel.includes("แก๊สโซฮอล์91") ||
    fuel.includes("แกสโซฮอล์91")
  ) {
    return { color: "#16a34a", light: "#4ade80" };
  }

  if (fuel.includes("E20")) {
    return { color: "#65a30d", light: "#bef264" };
  }

  if (fuel.includes("E85")) {
    return { color: "#9333ea", light: "#d8b4fe" };
  }

  if (fuel.includes("B20")) {
    return { color: "#2563eb", light: "#60a5fa" };
  }

  if (fuel.includes("เบนซิน") || fuel.includes("BENZINE")) {
    return { color: "#dc2626", light: "#fb7185" };
  }

  return DEFAULT_FUEL_TONE;
}
