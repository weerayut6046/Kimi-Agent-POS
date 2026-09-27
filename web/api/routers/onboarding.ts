import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  branches,
  fuelTanks,
  nozzles,
  paymentSettings,
  products,
  pumps,
  settings,
  shifts,
} from "@db/schema";
import {
  BUSINESS_SETUP_KEY,
  BUSINESS_SETUP_STEPS,
  setupBranchInput,
  setupConfirmStepInput,
  setupEquipmentInput,
  setupFuelInput,
  setupPaymentsInput,
  setupProfileInput,
} from "@contracts/onboarding";
import { adminQuery } from "../guard";
import { createRouter } from "../middleware";
import { getDb } from "../queries/connection";
import { requireBusinessDeployment } from "../lib/deployment";
import { clearActiveStaffCache } from "../lib/authorization";
import { actorFromReq, logAudit } from "../lib/audit";
import { buildPromptPayPayload } from "../lib/promptpay";
import {
  confirmProgress,
  lockSetupBranch,
  paymentReceiverReady,
  readBusinessSetupState,
  writeSetupSettings,
  type SetupDb,
} from "../lib/onboarding";

const fuelResultSchema = z.object({
  pumpId: z.number().int().positive(),
  tankId: z.number().int().positive(),
  nozzleId: z.number().int().positive(),
});

function assertExpectedBranch(expectedBranchId: number, branchId: number) {
  if (expectedBranchId !== branchId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "สาขาที่เลือกเปลี่ยนแล้ว กรุณาโหลดข้อมูลตั้งค่าใหม่ก่อนบันทึก",
    });
  }
}

async function lockClosedShift(db: SetupDb, branchId: number) {
  // Opening a shift does not take our branch lock. This brief table lock
  // prevents a shift from opening between validation and equipment updates.
  await db.execute(sql`lock table pos.shifts in share row exclusive mode`);
  const [openShift] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.branchId, branchId), eq(shifts.status, "open")))
    .limit(1);
  if (openShift) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "กรุณาปิดกะก่อนแก้ไขถังและหัวจ่าย",
    });
  }
}

