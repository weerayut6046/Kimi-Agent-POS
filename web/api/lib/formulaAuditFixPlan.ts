import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assistantActionProposals } from "@db/schema";
import { getDb } from "../queries/connection";
import type { AssistantRuntimeConfig } from "./assistantConfig";
import { runDeepSeekAssistant, type DeepSeekAssistantTool } from "./deepseek";
import {
  aggregateFormulaAuditIssues,
  buildFormulaAuditAnalysisPrompt,
} from "./formulaAuditAnalysis";
import type { FormulaAuditIssue } from "./formulaAudit";
import {
  loadFormulaAuditReport,
  type FormulaAuditReport,
} from "./formulaAuditReport";
import { runOllamaAssistant } from "./ollama";

export const FORMULA_AUDIT_FIX_PLAN_ACTION = "approve_formula_audit_fix_plan";
const FIX_PLAN_TTL_MS = 30 * 60 * 1_000;

const safeSourcePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^web\/[a-zA-Z0-9_./-]+$/, "ไฟล์ต้องอยู่ภายใน web/")
  .refine(value => !value.includes(".."), "พาธไฟล์ไม่ถูกต้อง");

export const formulaAuditFixPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(700),
    risk: z.enum(["low", "medium", "high"]),
    impact: z
      .object({
        business: z.string().trim().min(1).max(700),
        data: z.string().trim().min(1).max(700),
        downtime: z.enum(["none", "possible", "required"]),
      })
      .strict(),
    steps: z
      .array(
        z
          .object({
            id: z
              .string()
              .trim()
              .min(1)
              .max(40)
              .regex(/^[a-z0-9_-]+$/),
            priority: z.enum(["critical", "high", "medium", "low"]),
            title: z.string().trim().min(1).max(220),
            reason: z.string().trim().min(1).max(700),
            relatedRules: z
              .array(z.string().trim().min(1).max(80))
              .min(1)
              .max(12),
            sourceFiles: z.array(safeSourcePathSchema).min(1).max(6),
            changeOutline: z
              .array(z.string().trim().min(1).max(500))
              .min(1)
              .max(6),
            verification: z
              .array(z.string().trim().min(1).max(500))
              .min(1)
              .max(6),
            rollback: z.string().trim().min(1).max(700),
          })
          .strict()
      )
      .min(1)
      .max(6),
  })
  .strict();

export type FormulaAuditFixPlan = z.infer<typeof formulaAuditFixPlanSchema>;

export const storedFormulaAuditFixPlanSchema = z
  .object({
    version: z.literal(1),
    days: z.number().int().min(1).max(365),
    issueFingerprint: z.string().length(64),
    plan: formulaAuditFixPlanSchema,
  })
  .strict();

function validatePlanAgainstReport(
  value: unknown,
  report: FormulaAuditReport
): FormulaAuditFixPlan {
  const plan = formulaAuditFixPlanSchema.parse(value);
  const allowedRules = new Set(report.issues.map(issue => issue.rule));
  const allowedSourceFiles = new Set(
    aggregateFormulaAuditIssues(report.issues).flatMap(
      group => group.sourceAreas
    )
  );

  for (const step of plan.steps) {
    if (step.relatedRules.some(rule => !allowedRules.has(rule))) {
      throw new Error("AI returned a rule that was not in the audit report");
    }
    if (step.sourceFiles.some(file => !allowedSourceFiles.has(file))) {
      throw new Error("AI returned a source file outside the approved scope");
    }
  }
  return plan;
}

function planTool(report: FormulaAuditReport): DeepSeekAssistantTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "submit_formula_audit_fix_plan",
        description:
          "Submit a structured, non-executing fix plan for the supplied formula audit groups.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "risk", "impact", "steps"],
          properties: {
            summary: { type: "string", maxLength: 700 },
            risk: { type: "string", enum: ["low", "medium", "high"] },
            impact: {
              type: "object",
              additionalProperties: false,
              required: ["business", "data", "downtime"],
              properties: {
                business: { type: "string", maxLength: 700 },
                data: { type: "string", maxLength: 700 },
                downtime: {
                  type: "string",
                  enum: ["none", "possible", "required"],
                },
              },
            },
            steps: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "id",
                  "priority",
                  "title",
                  "reason",
                  "relatedRules",
                  "sourceFiles",
                  "changeOutline",
                  "verification",
                  "rollback",
                ],
                properties: {
                  id: { type: "string", pattern: "^[a-z0-9_-]+$" },
                  priority: {
                    type: "string",
                    enum: ["critical", "high", "medium", "low"],
                  },
                  title: { type: "string", maxLength: 220 },
                  reason: { type: "string", maxLength: 700 },
                  relatedRules: {
                    type: "array",
                    minItems: 1,
                    maxItems: 12,
                    items: { type: "string" },
                  },
                  sourceFiles: {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    items: { type: "string", pattern: "^web/" },
                  },
                  changeOutline: {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    items: { type: "string" },
                  },
                  verification: {
                    type: "array",
                    minItems: 1,
                    maxItems: 6,
                    items: { type: "string" },
                  },
                  rollback: { type: "string", maxLength: 700 },
                },
              },
            },
          },
        },
      },
    },
    execute: async value => validatePlanAgainstReport(value, report),
    renderPrivateResult: value => JSON.stringify(value),
  };
}

