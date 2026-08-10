import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLogs } from "@db/schema";
import { adminQuery } from "../guard";
import { createRouter } from "../middleware";
import { getDb } from "../queries/connection";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  AssistantSecretError,
  getAssistantRuntimeConfig,
} from "../lib/assistantConfig";
import { DeepSeekAssistantError } from "../lib/deepseek";
import { runFormulaAuditAnalysis } from "../lib/formulaAuditAnalysis";
import {
  approveFormulaAuditFixPlan,
  generateFormulaAuditFixPlan,
  storeFormulaAuditFixPlan,
} from "../lib/formulaAuditFixPlan";
import {
  createFormulaAuditRemediationWorkOrder,
  startFormulaAuditRemediationWorkOrder,
  verifyFormulaAuditRemediationWorkOrder,
} from "../lib/formulaAuditRemediation";
import {
  loadFormulaAuditReport,
  presentFormulaAuditReport,
} from "../lib/formulaAuditReport";
import { OllamaAssistantError } from "../lib/ollama";

const auditRangeSchema = z
  .object({
    days: z.number().int().min(1).max(365).default(30),
  })
  .optional();
const createFixPlanSchema = z
  .object({
    days: z.number().int().min(1).max(365).default(30),
    requestId: z.string().uuid(),
  })
  .strict();
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

