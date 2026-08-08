import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assistantActionProposals } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  FORMULA_AUDIT_FIX_PLAN_ACTION,
  formulaAuditIssueFingerprint,
  formulaAuditFixPlanSchema,
  storedFormulaAuditFixPlanSchema,
} from "./formulaAuditFixPlan";
import { loadFormulaAuditReport } from "./formulaAuditReport";

export const FORMULA_AUDIT_REMEDIATION_ACTION =
  "formula_audit_remediation_work_order";
const WORK_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const targetRuleSchema = z
  .object({
    rule: z.string().trim().min(1).max(80),
    severity: z.enum(["critical", "warning"]),
    baselineCount: z.number().int().positive(),
  })
  .strict();

const baselineRuleSchema = z
  .object({
    rule: z.string().trim().min(1).max(80),
    count: z.number().int().positive(),
  })
  .strict();

export const formulaAuditRemediationPayloadSchema = z
  .object({
    version: z.literal(1),
    sourceProposalId: z.string().uuid(),
    days: z.number().int().min(1).max(365),
    baselineFingerprint: z.string().length(64),
    baseline: z
      .object({
        total: z.number().int().nonnegative(),
        critical: z.number().int().nonnegative(),
        targetTotal: z.number().int().positive(),
        targetCritical: z.number().int().nonnegative(),
      })
      .strict(),
    targetRules: z.array(targetRuleSchema).min(1).max(26),
    baselineRules: z.array(baselineRuleSchema).min(1).max(26),
    sourceFiles: z.array(z.string().trim().min(1).max(180)).min(1).max(12),
    plan: formulaAuditFixPlanSchema,
  })
  .strict();

type RemediationPayload = z.infer<typeof formulaAuditRemediationPayloadSchema>;

const acceptanceCriteria = [
  "กฎเป้าหมายทั้งหมดต้องไม่พบความผิดปกติจาก Audit รอบใหม่",
  "จำนวน critical ต้องลดลงตามจำนวน critical ของกฎเป้าหมาย และห้ามมี critical ใหม่มาทดแทน",
  "จำนวนปัญหารวมต้องลดลงอย่างน้อยตามจำนวนปัญหาเป้าหมาย",
  "จำนวนความผิดปกติของกฎอื่นต้องไม่เพิ่มขึ้นจาก Audit ตั้งต้น",
  "ต้องผ่าน regression tests, TypeScript, lint และ production build ก่อน deploy",
  "ห้ามแก้ข้อมูล production ย้อนหลังโดยไม่มีหลักฐานและการอนุมัติแยกต่างหาก",
] as const;

function developerPrompt(payload: RemediationPayload) {
  const steps = payload.plan.steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.title}\n` +
        `   Rules: ${step.relatedRules.join(", ")}\n` +
        `   Files: ${step.sourceFiles.join(", ")}\n` +
        `   Changes: ${step.changeOutline.join(" | ")}\n` +
        `   Tests: ${step.verification.join(" | ")}\n` +
        `   Rollback: ${step.rollback}`
    )
    .join("\n\n");
  return `งานแก้ไขจาก AI Auditor (ต้อง review ก่อน merge/deploy)

เป้าหมาย: ${payload.plan.summary}
กฎที่ต้องแก้: ${payload.targetRules.map(row => row.rule).join(", ")}
ขอบเขตไฟล์: ${payload.sourceFiles.join(", ")}

ขั้นตอนที่อนุมัติ:
${steps}

เกณฑ์ผ่าน:
${acceptanceCriteria.map(item => `- ${item}`).join("\n")}