function systemPrompt() {
  return `คุณคือ Senior Software Auditor ของ PumpPOS จงสร้างแผนแก้ไขแบบมีโครงสร้างจากผล Audit ที่รวมกลุ่มแล้ว และเรียกเครื่องมือ submit_formula_audit_fix_plan เพียงครั้งเดียว

กฎบังคับ:
- แผนนี้เป็นข้อเสนอเท่านั้น ห้ามอ้างว่าแก้ข้อมูลหรือโค้ดแล้ว
- ใช้เฉพาะ rule และ sourceAreas ที่อยู่ในข้อมูล ห้ามสร้างชื่อ rule หรือพาธไฟล์ใหม่
- ห้ามสร้าง SQL แก้ production data และห้ามเสนอการแก้ข้อมูลย้อนหลังแบบเหมารวม
- แต่ละขั้นต้องบอกเหตุผล โครงร่างการเปลี่ยนแปลง regression tests และ rollback
- จัดขั้น critical ก่อน และรวม rule ที่มี calculation path เดียวกันเมื่อเหมาะสม
- อธิบายผลกระทบธุรกิจ ผลต่อข้อมูล และ downtime ตามหลักฐานเท่านั้น
- ใช้ภาษาไทย กระชับ และไม่ใส่ข้อมูลส่วนบุคคล`;
}

export async function generateFormulaAuditFixPlan(input: {
  config: AssistantRuntimeConfig;
  report: FormulaAuditReport;
}): Promise<FormulaAuditFixPlan> {
  const tool = planTool(input.report);
  const request = {
    systemPrompt: systemPrompt(),
    conversation: [
      {
        role: "user" as const,
        content: buildFormulaAuditAnalysisPrompt(input.report),
      },
    ],
    tools: [tool],
    forcedToolName: "submit_formula_audit_fix_plan",
  };
  const result =
    input.config.provider === "ollama"
      ? await runOllamaAssistant({
          ...request,
          baseUrl: input.config.ollamaBaseUrl,
          model: input.config.ollamaModel,
          timeoutMs: input.config.ollamaTimeoutMs,
        })
      : await runDeepSeekAssistant({
          ...request,
          apiKey: input.config.deepseekApiKey,
          model: input.config.deepseekModel,
        });

  try {
    return validatePlanAgainstReport(JSON.parse(result.answer), input.report);
  } catch {
    throw new Error("AI returned an invalid formula audit fix plan");
  }
}

