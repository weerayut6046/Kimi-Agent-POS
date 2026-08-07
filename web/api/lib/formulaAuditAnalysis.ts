import type { AssistantRuntimeConfig } from "./assistantConfig";
import { runDeepSeekAssistant } from "./deepseek";
import type {
  FormulaAuditCategory,
  FormulaAuditIssue,
  FormulaAuditSeverity,
} from "./formulaAudit";
import type { FormulaAuditReport } from "./formulaAuditReport";
import { runOllamaAssistant } from "./ollama";

const MAX_ANALYSIS_GROUPS = 40;

export type FormulaAuditIssueGroup = {
  rule: string;
  category: FormulaAuditCategory;
  severity: FormulaAuditSeverity;
  title: string;
  suggestion: string;
  occurrences: number;
  sourceAreas: string[];
};

function sourceAreasForRule(rule: string): string[] {
  if (rule.startsWith("sale_")) {
    return ["web/api/routers/pos.ts", "web/api/payments/sessionService.ts"];
  }
  if (rule.startsWith("shift_")) {
    return ["web/api/routers/pos.ts", "web/api/lib/cash.ts"];
  }
  if (rule.startsWith("payroll_")) {
    return ["web/api/routers/workforce.ts"];
  }
  return ["web/api/routers/catalog.ts", "web/api/routers/stockCount.ts"];
}

/**
 * Produces a privacy-minimized summary for the model. It intentionally omits
 * receipt numbers, entity IDs, names, timestamps and all monetary values.
 */
export function aggregateFormulaAuditIssues(
  issues: FormulaAuditIssue[]
): FormulaAuditIssueGroup[] {
  const groups = new Map<string, FormulaAuditIssueGroup>();
  for (const issue of issues) {
    const existing = groups.get(issue.rule);
    if (existing) {
      existing.occurrences += 1;
      if (issue.severity === "critical") existing.severity = "critical";
      continue;
    }
    groups.set(issue.rule, {
      rule: issue.rule,
      category: issue.category,
      severity: issue.severity,
      title: issue.title,
      suggestion: issue.suggestion,
      occurrences: 1,
      sourceAreas: sourceAreasForRule(issue.rule),
    });
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        Number(b.severity === "critical") - Number(a.severity === "critical") ||
        b.occurrences - a.occurrences ||
        a.rule.localeCompare(b.rule)
    )
    .slice(0, MAX_ANALYSIS_GROUPS);
}

export function buildFormulaAuditAnalysisPrompt(report: FormulaAuditReport) {
  const groups = aggregateFormulaAuditIssues(report.issues);
  const critical = report.issues.filter(
    issue => issue.severity === "critical"
  ).length;

  return JSON.stringify({
    auditPeriodDays: report.period.days,
    totals: {
      issues: report.issues.length,
      critical,
      warning: report.issues.length - critical,
    },
    scannedRecordCounts: report.scanned,
    issueGroups: groups,
    privacyNotice:
      "ข้อมูลนี้ถูกรวมกลุ่มแล้ว ไม่มีเลขบิล รหัสรายการ ชื่อบุคคล หรือยอดเงินจริง",
  });
}

function systemPrompt() {
  return `คุณคือ AI Auditor อาวุโสของระบบ PumpPOS วิเคราะห์ข้อผิดปกติจากผลตรวจด้วยกฎคำนวณที่ backend ส่งให้เท่านั้น และตอบเป็นภาษาไทย

ข้อกำหนดสำคัญ:
- ห้ามแต่งตัวเลข เหตุการณ์ หรือยืนยันสาเหตุที่ไม่มีหลักฐาน ให้ใช้คำว่า “สาเหตุที่เป็นไปได้”
- จัดลำดับจาก critical และจำนวนครั้งที่พบก่อน
- อ้างชื่อ rule และไฟล์ใน sourceAreas เมื่อต้องชี้จุดตรวจโค้ด
- แนะนำการยืนยันกับข้อมูลต้นทางและการเพิ่ม regression test ก่อนแก้ไข
- ห้ามแนะนำให้แก้ฐานข้อมูล production โดยตรง ห้ามสร้าง SQL สำหรับแก้ข้อมูล และห้ามอ้างว่าได้แก้ไขแล้ว
- เน้นหาสาเหตุร่วม หากหลาย rule อาจมาจาก calculation path เดียวกัน

จัดคำตอบให้อ่านง่ายและมีหัวข้อตามนี้:
## สรุปความเสี่ยง
## ลำดับที่ควรตรวจ
## สาเหตุที่เป็นไปได้และจุดตรวจโค้ด
## ขั้นตอนยืนยันก่อนแก้ไข

คำตอบไม่เกิน 1,200 คำ และต้องระบุท้ายคำตอบว่า “คำวิเคราะห์นี้ไม่ได้แก้ไขข้อมูลหรือโค้ดอัตโนมัติ”`;
}

export async function runFormulaAuditAnalysis(input: {
  config: AssistantRuntimeConfig;
  report: FormulaAuditReport;
}) {
  const prompt = buildFormulaAuditAnalysisPrompt(input.report);
  const result =
    input.config.provider === "ollama"
      ? await runOllamaAssistant({
          baseUrl: input.config.ollamaBaseUrl,
          model: input.config.ollamaModel,
          timeoutMs: input.config.ollamaTimeoutMs,
          systemPrompt: systemPrompt(),
          conversation: [{ role: "user", content: prompt }],
          tools: [],
        })
      : await runDeepSeekAssistant({
          apiKey: input.config.deepseekApiKey,
          model: input.config.deepseekModel,
          systemPrompt: systemPrompt(),
          conversation: [{ role: "user", content: prompt }],
          tools: [],
        });

  return {
    answer: result.answer,
    provider: input.config.provider,
    model:
      input.config.provider === "ollama"
        ? input.config.ollamaModel
        : input.config.deepseekModel,
    analyzedAt: new Date(),
    issuesAnalyzed: input.report.issues.length,
    groupsAnalyzed: aggregateFormulaAuditIssues(input.report.issues).length,
  };
}