export const auditRouter = createRouter({
  formulaAudit: adminQuery
    .input(auditRangeSchema)
    .query(async ({ input, ctx }) => {
      const report = await loadFormulaAuditReport(
        ctx.staff.branchId,
        input?.days ?? 30
      );
      return presentFormulaAuditReport(report);
    }),

  analyzeFormulaAudit: adminQuery
    .input(auditRangeSchema)
    .mutation(async ({ input, ctx }) => {
      enforceAiAnalysisRateLimit(ctx.staff.id);
      const report = await loadFormulaAuditReport(
        ctx.staff.branchId,
        input?.days ?? 30
      );

      if (!report.issues.length) {
        return {
          answer:
            "ไม่พบความผิดปกติจากกฎที่ตรวจในช่วงเวลานี้ จึงยังไม่มีประเด็นให้ AI วิเคราะห์เพิ่มเติม\n\nคำวิเคราะห์นี้ไม่ได้แก้ไขข้อมูลหรือโค้ดอัตโนมัติ",
          provider: "rules" as const,
          model: null,
          analyzedAt: new Date(),
          issuesAnalyzed: 0,
          groupsAnalyzed: 0,
        };
      }

      let assistantConfig: Awaited<
        ReturnType<typeof getAssistantRuntimeConfig>
      >;
      try {
        assistantConfig = await getAssistantRuntimeConfig(ctx.staff.branchId);
      } catch (error) {
        if (error instanceof AssistantSecretError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
          });
        }
        throw error;
      }

      if (
        assistantConfig.provider === "deepseek" &&
        !assistantConfig.deepseekApiKey
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ยังไม่ได้ตั้งค่า DeepSeek API Key กรุณาตั้งค่าในเมนู ตั้งค่าระบบ > AI",
        });
      }

      try {
        const analysis = await runFormulaAuditAnalysis({
          config: assistantConfig,
          report,
        });
        logAudit({
          action: "analyze_formula_audit",
          ...actorFromReq(ctx.req),
          detail: `AI วิเคราะห์ผลตรวจ ${analysis.issuesAnalyzed} จุด (${analysis.groupsAnalyzed} กฎ) ด้วย ${analysis.provider}`,
          refType: "formula_audit",
        });
        return analysis;
      } catch (error) {
        if (
          (error instanceof DeepSeekAssistantError ||
            error instanceof OllamaAssistantError) &&
          error.kind === "timeout"
        ) {
          throw new TRPCError({
            code: "TIMEOUT",
            message: "AI ใช้เวลาวิเคราะห์นานเกินไป กรุณาลองใหม่",
          });
        }
        if (
          error instanceof OllamaAssistantError &&
          error.kind === "model_not_found"
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `ยังไม่พบโมเดล ${assistantConfig.ollamaModel} ใน Ollama`,
          });
        }
        if (
          error instanceof OllamaAssistantError &&
          error.kind === "unavailable"
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "เชื่อมต่อ Ollama ไม่ได้ กรุณาเปิด Ollama แล้วลองใหม่",
          });
        }
        console.error("Formula audit AI analysis failed", {
          kind:
            error instanceof DeepSeekAssistantError ||
            error instanceof OllamaAssistantError
              ? error.kind
              : "unexpected",
          provider: assistantConfig.provider,
        });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "AI ยังไม่พร้อมวิเคราะห์ชั่วคราว กรุณาลองใหม่ภายหลัง",
        });
      }
    }),

  createFormulaAuditFixPlan: adminQuery
    .input(createFixPlanSchema)
    .mutation(async ({ input, ctx }) => {
      enforceAiAnalysisRateLimit(ctx.staff.id);
      const report = await loadFormulaAuditReport(
        ctx.staff.branchId,
        input.days
      );
      if (!report.issues.length) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ไม่พบความผิดปกติที่ต้องสร้างแผนแก้ไข",
        });
      }

      let assistantConfig: Awaited<
        ReturnType<typeof getAssistantRuntimeConfig>
      >;
      try {
        assistantConfig = await getAssistantRuntimeConfig(ctx.staff.branchId);
      } catch (error) {
        if (error instanceof AssistantSecretError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
          });
        }
        throw error;
      }
      if (
        assistantConfig.provider === "deepseek" &&
        !assistantConfig.deepseekApiKey
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ยังไม่ได้ตั้งค่า DeepSeek API Key กรุณาตั้งค่าในเมนู ตั้งค่าระบบ > AI",
        });
      }

      try {
        const plan = await generateFormulaAuditFixPlan({
          config: assistantConfig,
          report,
        });
        const proposal = await storeFormulaAuditFixPlan({
          branchId: ctx.staff.branchId,
          staffId: ctx.staff.id,
          requestId: input.requestId,
          report,
          plan,
        });
        logAudit({
          action: "create_formula_audit_fix_plan",
          ...actorFromReq(ctx.req),
          detail: `AI สร้างแผนแก้ไข ${plan.steps.length} ขั้น จากผลตรวจ ${proposal.issuesIncluded} จุด โดยยังไม่แก้ข้อมูล`,
          refType: "assistant_action_proposal",
        });
        return {
          ...proposal,
          provider: assistantConfig.provider,
          model:
            assistantConfig.provider === "ollama"
              ? assistantConfig.ollamaModel
              : assistantConfig.deepseekModel,
        };
      } catch (error) {
        if (
          (error instanceof DeepSeekAssistantError ||
            error instanceof OllamaAssistantError) &&
          error.kind === "timeout"
        ) {
          throw new TRPCError({
            code: "TIMEOUT",
            message: "AI ใช้เวลาสร้างแผนนานเกินไป กรุณาลองใหม่",
          });
        }
        if (
          error instanceof OllamaAssistantError &&
          error.kind === "model_not_found"
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `ยังไม่พบโมเดล ${assistantConfig.ollamaModel} ใน Ollama`,
          });
        }
        if (
          error instanceof OllamaAssistantError &&
          error.kind === "unavailable"
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "เชื่อมต่อ Ollama ไม่ได้ กรุณาเปิด Ollama แล้วลองใหม่",
          });
        }
        console.error("Formula audit fix plan generation failed", {
          kind:
            error instanceof DeepSeekAssistantError ||
            error instanceof OllamaAssistantError
              ? error.kind
              : "unexpected",
          provider: assistantConfig.provider,
        });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "AI สร้างแผนแก้ไขไม่สำเร็จ กรุณาลองใหม่ภายหลัง",
        });
      }
    }),

  approveFormulaAuditFixPlan: adminQuery
    .input(
      z
        .object({
          proposalId: z.string().uuid(),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      const result = await approveFormulaAuditFixPlan({
        branchId: ctx.staff.branchId,
        staffId: ctx.staff.id,
        proposalId: input.proposalId,
      });
      if (!result.alreadyApproved) {
        logAudit({
          action: "approve_formula_audit_fix_plan",
          ...actorFromReq(ctx.req),
          detail: `อนุมัติแผน AI Auditor (${input.proposalId}) สำหรับตรวจโค้ดและทดสอบ โดยยังไม่แก้ข้อมูลหรือโค้ด`,
          refType: "assistant_action_proposal",
        });
      }
      return result;
    }),

  createFormulaAuditRemediationWorkOrder: adminQuery
    .input(
      z
        .object({
          sourceProposalId: z.string().uuid(),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      const workOrder = await createFormulaAuditRemediationWorkOrder({
        branchId: ctx.staff.branchId,
        staffId: ctx.staff.id,
        sourceProposalId: input.sourceProposalId,
      });
      logAudit({
        action: "create_formula_audit_remediation",
        ...actorFromReq(ctx.req),
        detail: `สร้างใบงานแก้ไข AI Auditor ${workOrder.workOrderId} ครอบคลุม ${workOrder.targetRules.length} กฎ โดยยังไม่แก้ข้อมูลหรือโค้ด`,
        refType: "assistant_action_proposal",
      });
      return workOrder;
    }),

  startFormulaAuditRemediationWorkOrder: adminQuery
    .input(
      z
        .object({
          workOrderId: z.string().uuid(),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      const workOrder = await startFormulaAuditRemediationWorkOrder({
        branchId: ctx.staff.branchId,
        staffId: ctx.staff.id,
        workOrderId: input.workOrderId,
      });
      if (!workOrder.alreadyStarted) {
        logAudit({
          action: "start_formula_audit_remediation",
          ...actorFromReq(ctx.req),
          detail: `เริ่มใบงานแก้ไข AI Auditor ${input.workOrderId} รอตรวจยืนยันผล`,
          refType: "assistant_action_proposal",
        });
      }
      return workOrder;
    }),

  verifyFormulaAuditRemediationWorkOrder: adminQuery
    .input(
      z
        .object({
          workOrderId: z.string().uuid(),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      const verification = await verifyFormulaAuditRemediationWorkOrder({
        branchId: ctx.staff.branchId,
        staffId: ctx.staff.id,
        workOrderId: input.workOrderId,
      });
      if (!verification.alreadyVerified) {
        logAudit({
          action: "verify_formula_audit_remediation",
          ...actorFromReq(ctx.req),
          detail: verification.passed
            ? `ตรวจยืนยันใบงาน AI Auditor ${input.workOrderId} ผ่านจากผล Audit ล่าสุด`
            : `ตรวจยืนยันใบงาน AI Auditor ${input.workOrderId} ยังไม่ผ่านเกณฑ์`,
          refType: "assistant_action_proposal",
        });
      }
      return verification;
    }),

  // รายการ audit log (admin เท่านั้น) — เรียงใหม่ → เก่า กรองตาม action และคำค้น (ผู้ทำ/รายละเอียด)
  list: adminQuery
    .input(
      z
        .object({
          q: z.string().optional(),
          action: z.string().optional(),
          limit: z.number().int().positive().max(1000).default(200),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conds = [eq(auditLogs.branchId, ctx.staff.branchId)];
      if (input?.action) conds.push(eq(auditLogs.action, input.action));
      const q = input?.q?.trim();
      if (q) {
        const pattern = `%${q}%`;
        conds.push(
          or(
            like(auditLogs.actorName, pattern),
            like(auditLogs.detail, pattern)
          )!
        );
      }
      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(...conds))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(input?.limit ?? 200);
      const actionRows = await db
        .selectDistinct({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.branchId, ctx.staff.branchId))
        .orderBy(sql`${auditLogs.action}`);
      return { rows, actions: actionRows.map(row => row.action) };
    }),
});