ข้อห้าม: อย่าแก้ข้อมูล production, อย่าขยายขอบเขตนอกไฟล์ที่ระบุ และอย่า deploy ก่อน tests/review ผ่าน`;
}

function presentWorkOrder(
  proposal: {
    id: string;
    status:
      | "pending"
      | "processing"
      | "succeeded"
      | "failed"
      | "expired"
      | "cancelled";
    expiresAt: Date;
    executedAt: Date | null;
    resultSummary: string | null;
  },
  payload: RemediationPayload
) {
  return {
    workOrderId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    completedAt: proposal.executedAt,
    resultSummary: proposal.resultSummary,
    targetRules: payload.targetRules,
    sourceFiles: payload.sourceFiles,
    acceptanceCriteria: [...acceptanceCriteria],
    developerPrompt: developerPrompt(payload),
    plan: payload.plan,
  };
}

async function ownedWorkOrder(options: {
  branchId: number;
  staffId: number;
  workOrderId: string;
}) {
  const proposal = await getDb().query.assistantActionProposals.findFirst({
    where: and(
      eq(assistantActionProposals.id, options.workOrderId),
      eq(assistantActionProposals.branchId, options.branchId),
      eq(assistantActionProposals.staffId, options.staffId),
      eq(assistantActionProposals.action, FORMULA_AUDIT_REMEDIATION_ACTION)
    ),
  });
  if (!proposal) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "ไม่พบใบงานแก้ไข หรือใบงานนี้ไม่ได้เป็นของคุณ",
    });
  }
  return {
    proposal,
    payload: formulaAuditRemediationPayloadSchema.parse(proposal.payload),
  };
}

export async function createFormulaAuditRemediationWorkOrder(options: {
  branchId: number;
  staffId: number;
  sourceProposalId: string;
}) {
  const db = getDb();
  const source = await db.query.assistantActionProposals.findFirst({
    where: and(
      eq(assistantActionProposals.id, options.sourceProposalId),
      eq(assistantActionProposals.branchId, options.branchId),
      eq(assistantActionProposals.staffId, options.staffId),
      eq(assistantActionProposals.action, FORMULA_AUDIT_FIX_PLAN_ACTION)
    ),
  });
  if (!source || source.status !== "succeeded") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ต้องอนุมัติแผนแก้ไขก่อนสร้างใบงาน",
    });
  }
  const storedPlan = storedFormulaAuditFixPlanSchema.parse(source.payload);
  const report = await loadFormulaAuditReport(
    options.branchId,
    storedPlan.days
  );
  if (
    formulaAuditIssueFingerprint(report.issues) !== storedPlan.issueFingerprint
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ผล Audit เปลี่ยนแปลงแล้ว กรุณาสร้างและอนุมัติแผนใหม่",
    });
  }

  const targetRuleNames = new Set(
    storedPlan.plan.steps.flatMap(step => step.relatedRules)
  );
  const targetRules = [...targetRuleNames]
    .map(rule => {
      const issues = report.issues.filter(issue => issue.rule === rule);
      const severity = issues.some(issue => issue.severity === "critical")
        ? "critical"
        : "warning";
      return { rule, severity, baselineCount: issues.length } as const;
    })
    .filter(row => row.baselineCount > 0);
  if (!targetRules.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "กฎในแผนไม่พบความผิดปกติแล้ว กรุณาตรวจ Audit อีกครั้ง",
    });
  }
  const sourceFiles = [
    ...new Set(storedPlan.plan.steps.flatMap(step => step.sourceFiles)),
  ];
  const targetTotal = targetRules.reduce(
    (sum, row) => sum + row.baselineCount,
    0
  );
  const targetCritical = targetRules
    .filter(row => row.severity === "critical")
    .reduce((sum, row) => sum + row.baselineCount, 0);
  const baselineRuleCounts = new Map<string, number>();
  for (const issue of report.issues) {
    baselineRuleCounts.set(
      issue.rule,
      (baselineRuleCounts.get(issue.rule) ?? 0) + 1
    );
  }
  const payload = formulaAuditRemediationPayloadSchema.parse({
    version: 1,
    sourceProposalId: source.id,
    days: storedPlan.days,
    baselineFingerprint: storedPlan.issueFingerprint,
    baseline: {
      total: report.issues.length,
      critical: report.issues.filter(issue => issue.severity === "critical")
        .length,
      targetTotal,
      targetCritical,
    },
    targetRules,
    baselineRules: [...baselineRuleCounts].map(([rule, count]) => ({
      rule,
      count,
    })),
    sourceFiles,
    plan: storedPlan.plan,
  });
  const idempotencyKey = createHash("sha256")
    .update(
      JSON.stringify({
        kind: FORMULA_AUDIT_REMEDIATION_ACTION,
        sourceProposalId: source.id,
        branchId: options.branchId,
        staffId: options.staffId,
      })
    )
    .digest("hex");
  const [created] = await db
    .insert(assistantActionProposals)
    .values({
      branchId: options.branchId,
      staffId: options.staffId,
      idempotencyKey,
      action: FORMULA_AUDIT_REMEDIATION_ACTION,
      payload,
      title: "ใบงานแก้ไข AI Auditor",
      summary: storedPlan.plan.summary,
      risk: "standard",
      expiresAt: new Date(Date.now() + WORK_ORDER_TTL_MS),
    })
    .onConflictDoNothing({
      target: assistantActionProposals.idempotencyKey,
    })
    .returning();
  const proposal =
    created ??
    (await db.query.assistantActionProposals.findFirst({
      where: eq(assistantActionProposals.idempotencyKey, idempotencyKey),
    }));
  if (!proposal) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "สร้างใบงานแก้ไขไม่สำเร็จ กรุณาลองใหม่",
    });
  }
  return presentWorkOrder(
    proposal,
    formulaAuditRemediationPayloadSchema.parse(proposal.payload)
  );
}

export async function startFormulaAuditRemediationWorkOrder(options: {
  branchId: number;
  staffId: number;
  workOrderId: string;
}) {
  const db = getDb();
  const { proposal, payload } = await ownedWorkOrder(options);
  if (proposal.status === "processing" || proposal.status === "succeeded") {
    return { ...presentWorkOrder(proposal, payload), alreadyStarted: true };
  }
  if (proposal.status !== "pending") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "ใบงานนี้ไม่อยู่ในสถานะที่เริ่มได้",
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
      message: "ใบงานหมดอายุแล้ว กรุณาสร้างแผนใหม่",
    });
  }
  const [started] = await db
    .update(assistantActionProposals)
    .set({
      status: "processing",
      resultSummary: "เริ่มงานแก้ไขแล้ว รอตรวจยืนยันผล Audit",
    })
    .where(
      and(
        eq(assistantActionProposals.id, proposal.id),
        eq(assistantActionProposals.status, "pending")
      )
    )
    .returning();
  if (!started) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "ใบงานกำลังเริ่มหรือเริ่มไปแล้ว",
    });
  }
  return {
    ...presentWorkOrder(started, payload),
    alreadyStarted: false,
  };
}

export async function verifyFormulaAuditRemediationWorkOrder(options: {
  branchId: number;
  staffId: number;
  workOrderId: string;
}) {
  const db = getDb();
  const { proposal, payload } = await ownedWorkOrder(options);
  if (proposal.status === "succeeded") {
    return {
      ...presentWorkOrder(proposal, payload),
      passed: true,
      alreadyVerified: true,
      remaining: payload.targetRules.map(row => ({
        rule: row.rule,
        count: 0,
      })),
      newOrIncreasedRules: [],
    };
  }
  if (proposal.status !== "processing") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "กรุณาเริ่มใบงานก่อนตรวจยืนยันผล",
    });
  }
  const report = await loadFormulaAuditReport(options.branchId, payload.days);
  const remaining = payload.targetRules.map(target => ({
    rule: target.rule,
    count: report.issues.filter(issue => issue.rule === target.rule).length,
  }));
  const currentCritical = report.issues.filter(
    issue => issue.severity === "critical"
  ).length;
  const currentRuleCounts = new Map<string, number>();
  for (const issue of report.issues) {
    currentRuleCounts.set(
      issue.rule,
      (currentRuleCounts.get(issue.rule) ?? 0) + 1
    );
  }
  const baselineRuleCounts = new Map(
    payload.baselineRules.map(row => [row.rule, row.count])
  );
  const newOrIncreasedRules = [...currentRuleCounts]
    .filter(([rule, count]) => count > (baselineRuleCounts.get(rule) ?? 0))
    .map(([rule, count]) => ({
      rule,
      baselineCount: baselineRuleCounts.get(rule) ?? 0,
      currentCount: count,
    }));
  const maximumCritical =
    payload.baseline.critical - payload.baseline.targetCritical;
  const maximumTotal = payload.baseline.total - payload.baseline.targetTotal;
  const passed =
    remaining.every(row => row.count === 0) &&
    newOrIncreasedRules.length === 0 &&
    currentCritical <= maximumCritical &&
    report.issues.length <= maximumTotal;
  const summary = passed
    ? "ตรวจยืนยันผ่าน: กฎเป้าหมายไม่พบความผิดปกติและไม่มีปัญหาใหม่เพิ่ม"
    : `ยังไม่ผ่าน: เหลือกฎเป้าหมาย ${remaining.filter(row => row.count > 0).length} กฎ, กฎใหม่/เพิ่มขึ้น ${newOrIncreasedRules.length} กฎ, critical ${currentCritical}/${maximumCritical}, ปัญหารวม ${report.issues.length}/${maximumTotal}`;
  const [updated] = await db
    .update(assistantActionProposals)
    .set({
      status: passed ? "succeeded" : "processing",
      executedAt: passed ? new Date() : null,
      resultSummary: summary,
    })
    .where(
      and(
        eq(assistantActionProposals.id, proposal.id),
        eq(assistantActionProposals.status, "processing")
      )
    )
    .returning();
  if (!updated) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "สถานะใบงานเปลี่ยนระหว่างการตรวจ กรุณาลองใหม่",
    });
  }
  return {
    ...presentWorkOrder(updated, payload),
    passed,
    alreadyVerified: false,
    remaining,
    newOrIncreasedRules,
    metrics: {
      currentCritical,
      maximumCritical,
      currentTotal: report.issues.length,
      maximumTotal,
    },
  };
}
