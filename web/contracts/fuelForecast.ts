import { z } from "zod";

export const FUEL_FORECAST_SETTINGS_KEY = "fuel_forecast_config";
export const FUEL_FORECAST_LOOKBACK_DAYS = [7, 14, 30, 60, 90] as const;
export type FuelForecastLookbackDays =
  (typeof FUEL_FORECAST_LOOKBACK_DAYS)[number];
export const FUEL_FORECAST_MINIMUM_EVIDENCE_DAYS = 7;

export const DEFAULT_FUEL_FORECAST_SETTINGS = {
  leadTimeDays: 2,
  safetyStockDays: 2,
  targetCoverDays: 7,
} as const;

export const fuelForecastSettingsSchema = z
  .object({
    leadTimeDays: z.number().int().min(0).max(60),
    safetyStockDays: z.number().int().min(0).max(30),
    targetCoverDays: z.number().int().min(1).max(90),
  })
  .refine(
    settings =>
      settings.targetCoverDays >
      settings.leadTimeDays + settings.safetyStockDays,
    {
      message: "วันสำรองหลังรับน้ำมันต้องมากกว่าเวลาส่งรวมวันเผื่อสต๊อก",
      path: ["targetCoverDays"],
    }
  );
export type FuelForecastSettings = z.infer<typeof fuelForecastSettingsSchema>;
export const fuelForecastSaveSettingsSchema =
  fuelForecastSettingsSchema.safeExtend({
    tankId: z.number().int().positive(),
  });
export const fuelForecastSummaryInputSchema = z
  .object({
    lookbackDays: z
      .union([
        z.literal(7),
        z.literal(14),
        z.literal(30),
        z.literal(60),
        z.literal(90),
      ])
      .default(30),
  })
  .default({ lookbackDays: 30 });

/** Invalid or legacy values never turn into an unsafe replenishment policy. */
export function normalizeFuelForecastConfig(
  value: unknown
): Record<string, FuelForecastSettings> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: Record<string, FuelForecastSettings> = {};
  for (const [tankId, entry] of Object.entries(parsed)) {
    if (!/^[1-9]\d*$/.test(tankId) || !Number.isSafeInteger(Number(tankId)))
      continue;
    const settings = fuelForecastSettingsSchema.safeParse(entry);
    if (settings.success) result[tankId] = settings.data;
  }
  return result;
}

export type FuelForecastStatus =
  "urgent" | "order_now" | "ok" | "insufficient_data";
export type FuelForecastSource = "meters" | "pos" | "mixed" | "none";

export interface FuelTankForecast {
  tankId: number;
  tankName: string;
  productId: number;
  productName: string;
  currentLiters: number;
  capacityLiters: number;
  settings: FuelForecastSettings;
  historical: {
    totalLiters: number;
    averageDailyLiters: number;
    calendarDays: number;
    evidenceDays: number;
    meterShifts: number;
    posBills: number;
    source: FuelForecastSource;
  };
  daysLeft: number | null;
  orderByDate: string | null;
  expectedEmptyDate: string | null;
  expectedDeliveryDate: string | null;
  projectedDeliveryLiters: number | null;
  reorderPointLiters: number | null;
  suggestedOrderLiters: number | null;
  status: FuelForecastStatus;
  capacityWarning: boolean;
  warnings: string[];
}

export interface FuelForecastSummary {
  generatedAt: string;
  timezone: "Asia/Bangkok";
  lookbackDays: FuelForecastLookbackDays;
  periodStart: string;
  periodEnd: string;
  minimumEvidenceDays: number;
  method: string;
  tanks: FuelTankForecast[];
}