export function formulaAuditIssueFingerprint(issues: FormulaAuditIssue[]) {
  const evidence = issues
    .map(issue => ({
      id: issue.id,
      rule: issue.rule,
      actual: issue.actual,
      expected: issue.expected,
      difference: issue.difference,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export async function storeFormulaAuditFixPlan(options: {
  branchId: number;
  staffId: number;
  requestId: string;
  report: FormulaAuditReport;
  plan: FormulaAuditFixPlan;
}) {
  const idempotencyKey = createHash("sha256")
    .update(
      JSON.stringify({
        kind: FORMULA_AUDIT_FIX_PLAN_ACTION,
        requestId: options.requestId,
        branchId: options.branchId,
        staffId: options.staffId,
      })
    )
    .digest("hex");
  const expiresAt = new Date(Date.now() + FIX_PLAN_TTL_MS);
  const payload = storedFormulaAuditFixPlanSchema.parse({
    version: 1,
    days: options.report.period.days,
    issueFingerprint: formulaAuditIssueFingerprint(options.report.issues),
    plan: options.plan,
  });
  const db = getDb();
  const [created] = await db
    .insert(assistantActionProposals)
    .values({
      branchId: options.branchId,
      staffId: options.staffId,
      idempotencyKey,
      action: FORMULA_AUDIT_FIX_PLAN_ACTION,
      payload,
      title: "แผนแก้ไขจาก AI Auditor",
      summary: options.plan.summary,
      risk: "standard",
      expiresAt,
    })
    .onConflictDoNothing({
      target: assistantActionProposals.idempotencyKey,
    })
    .returning({
      id: assistantActionProposals.id,
      payload: assistantActionProposals.payload,
      expiresAt: assistantActionProposals.expiresAt,
      status: assistantActionProposals.status,
    });
  const proposal =
    created ??
    (await db.query.assistantActionProposals.findFirst({
      columns: {
        id: true,
        payload: true,
        expiresAt: true,
        status: true,
      },
      where: eq(assistantActionProposals.idempotencyKey, idempotencyKey),
    }));
  if (!proposal) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "สร้างแผนแก้ไขไม่สำเร็จ กรุณาลองใหม่",
    });
  }
  const stored = storedFormulaAuditFixPlanSchema.parse(proposal.payload);
  return {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    plan: stored.plan,
    issuesIncluded: options.report.issues.length,
  };
}

export async function approveFormulaAuditFixPlan(options: {
  branchId: number;
  staffId: number;
  proposalId: string;
}) {
  const db = getDb();
  const proposal = await db.query.assistantActionProposals.findFirst({
    where: and(
      eq(assistantActionProposals.id, options.proposalId),
      eq(assistantActionProposals.branchId, options.branchId),
      eq(assistantActionProposals.staffId, options.staffId),
      eq(assistantActionProposals.action, FORMULA_AUDIT_FIX_PLAN_ACTION)
    ),
  });
  if (!proposal) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "ไม่พบแผนแก้ไข หรือแผนนี้ไม่ได้เป็นของคุณ",
    });
  }
  if (proposal.status === "succeeded") {
    return {
      ok: true,
      alreadyApproved: true,
      approvedAt: proposal.executedAt,
      summary: proposal.resultSummary ?? "แผนนี้ได้รับการอนุมัติแล้ว",
    };
  }
  if (proposal.status !== "pending") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "แผนนี้ไม่อยู่ในสถานะที่อนุมัติได้ กรุณาสร้างแผนใหม่",
    });
  }
  if (proposal.expiresAt.getTime() <= Date.now()) {
    await db
      .update(assistantActionProposals)
      .set({ status: "expired" })
      .where(
        and(
          eq(assistantActionProposals.id, proposal.id),
          eq(assistantActionProposals.status, "pending")
        )
      );
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "แผนหมดอายุแล้ว กรุณาสร้างแผนใหม่จากผลตรวจล่าสุด",
    });
  }

  const stored = storedFormulaAuditFixPlanSchema.parse(proposal.payload);
  const currentReport = await loadFormulaAuditReport(
    options.branchId,
    stored.days
  );
  const currentFingerprint = formulaAuditIssueFingerprint(currentReport.issues);
  if (currentFingerprint !== stored.issueFingerprint) {
    await db
      .update(assistantActionProposals)
      .set({
        status: "cancelled",
        resultSummary: "ผล Audit เปลี่ยนแปลงก่อนอนุมัติ",
      })
      .where(
        and(
          eq(assistantActionProposals.id, proposal.id),
          eq(assistantActionProposals.status, "pending")
        )
      );
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ผล Audit เปลี่ยนแปลงแล้ว กรุณาตรวจและสร้างแผนใหม่",
    });
  }

  const approvedAt = new Date();
  const summary =
    "อนุมัติแผนสำหรับนำไปตรวจโค้ดและทดสอบ โดยยังไม่ได้แก้ไขข้อมูลหรือโค้ด";
  const [approved] = await db
    .update(assistantActionProposals)
    .set({
      status: "succeeded",
      executedAt: approvedAt,
      resultSummary: summary,
    })
    .where(
      and(
        eq(assistantActionProposals.id, proposal.id),
        eq(assistantActionProposals.status, "pending")
      )
    )
    .returning({ id: assistantActionProposals.id });
  if (!approved) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "แผนกำลังถูกอนุมัติหรือได้รับการอนุมัติแล้ว",
    });
  }
  return { ok: true, alreadyApproved: false, approvedAt, summary };
}