export const onboardingRouter = createRouter({
  state: adminQuery.query(({ ctx }) => {
    requireBusinessDeployment();
    return readBusinessSetupState(
      getDb(),
      ctx.staff.branchId,
      ctx.staff.id,
      ctx.req
    );
  }),
  saveProfile: adminQuery
    .input(setupProfileInput)
    .mutation(async ({ ctx, input }) => {
      requireBusinessDeployment();
      const branchId = ctx.staff.branchId;
      assertExpectedBranch(input.expectedBranchId, branchId);
      await getDb().transaction(async tx => {
        await lockSetupBranch(tx, branchId);
        await tx
          .update(branches)
          .set({
            name: input.branchName,
            address: input.address,
            phone: input.phone,
            taxId: input.taxId,
            updatedAt: new Date(),
          })
          .where(eq(branches.id, branchId));
        await writeSetupSettings(tx, branchId, [
          { key: "shop_name", value: input.shopName },
          { key: "shop_branch", value: input.branchName },
          { key: "shop_address", value: input.address },
          { key: "shop_phone", value: input.phone },
          { key: "tax_id", value: input.taxId },
        ]);
        await confirmProgress(tx, branchId, "profile");
      });
      clearActiveStaffCache();
      logAudit({
        action: "business_setup_profile",
        ...actorFromReq(ctx.req),
        detail: "บันทึกและยืนยันข้อมูลกิจการสำหรับเริ่มใช้งาน",
      });
      return { ok: true as const };
    }),
  savePayments: adminQuery
    .input(setupPaymentsInput)
    .mutation(async ({ ctx, input }) => {
      requireBusinessDeployment();
      const branchId = ctx.staff.branchId;
      assertExpectedBranch(input.expectedBranchId, branchId);
      await getDb().transaction(async tx => {
        await lockSetupBranch(tx, branchId);
        const [existing] = await tx
          .select()
          .from(paymentSettings)
          .where(eq(paymentSettings.branchId, branchId))
          .for("update");
        if (
          input.promptpayId !== undefined &&
          existing?.qrMode === "merchant"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "QR ร้านค้าใช้งานอยู่ กรุณาแก้ไขผู้รับเงินที่หน้าตั้งค่าการชำระเงิน",
          });
        }
        if (input.promptpayId?.trim()) {
          try {
            buildPromptPayPayload({
              promptPayId: input.promptpayId,
              amount: 1,
            });
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                error instanceof Error
                  ? error.message
                  : "ข้อมูลพร้อมเพย์ไม่ถูกต้อง",
            });
          }
        }
        const next =
          input.promptpayId !== undefined
            ? {
                qrMode: existing?.qrMode ?? "promptpay",
                merchantPayload: existing?.merchantPayload ?? null,
                promptpayId: input.promptpayId,
              }
            : existing;
        if (input.qrEnabled && !paymentReceiverReady(next)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "กรุณาตั้งค่าผู้รับเงิน QR ให้ถูกต้อง หรือปิด QR เพื่อเริ่มใช้เงินสดก่อน",
          });
        }
        if (input.promptpayId !== undefined) {
          // Only the explicit receiver field changes; all encrypted keys, modes,
          // enablement, merchant payload and webhook settings remain untouched.
          await tx
            .insert(paymentSettings)
            .values({ branchId, promptpayId: input.promptpayId })
            .onConflictDoUpdate({
              target: paymentSettings.branchId,
              set: { promptpayId: input.promptpayId, updatedAt: new Date() },
            });
        }
        await writeSetupSettings(tx, branchId, [
          { key: "pay_cash_enabled", value: input.cashEnabled ? "1" : "0" },
          { key: "pay_qr_enabled", value: input.qrEnabled ? "1" : "0" },
          { key: "pay_card_enabled", value: input.cardEnabled ? "1" : "0" },
          { key: "pay_credit_enabled", value: input.creditEnabled ? "1" : "0" },
        ]);
        await confirmProgress(tx, branchId, "payments");
      });
      logAudit({
        action: "business_setup_payments",
        ...actorFromReq(ctx.req),
        detail: "บันทึกและยืนยันช่องทางรับเงินสำหรับเริ่มใช้งาน",
      });
      return { ok: true as const };
    }),
  confirmStep: adminQuery
    .input(setupConfirmStepInput)
    .mutation(async ({ ctx, input }) => {
      requireBusinessDeployment();
      const branchId = ctx.staff.branchId;
      assertExpectedBranch(input.expectedBranchId, branchId);
      await getDb().transaction(async tx => {
        await lockSetupBranch(tx, branchId);
        const state = await readBusinessSetupState(
          tx,
          branchId,
          ctx.staff.id,
          ctx.req
        );
        if (!state.readiness[input.step].ready)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: state.readiness[input.step].issues.join(" / "),
          });
        await confirmProgress(tx, branchId, input.step);
      });
      return { ok: true as const };
    }),
  complete: adminQuery
    .input(setupBranchInput)
    .mutation(async ({ ctx, input }) => {
      requireBusinessDeployment();
      const branchId = ctx.staff.branchId;
      assertExpectedBranch(input.expectedBranchId, branchId);
      await getDb().transaction(async tx => {
        await lockSetupBranch(tx, branchId);
        const state = await readBusinessSetupState(
          tx,
          branchId,
          ctx.staff.id,
          ctx.req
        );
        const incomplete = BUSINESS_SETUP_STEPS.filter(
          step =>
            !state.progress.confirmed[step] || !state.readiness[step].ready
        );
        if (incomplete.length)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "กรุณาตรวจและยืนยันข้อมูลที่พร้อมใช้งานให้ครบทุกขั้นตอนก่อนจบการตั้งค่า",
          });
        if (!state.progress.completedAt) {
          await writeSetupSettings(tx, branchId, [
            {
              key: BUSINESS_SETUP_KEY,
              value: JSON.stringify({
                ...state.progress,
                completedAt: new Date().toISOString(),
              }),
            },
          ]);
        }
      });
      return { ok: true as const };
    }),
  createFuelSetup: adminQuery
    .input(setupFuelInput)
    .mutation(async ({ ctx, input }) => {
      requireBusinessDeployment();
      const branchId = ctx.staff.branchId;
      assertExpectedBranch(input.expectedBranchId, branchId);
      return getDb().transaction(async tx => {
        await lockSetupBranch(tx, branchId);
        const key = `business_setup_fuel:${input.requestId}`;
        const {
          requestId: _requestId,
          expectedBranchId: _expectedBranchId,
          ...payload
        } = input;
        const fingerprint = JSON.stringify(payload);
        const [marker] = await tx
          .insert(settings)
          .values({
            branchId,
            key,
            value: JSON.stringify({ version: 1, fingerprint }),
          })
          .onConflictDoNothing()
          .returning();
        if (!marker) {
          const [stored] = await tx
            .select({ value: settings.value })
            .from(settings)
            .where(and(eq(settings.branchId, branchId), eq(settings.key, key)));
          try {
            const saved = JSON.parse(stored?.value ?? "") as {
              version?: unknown;
              fingerprint?: unknown;
              result?: unknown;
            };
            const result = fuelResultSchema.safeParse(saved.result);
            if (
              saved.version === 1 &&
              saved.fingerprint === fingerprint &&
              result.success
            )
              return result.data;
          } catch {
            /* A malformed marker must never cause duplicate equipment. */
          }
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "คำขอสร้างอุปกรณ์นี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาโหลดข้อมูลล่าสุด",
          });
        }
        await lockClosedShift(tx, branchId);
        const [product] = await tx
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, input.productId),
              eq(products.branchId, branchId)
            )
          )
          .for("update");
        if (
          !product?.active ||
          product.category !== "fuel" ||
          !Number.isFinite(product.price) ||
          !(product.price > 0)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "กรุณาเลือกสินค้าน้ำมันในสาขานี้ที่เปิดขายและมีราคามากกว่า 0",
          });
        const [tank] = await tx
          .insert(fuelTanks)
          .values({
            branchId,
            productId: product.id,
            name: input.tankName,
            capacityLiters: input.capacityLiters,
            currentLiters: input.currentLiters,
            lowAlertAt: input.lowAlertAt,
          })
          .returning({ id: fuelTanks.id });
        const [pump] = await tx
          .insert(pumps)
          .values({ branchId, name: input.pumpName })
          .returning({ id: pumps.id });
        const [nozzle] = await tx
          .insert(nozzles)
          .values({
            branchId,
            pumpId: pump.id,
            productId: product.id,
            tankId: tank.id,
            label: input.nozzleLabel,
            currentMeter: input.meter,
            currentMoney: input.money,
          })
          .returning({ id: nozzles.id });
        const result = {
          pumpId: pump.id,
          tankId: tank.id,
          nozzleId: nozzle.id,
        };
        await writeSetupSettings(tx, branchId, [
          { key, value: JSON.stringify({ version: 1, fingerprint, result }) },
        ]);
        return result;
      });
    }),
  updateEquipment: adminQuery
    .input(setupEquipmentInput)
    .mutation(async ({ ctx, input }) => {
      requireBusinessDeployment();
      const branchId = ctx.staff.branchId;
      assertExpectedBranch(input.expectedBranchId, branchId);
      await getDb().transaction(async tx => {
        await lockSetupBranch(tx, branchId);
        await lockClosedShift(tx, branchId);
        const [nozzle] = await tx
          .select()
          .from(nozzles)
          .where(
            and(eq(nozzles.id, input.nozzleId), eq(nozzles.branchId, branchId))
          )
          .for("update");
        if (!nozzle)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "ไม่พบหัวจ่ายในสาขานี้",
          });
        const [tank] =
          nozzle.tankId === null
            ? []
            : await tx
                .select()
                .from(fuelTanks)
                .where(
                  and(
                    eq(fuelTanks.id, nozzle.tankId),
                    eq(fuelTanks.branchId, branchId)
                  )
                )
                .for("update");
        const tankPatch = {
          ...(input.tankName !== undefined ? { name: input.tankName } : {}),
          ...(input.capacityLiters !== undefined
            ? { capacityLiters: input.capacityLiters }
            : {}),
          ...(input.currentLiters !== undefined
            ? { currentLiters: input.currentLiters }
            : {}),
          ...(input.lowAlertAt !== undefined
            ? { lowAlertAt: input.lowAlertAt }
            : {}),
        };
        if (Object.keys(tankPatch).length && !tank)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "หัวจ่ายนี้ยังไม่มีถังในสาขา กรุณาผูกถังก่อนแก้ไขระดับน้ำมัน",
          });
        const finalTank = tank ? { ...tank, ...tankPatch } : undefined;
        if (
          finalTank &&
          Object.keys(tankPatch).length &&
          (!Number.isFinite(finalTank.capacityLiters) ||
            !(finalTank.capacityLiters > 0) ||
            !Number.isFinite(finalTank.currentLiters) ||
            finalTank.currentLiters < 0 ||
            finalTank.currentLiters > finalTank.capacityLiters ||
            !Number.isFinite(finalTank.lowAlertAt) ||
            finalTank.lowAlertAt < 0 ||
            finalTank.lowAlertAt > finalTank.capacityLiters)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "ระดับน้ำมันและจุดแจ้งเตือนต้องไม่เกินความจุถัง",
          });
        const nozzlePatch = {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.meter !== undefined ? { currentMeter: input.meter } : {}),
          ...(input.money !== undefined ? { currentMoney: input.money } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        };
        const finalNozzle = { ...nozzle, ...nozzlePatch };
        if (finalNozzle.active) {
          const [[pump], [product]] = await Promise.all([
            tx
              .select()
              .from(pumps)
              .where(
                and(eq(pumps.id, nozzle.pumpId), eq(pumps.branchId, branchId))
              )
              .for("update"),
            tx
              .select()
              .from(products)
              .where(
                and(
                  eq(products.id, nozzle.productId),
                  eq(products.branchId, branchId)
                )
              )
              .for("update"),
          ]);
          if (
            !pump?.active ||
            !product?.active ||
            product.category !== "fuel" ||
            !Number.isFinite(product.price) ||
            !(product.price > 0) ||
            !finalTank ||
            finalTank.productId !== nozzle.productId ||
            !Number.isFinite(finalTank.capacityLiters) ||
            !(finalTank.capacityLiters > 0) ||
            !Number.isFinite(finalTank.currentLiters) ||
            finalTank.currentLiters < 0 ||
            finalTank.currentLiters > finalTank.capacityLiters ||
            !Number.isFinite(finalTank.lowAlertAt) ||
            finalTank.lowAlertAt < 0 ||
            finalTank.lowAlertAt > finalTank.capacityLiters ||
            !Number.isFinite(finalNozzle.currentMeter) ||
            finalNozzle.currentMeter < 0 ||
            !Number.isFinite(finalNozzle.currentMoney) ||
            finalNozzle.currentMoney < 0
          )
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "หัวจ่ายที่เปิดใช้ต้องผูกตู้จ่าย สินค้าน้ำมันมีราคา และถังที่พร้อมใช้งานในสาขาเดียวกัน",
            });
        }
        if (tank && Object.keys(tankPatch).length)
          await tx
            .update(fuelTanks)
            .set(tankPatch)
            .where(
              and(eq(fuelTanks.id, tank.id), eq(fuelTanks.branchId, branchId))
            );
        if (Object.keys(nozzlePatch).length)
          await tx
            .update(nozzles)
            .set(nozzlePatch)
            .where(
              and(eq(nozzles.id, nozzle.id), eq(nozzles.branchId, branchId))
            );
      });
      return { ok: true as const };
    }),
});
