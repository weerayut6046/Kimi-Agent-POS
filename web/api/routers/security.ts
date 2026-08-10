import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { securityEvents, securityReports } from "@db/schema";
import { adminQuery } from "../guard";
import { createRouter } from "../middleware";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import { analyzeSecurityEvents } from "../lib/securityAi";
import { runSecurityScan } from "../lib/securityScan";

const AI_RATE_LIMIT_WINDOW_MS = 60_000;
const AI_RATE_LIMIT_REQUESTS = 5;
const aiRequestTimesByStaff = new Map<number, number[]>();

function enforceAiAnalysisRateLimit(staffId: number) {
  const now = Date.now();
  const recent = (aiRequestTimesByStaff.get(staffId) ?? []).filter(
    time => now - time < AI_RATE_LIMIT_WINDOW_MS
  );
  if (recent.length >= AI_RATE_LIMIT_REQUESTS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "เรียก AI วิเคราะห์ถี่เกินไป กรุณารอประมาณ 1 นาที",
    });
  }
  recent.push(now);
  aiRequestTimesByStaff.set(staffId, recent);
}

const windowDaysSchema = z.object({
  windowDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
});

export const securityRouter = createRouter({
  // ภาพรวมเชิงนับสำหรับ dashboard ความปลอดภัย (admin เท่านั้น)
  overview: adminQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const grouped = await db
      .select({
        severity: securityEvents.severity,
        status: securityEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(securityEvents)
      .where(eq(securityEvents.branchId, branchId))
      .groupBy(securityEvents.severity, securityEvents.status);
    const [last24hRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.branchId, branchId),
          gte(securityEvents.createdAt, new Date(Date.now() - 24 * 3_600_000))
        )
      );
    const [lastEvent] = await db
      .select({ createdAt: securityEvents.createdAt })
      .from(securityEvents)
      .where(eq(securityEvents.branchId, branchId))
      .orderBy(desc(securityEvents.createdAt))
      .limit(1);
    const [lastReport] = await db
      .select({ createdAt: securityReports.createdAt })
      .from(securityReports)
      .where(eq(securityReports.branchId, branchId))
      .orderBy(desc(securityReports.createdAt))
      .limit(1);

    const counts = {
      criticalNew: 0,
      warningNew: 0,
      infoNew: 0,
      acknowledged: 0,
    };
    for (const row of grouped) {
      const count = Number(row.count) || 0;
      if (row.status === "acknowledged") {
        counts.acknowledged += count;
      } else if (row.status === "new") {
        if (row.severity === "critical") counts.criticalNew += count;
        else if (row.severity === "warning") counts.warningNew += count;
        else counts.infoNew += count;
      }
    }
    return {
      ...counts,
      last24h: Number(last24hRow?.count) || 0,
      lastScanAt: lastEvent?.createdAt ?? null,
      lastReportAt: lastReport?.createdAt ?? null,
    };
  }),

  // รายการ security events เรียงใหม่ → เก่า กรองตาม severity/status/category/คำค้น
  events: adminQuery
    .input(
      z
        .object({
          severity: z.enum(["info", "warning", "critical"]).optional(),
          status: z.enum(["new", "acknowledged", "resolved"]).optional(),
          category: z
            .enum([
              "auth",
              "data_tampering",
              "permission",
              "vulnerability",
              "system",
            ])
            .optional(),
          q: z.string().optional(),
          limit: z.number().int().positive().max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conds = [eq(securityEvents.branchId, ctx.staff.branchId)];
      if (input?.severity)
        conds.push(eq(securityEvents.severity, input.severity));
      if (input?.status) conds.push(eq(securityEvents.status, input.status));
      if (input?.category)
        conds.push(eq(securityEvents.category, input.category));
      const q = input?.q?.trim();
      if (q) {
        const pattern = `%${q}%`;
        conds.push(
          or(
            ilike(securityEvents.title, pattern),
            ilike(securityEvents.actorName, pattern),
            ilike(securityEvents.rule, pattern)
          )!
        );
      }
      const limit = input?.limit ?? 200;
      const rows = await db
        .select()
        .from(securityEvents)
        .where(and(...conds))
        .orderBy(desc(securityEvents.createdAt))
        .limit(limit + 1);
      return { rows: rows.slice(0, limit), truncated: rows.length > limit };
    }),

  scan: adminQuery.input(windowDaysSchema).mutation(async ({ input, ctx }) => {
    const result = await runSecurityScan({
      branchId: ctx.staff.branchId,
      windowDays: input.windowDays,
    });
    logAudit({
      action: "security_scan",
      ...actorFromReq(ctx.req),
      detail: `สแกนความปลอดภัยย้อนหลัง ${input.windowDays} วัน: ตรวจ ${result.scanned} รายการ สร้างเหตุการณ์ใหม่ ${result.created}`,
      refType: "security",
    });
    return result;
  }),

  analyze: adminQuery
    .input(windowDaysSchema)
    .mutation(async ({ input, ctx }) => {
      enforceAiAnalysisRateLimit(ctx.staff.id);
      const result = await analyzeSecurityEvents({
        branchId: ctx.staff.branchId,
        windowDays: input.windowDays,
      });
      logAudit({
        action: "security_ai_analyze",
        ...actorFromReq(ctx.req),
        detail: `AI วิเคราะห์เหตุการณ์ความปลอดภัยย้อนหลัง ${input.windowDays} วัน`,
        refType: "security_report",
        refId: result.reportId,
      });
      return result;
    }),

  reports: adminQuery
    .input(
      z
        .object({
          limit: z.number().int().positive().max(50).default(10),
        })
        .optional()
    )
    .query(async ({ input, ctx }) =>
      getDb()
        .select()
        .from(securityReports)
        .where(eq(securityReports.branchId, ctx.staff.branchId))
        .orderBy(desc(securityReports.createdAt))
        .limit(input?.limit ?? 10)
    ),

  setEventStatus: adminQuery
    .input(
      z
        .object({
          id: z.string().uuid(),
          status: z.enum(["new", "acknowledged", "resolved"]),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      await getDb()
        .update(securityEvents)
        .set({ status: input.status })
        .where(
          and(
            eq(securityEvents.id, input.id),
            eq(securityEvents.branchId, ctx.staff.branchId)
          )
        );
      return { ok: true };
    }),
});
