import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { fuelTanks, settings } from "@db/schema";
import {
  FUEL_FORECAST_SETTINGS_KEY,
  fuelForecastSaveSettingsSchema,
  fuelForecastSummaryInputSchema,
  normalizeFuelForecastConfig,
} from "@contracts/fuelForecast";
import { createRouter, publicQuery } from "../middleware";
import { managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import { queryFuelForecast } from "../lib/fuelForecast";
import { actorFromReq, logAudit } from "../lib/audit";

export const fuelForecastRouter = createRouter({
  summary: publicQuery
    .input(fuelForecastSummaryInputSchema)
    .query(({ input, ctx }) =>
      queryFuelForecast(getDb(), input, ctx.staff.branchId)
    ),
  saveSettings: managerQuery
    .input(fuelForecastSaveSettingsSchema)
    .mutation(async ({ input, ctx }) => {
      const branchId = ctx.staff.branchId;
      const tank = await getDb().query.fuelTanks.findFirst({
        where: and(
          eq(fuelTanks.id, input.tankId),
          eq(fuelTanks.branchId, branchId)
        ),
        columns: { id: true },
      });
      if (!tank)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "ไม่พบถังน้ำมันในสาขานี้",
        });
      const policy = {
        leadTimeDays: input.leadTimeDays,
        safetyStockDays: input.safetyStockDays,
        targetCoverDays: input.targetCoverDays,
      };
      await getDb().transaction(async tx => {
        // Seed the row before locking it so concurrent saves for different tanks
        // serialize even when the branch has never saved a forecast policy before.
        await tx
          .insert(settings)
          .values({ branchId, key: FUEL_FORECAST_SETTINGS_KEY, value: "{}" })
          .onConflictDoNothing();
        const [row] = await tx
          .select({ value: settings.value })
          .from(settings)
          .where(
            and(
              eq(settings.branchId, branchId),
              eq(settings.key, FUEL_FORECAST_SETTINGS_KEY)
            )
          )
          .for("update");
        const config = normalizeFuelForecastConfig(row?.value);
        config[String(input.tankId)] = policy;
        await tx
          .update(settings)
          .set({ value: JSON.stringify(config) })
          .where(
            and(
              eq(settings.branchId, branchId),
              eq(settings.key, FUEL_FORECAST_SETTINGS_KEY)
            )
          );
      });
      logAudit({
        action: "save_fuel_forecast_settings",
        ...actorFromReq(ctx.req),
        detail: `ตั้งค่าคาดการณ์ถัง ${input.tankId}: ส่ง ${policy.leadTimeDays} วัน เผื่อ ${policy.safetyStockDays} วัน สำรองหลังรับ ${policy.targetCoverDays} วัน`,
        refType: "fuel_tank",
        refId: input.tankId,
      });
      return { ok: true as const, tankId: input.tankId, settings: policy };
    }),
});
