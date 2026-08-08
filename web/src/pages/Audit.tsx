import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  FileCode2,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TestTube2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/providers/trpc";
import { fmtDateTime } from "@/lib/format";

const formulaCategoryLabel: Record<string, string> = {
  sales: "ยอดขายและ VAT",
  shifts: "กะและมิเตอร์",
  payroll: "เงินเดือน",
  inventory: "สต็อกและถัง",
};

const fixRiskLabel = {
  low: "ความเสี่ยงต่ำ",
  medium: "ความเสี่ยงปานกลาง",
  high: "ความเสี่ยงสูง",
};

const fixPriorityLabel = {
  critical: "เร่งด่วน",
  high: "สูง",
  medium: "ปานกลาง",
  low: "ต่ำ",
};

const downtimeLabel = {
  none: "ไม่คาดว่าจะหยุดระบบ",
  possible: "อาจต้องหยุดระบบชั่วคราว",
  required: "ต้องวางแผนหยุดระบบ",
};

const fmtAuditValue = (value: number | null) =>
  value == null
    ? "-"
    : value.toLocaleString("th-TH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3,
      });

/** label ภาษาไทยของ action — ถ้าไม่รู้จักแสดง action ดิบ */
const actionLabel: Record<string, string> = {
  void_sale: "ยกเลิกบิล",
  return_sale: "คืนสินค้า",
  update_sale: "แก้ไขบิล",
  delete_sale: "ลบบิล",
  adjust_points: "ปรับแต้ม",
  update_price: "เปลี่ยนราคา",
  create_staff: "เพิ่มพนักงาน",
  update_staff: "แก้ไขพนักงาน",
  delete_staff: "ลบพนักงาน",
  restore_db: "กู้คืนฐานข้อมูล",
  restore_upload: "กู้คืนจากอัปโหลด",
  record_restore_drill: "บันทึกผลซ้อมกู้คืน",
  create_expense: "เพิ่มค่าใช้จ่าย",
  update_expense: "แก้ค่าใช้จ่าย",
  remove_expense: "ลบค่าใช้จ่าย",
  receive_debt_payment: "รับชำระหนี้",
  remove_debt_payment: "ลบการชำระหนี้",
  analyze_formula_audit: "AI วิเคราะห์ผลตรวจ",
  create_formula_audit_fix_plan: "AI สร้างแผนแก้ไข",
  approve_formula_audit_fix_plan: "อนุมัติแผนแก้ไข AI",
  create_formula_audit_remediation: "สร้างใบงานแก้ไข AI",
  start_formula_audit_remediation: "เริ่มใบงานแก้ไข AI",
  verify_formula_audit_remediation: "ตรวจยืนยันใบงาน AI",
};

export default function Audit() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [auditDays, setAuditDays] = useState("30");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const utils = trpc.useUtils();

  // debounce ช่องค้นหา
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = trpc.audit.list.useQuery({
    q: search || undefined,
    action: action === "all" ? undefined : action,
  });
  const rows = data?.rows ?? [];
  const actions = data?.actions ?? [];
  const formulaAudit = trpc.audit.formulaAudit.useQuery({
    days: Number(auditDays),
  });
  const aiAnalysis = trpc.audit.analyzeFormulaAudit.useMutation();
  const fixPlan = trpc.audit.createFormulaAuditFixPlan.useMutation();
  const approveFixPlan = trpc.audit.approveFormulaAuditFixPlan.useMutation({
    onSuccess: () => {
      setApprovalOpen(false);
      void utils.audit.list.invalidate();
    },
  });
  const createWorkOrder =
    trpc.audit.createFormulaAuditRemediationWorkOrder.useMutation({
      onSuccess: () => void utils.audit.list.invalidate(),
    });
  const startWorkOrder =
    trpc.audit.startFormulaAuditRemediationWorkOrder.useMutation({
      onSuccess: () => void utils.audit.list.invalidate(),
    });
  const verifyWorkOrder =
    trpc.audit.verifyFormulaAuditRemediationWorkOrder.useMutation({
      onSuccess: () => void utils.audit.list.invalidate(),
    });
  const result = formulaAudit.data;
  const scannedTotal = result
    ? result.scanned.sales +
      result.scanned.shifts +
      result.scanned.payrollRecords +
      result.scanned.products +
      result.scanned.tanks
    : 0;
  const resetAiWork = () => {
    aiAnalysis.reset();
    fixPlan.reset();
    approveFixPlan.reset();
    createWorkOrder.reset();
    startWorkOrder.reset();
    verifyWorkOrder.reset();
    setApprovalOpen(false);
  };
  const activeWorkOrder =
    verifyWorkOrder.data ?? startWorkOrder.data ?? createWorkOrder.data;

  const copyDeveloperHandoff = async () => {
    if (!activeWorkOrder) return;
    try {
      await navigator.clipboard.writeText(activeWorkOrder.developerPrompt);
      toast.success("คัดลอก Developer Handoff แล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ กรุณาดาวน์โหลดไฟล์แทน");
    }
  };

  const downloadDeveloperHandoff = () => {
    if (!activeWorkOrder) return;
    const content = JSON.stringify(
      {
        workOrderId: activeWorkOrder.workOrderId,
        status: activeWorkOrder.status,
        targetRules: activeWorkOrder.targetRules,
        sourceFiles: activeWorkOrder.sourceFiles,
        acceptanceCriteria: activeWorkOrder.acceptanceCriteria,
        developerPrompt: activeWorkOrder.developerPrompt,
      },
      null,
      2
    );
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json;charset=utf-8" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai-auditor-work-order-${activeWorkOrder.workOrderId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <h1 className="page-heading flex items-center gap-2">
        <ScrollText className="w-6 h-6 text-primary" /> บันทึกการใช้งาน
      </h1>

      <Card className="overflow-hidden border-violet-200/80 bg-gradient-to-br from-white via-violet-50/45 to-cyan-50/55">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="flex min-w-0 gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/20">
                <Bot className="size-6" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-lg font-bold text-slate-900">
                    AI Auditor ตรวจสอบสูตรและความสมบูรณ์ของข้อมูล
                  </h2>
                  {result && (
                    <Badge
                      variant={
                        result.status === "critical"
                          ? "destructive"
                          : result.status === "warning"
                            ? "outline"
                            : "secondary"
                      }
                      className={
                        result.status === "warning"
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : result.status === "healthy"
                            ? "bg-emerald-100 text-emerald-700"
                            : undefined
                      }
                    >
                      {result.status === "critical"
                        ? "พบจุดผิดปกติ"
                        : result.status === "warning"
                          ? "ควรตรวจสอบ"
                          : "ไม่พบความผิดปกติ"}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  ตรวจซ้ำด้วยกฎคำนวณอิสระ โดยไม่แก้ไขข้อมูล ครอบคลุมบิลขาย VAT
                  เงินทอน ยอดปิดกะ เงินเดือน และค่าผิดปกติของสต็อก
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={auditDays}
                onValueChange={value => {
                  setAuditDays(value);
                  resetAiWork();
                }}
              >
                <SelectTrigger className="w-full bg-white sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">ย้อนหลัง 7 วัน</SelectItem>
                  <SelectItem value="30">ย้อนหลัง 30 วัน</SelectItem>
                  <SelectItem value="90">ย้อนหลัง 90 วัน</SelectItem>
                  <SelectItem value="365">ย้อนหลัง 1 ปี</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={formulaAudit.isFetching}
                onClick={() => {
                  resetAiWork();
                  void formulaAudit.refetch();
                }}
              >
                <RefreshCw
                  className={
                    formulaAudit.isFetching ? "animate-spin" : undefined
                  }
                />
                {formulaAudit.isFetching ? "กำลังตรวจ..." : "ตรวจสอบอีกครั้ง"}
              </Button>
              <Button
                type="button"
                disabled={
                  !result?.counts.total ||
                  formulaAudit.isFetching ||
                  aiAnalysis.isPending
                }
                onClick={() => {
                  fixPlan.reset();
                  approveFixPlan.reset();
                  createWorkOrder.reset();
                  startWorkOrder.reset();
                  verifyWorkOrder.reset();
                  aiAnalysis.mutate({ days: Number(auditDays) });
                }}
                className="bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-md shadow-violet-500/20 hover:from-violet-700 hover:to-cyan-700"
              >
                <Sparkles
                  className={aiAnalysis.isPending ? "animate-pulse" : undefined}
                />
                {aiAnalysis.isPending
                  ? "AI กำลังวิเคราะห์..."
                  : "ให้ AI วิเคราะห์"}
              </Button>
            </div>
          </div>

          {formulaAudit.isError && (
            <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {formulaAudit.error.message || "ไม่สามารถตรวจสอบข้อมูลได้"}
              </span>
            </div>
          )}

          {formulaAudit.isLoading && !result && (
            <div className="flex items-center gap-2 rounded-xl border border-violet-100 bg-white/80 p-4 text-sm text-violet-700">
              <RefreshCw className="size-4 animate-spin" />{" "}
              กำลังตรวจสอบสูตรและข้อมูล...
            </div>
          )}

          {aiAnalysis.isError && (
            <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {aiAnalysis.error.message ||
                  "AI ไม่สามารถวิเคราะห์ผลตรวจได้ในขณะนี้"}
              </span>
            </div>
          )}

          {aiAnalysis.data && (
            <div className="rounded-2xl border border-violet-200 bg-white/90 p-4 shadow-sm sm:p-5">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                    <Sparkles className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-heading font-bold text-slate-900">
                      คำวิเคราะห์และแนวทางตรวจแก้
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      วิเคราะห์ {aiAnalysis.data.issuesAnalyzed} จุด จาก{" "}
                      {aiAnalysis.data.groupsAnalyzed} กฎ ·{" "}
                      {aiAnalysis.data.model ?? "กฎตรวจสอบภายใน"}
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="w-fit border-emerald-200 bg-emerald-50 text-emerald-700"
                >
                  <ShieldCheck className="size-3" /> อ่านอย่างเดียว
                </Badge>
              </div>
              <div className="mt-4 whitespace-pre-wrap rounded-xl border border-violet-100 bg-violet-50/45 p-4 text-sm leading-7 text-slate-700">
                {aiAnalysis.data.answer}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                ส่งให้ AI เฉพาะชื่อกฎ จำนวนครั้ง และจุดตรวจโค้ด โดยไม่ส่งเลขบิล
                ชื่อบุคคล หรือยอดเงินจริง
              </p>
              <div className="mt-4 flex flex-col gap-2 border-t border-violet-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500">
                  ขั้นต่อไป: สร้างแผนที่มีผลกระทบ ชุดทดสอบ และ rollback
                  เพื่อให้ผู้ดูแลตรวจและอนุมัติ
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={fixPlan.isPending}
                  onClick={() => {
                    approveFixPlan.reset();
                    createWorkOrder.reset();
                    startWorkOrder.reset();
                    verifyWorkOrder.reset();
                    fixPlan.mutate({
                      days: Number(auditDays),
                      requestId: crypto.randomUUID(),
                    });
                  }}
                  className="shrink-0 border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
                >
                  {fixPlan.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ClipboardCheck />
                  )}
                  {fixPlan.isPending ? "AI กำลังสร้างแผน..." : "สร้างแผนแก้ไข"}
                </Button>
              </div>
            </div>
          )}

          {fixPlan.isError && (
            <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {fixPlan.error.message || "AI ไม่สามารถสร้างแผนแก้ไขได้"}
              </span>
            </div>
          )}

          {fixPlan.data && (
            <div className="rounded-2xl border border-indigo-200 bg-white/95 p-4 shadow-sm sm:p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
                    <ClipboardCheck className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-heading font-bold text-slate-900">
                      แผนแก้ไขที่รอการอนุมัติ
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                      {fixPlan.data.plan.summary}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fixPlan.data.model} · ครอบคลุม{" "}
                      {fixPlan.data.issuesIncluded} จุด · หมดอายุ{" "}
                      {fmtDateTime(fixPlan.data.expiresAt)}
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    fixPlan.data.plan.risk === "high"
                      ? "w-fit border-red-200 bg-red-50 text-red-700"
                      : fixPlan.data.plan.risk === "medium"
                        ? "w-fit border-amber-200 bg-amber-50 text-amber-700"
                        : "w-fit border-emerald-200 bg-emerald-50 text-emerald-700"
                  }
                >
                  <ShieldAlert className="size-3" />
                  {fixRiskLabel[fixPlan.data.plan.risk]}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <p className="text-xs font-bold text-slate-700">
                    ผลกระทบธุรกิจ
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {fixPlan.data.plan.impact.business}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <p className="text-xs font-bold text-slate-700">
                    ผลต่อข้อมูล
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {fixPlan.data.plan.impact.data}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <p className="text-xs font-bold text-slate-700">
                    การให้บริการ
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {downtimeLabel[fixPlan.data.plan.impact.downtime]}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {fixPlan.data.plan.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className="rounded-xl border border-indigo-100 bg-indigo-50/35 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-indigo-600">
                          ขั้นที่ {index + 1} ·{" "}
                          {fixPriorityLabel[step.priority]}
                        </p>
                        <h4 className="mt-1 font-heading font-bold text-slate-900">
                          {step.title}
                        </h4>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {step.relatedRules.map(rule => (
                          <Badge key={rule} variant="outline">
                            {rule}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {step.reason}
                    </p>
                    <div className="mt-3 grid gap-3 lg:grid-cols-3">
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                          <FileCode2 className="size-3.5 text-indigo-600" />
                          จุดแก้ไข
                        </p>
                        <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-600">
                          {step.sourceFiles.map(file => (
                            <li key={file} className="font-mono break-all">
                              {file}
                            </li>
                          ))}
                          {step.changeOutline.map(change => (
                            <li key={change}>• {change}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                          <TestTube2 className="size-3.5 text-emerald-600" />
                          การยืนยันผล
                        </p>
                        <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-600">
                          {step.verification.map(test => (
                            <li key={test}>• {test}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                          <RotateCcw className="size-3.5 text-amber-600" />
                          Rollback
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          {step.rollback}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-amber-800">
                  การอนุมัติจะบันทึกว่าแผนพร้อมเข้าสู่ขั้นตรวจโค้ดและทดสอบ
                  แต่จะยังไม่แก้โค้ดหรือข้อมูลใด ๆ
                </p>
                {approveFixPlan.data?.ok ||
                fixPlan.data.status === "succeeded" ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge className="w-fit bg-emerald-600 text-white">
                      <CheckCircle2 className="size-3" /> อนุมัติแล้ว
                    </Badge>
                    {!activeWorkOrder && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={createWorkOrder.isPending}
                        onClick={() =>
                          createWorkOrder.mutate({
                            sourceProposalId: fixPlan.data.proposalId,
                          })
                        }
                        className="bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        {createWorkOrder.isPending ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <ClipboardCheck />
                        )}
                        {createWorkOrder.isPending
                          ? "กำลังสร้างใบงาน..."
                          : "สร้างใบงานแก้ไข"}
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button
                    type="button"
                    onClick={() => {
                      approveFixPlan.reset();
                      setApprovalOpen(true);
                    }}
                    className="shrink-0 bg-amber-600 text-white hover:bg-amber-700"
                  >
                    <ShieldCheck /> ตรวจและอนุมัติแผน
                  </Button>
                )}
              </div>
            </div>
          )}

          {(createWorkOrder.isError ||
            startWorkOrder.isError ||
            verifyWorkOrder.isError) && (
            <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {createWorkOrder.error?.message ||
                  startWorkOrder.error?.message ||
                  verifyWorkOrder.error?.message ||
                  "ดำเนินการกับใบงานไม่สำเร็จ"}
              </span>
            </div>
          )}

          {activeWorkOrder && (
            <div className="rounded-2xl border border-cyan-200 bg-white/95 p-4 shadow-sm sm:p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-100 text-cyan-700">
                    <FileCode2 className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-heading font-bold text-slate-900">
                      Developer Handoff · ใบงานแก้ไข
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      เลขที่ {activeWorkOrder.workOrderId} · หมดอายุ{" "}
                      {fmtDateTime(activeWorkOrder.expiresAt)}
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    activeWorkOrder.status === "succeeded"
                      ? "w-fit border-emerald-200 bg-emerald-50 text-emerald-700"
                      : activeWorkOrder.status === "processing"
                        ? "w-fit border-amber-200 bg-amber-50 text-amber-700"
                        : "w-fit border-cyan-200 bg-cyan-50 text-cyan-700"
                  }
                >
                  {activeWorkOrder.status === "succeeded" ? (
                    <CheckCircle2 className="size-3" />
                  ) : activeWorkOrder.status === "processing" ? (
                    <LoaderCircle className="size-3" />
                  ) : (
                    <ClipboardCheck className="size-3" />
                  )}
                  {activeWorkOrder.status === "succeeded"
                    ? "ตรวจผ่านแล้ว"
                    : activeWorkOrder.status === "processing"
                      ? "กำลังดำเนินการ"
                      : "รอเริ่มงาน"}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <p className="text-xs font-bold text-slate-700">กฎเป้าหมาย</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeWorkOrder.targetRules.map(rule => (
                      <Badge key={rule.rule} variant="outline">
                        {rule.rule} · {rule.baselineCount} จุด
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <p className="text-xs font-bold text-slate-700">ขอบเขตไฟล์</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {activeWorkOrder.sourceFiles.map(file => (
                      <li key={file} className="font-mono break-all">
                        {file}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                <p className="text-xs font-bold text-emerald-800">เกณฑ์ผ่าน</p>
                <ul className="mt-2 space-y-1.5 text-xs leading-5 text-emerald-800">
                  {activeWorkOrder.acceptanceCriteria.map(item => (
                    <li key={item} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                {activeWorkOrder.developerPrompt}
              </div>

              {verifyWorkOrder.data && !verifyWorkOrder.data.passed && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  <p className="font-bold">ผลตรวจล่าสุดยังไม่ผ่าน</p>
                  <p>{verifyWorkOrder.data.resultSummary}</p>
                  {"metrics" in verifyWorkOrder.data && (
                    <>
                      <p className="mt-1">
                        Critical {verifyWorkOrder.data.metrics.currentCritical}/
                        {verifyWorkOrder.data.metrics.maximumCritical} ·
                        ปัญหารวม {verifyWorkOrder.data.metrics.currentTotal}/
                        {verifyWorkOrder.data.metrics.maximumTotal}
                      </p>
                      {verifyWorkOrder.data.newOrIncreasedRules.length > 0 && (
                        <p className="mt-1 font-medium">
                          กฎใหม่/เพิ่มขึ้น:{" "}
                          {verifyWorkOrder.data.newOrIncreasedRules
                            .map(
                              rule =>
                                `${rule.rule} (${rule.baselineCount}→${rule.currentCount})`
                            )
                            .join(", ")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeWorkOrder.status === "succeeded" && (
                <div className="mt-3 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {activeWorkOrder.resultSummary ||
                      "ตรวจ Audit รอบใหม่ผ่านเกณฑ์และปิดใบงานแล้ว"}
                  </span>
                </div>
              )}

              <div className="mt-4 flex flex-col gap-2 border-t border-cyan-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyDeveloperHandoff()}
                >
                  <Copy /> คัดลอก Handoff
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={downloadDeveloperHandoff}
                >
                  <Download /> ดาวน์โหลด JSON
                </Button>
                <div className="sm:ml-auto">
                  {activeWorkOrder.status === "pending" && (
                    <Button
                      type="button"
                      disabled={startWorkOrder.isPending}
                      onClick={() =>
                        startWorkOrder.mutate({
                          workOrderId: activeWorkOrder.workOrderId,
                        })
                      }
                      className="bg-cyan-600 text-white hover:bg-cyan-700"
                    >
                      {startWorkOrder.isPending ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Play />
                      )}
                      {startWorkOrder.isPending ? "กำลังเริ่ม..." : "เริ่มงาน"}
                    </Button>
                  )}
                  {activeWorkOrder.status === "processing" && (
                    <Button
                      type="button"
                      disabled={verifyWorkOrder.isPending}
                      onClick={() =>
                        verifyWorkOrder.mutate({
                          workOrderId: activeWorkOrder.workOrderId,
                        })
                      }
                      className="bg-amber-600 text-white hover:bg-amber-700"
                    >
                      <RefreshCw
                        className={
                          verifyWorkOrder.isPending ? "animate-spin" : undefined
                        }
                      />
                      {verifyWorkOrder.isPending
                        ? "กำลังตรวจ Audit..."
                        : "ตรวจยืนยันผล"}
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                ใบงานนี้เป็นเอกสารส่งต่อสำหรับนักพัฒนา ระบบไม่แก้โค้ด
                ไม่แก้ข้อมูล และไม่ deploy ให้อัตโนมัติ
              </p>
            </div>
          )}

          {result && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-muted-foreground">
                    ข้อมูลที่ตรวจ
                  </p>
                  <p className="mt-1 font-heading text-2xl font-bold text-slate-900">
                    {scannedTotal.toLocaleString("th-TH")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.ruleCount} กฎ ·{" "}
                    {result.scanned.saleItems.toLocaleString("th-TH")}{" "}
                    รายการสินค้า
                  </p>
                </div>
                <div className="rounded-2xl border border-red-100 bg-white/85 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-red-600">
                    ผิดปกติสำคัญ
                  </p>
                  <p className="mt-1 font-heading text-2xl font-bold text-red-700">
                    {result.counts.critical.toLocaleString("th-TH")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ควรตรวจสอบก่อนปิดยอด
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-white/85 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-amber-600">
                    คำเตือน
                  </p>
                  <p className="mt-1 font-heading text-2xl font-bold text-amber-700">
                    {result.counts.warning.toLocaleString("th-TH")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ข้อมูลที่ควรยืนยันเพิ่มเติม
                  </p>
                </div>
                <div className="rounded-2xl border border-cyan-100 bg-white/85 p-4 shadow-sm">
                  <p className="text-xs font-semibold text-cyan-700">
                    ตรวจล่าสุด
                  </p>
                  <p className="mt-2 font-heading text-base font-bold text-slate-900">
                    {fmtDateTime(result.checkedAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    อ่านข้อมูลเท่านั้น ไม่มีการแก้ไข
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {result.categories.map(row => (
                  <Badge
                    key={row.category}
                    variant="outline"
                    className={
                      row.issues > 0
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }
                  >
                    {row.issues === 0 ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <AlertTriangle className="size-3" />
                    )}
                    {formulaCategoryLabel[row.category] ?? row.category}:{" "}
                    {row.issues}
                  </Badge>
                ))}
              </div>

              {result.counts.total === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50/80 px-5 py-8 text-center">
                  <CheckCircle2 className="size-10 text-emerald-600" />
                  <h3 className="mt-3 font-heading font-bold text-emerald-900">
                    ไม่พบความผิดปกติจากกฎที่ตรวจ
                  </h3>
                  <p className="mt-1 text-sm text-emerald-700">
                    สูตรและข้อมูลในช่วงเวลาที่เลือกสอดคล้องกัน
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ระดับ</TableHead>
                        <TableHead>กลุ่ม</TableHead>
                        <TableHead>สิ่งที่พบ</TableHead>
                        <TableHead className="text-right">ค่าจริง</TableHead>
                        <TableHead className="text-right">
                          ค่าที่ควรเป็น
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.issues.map(row => (
                        <TableRow key={row.id}>
                          <TableCell className="align-top">
                            <Badge
                              variant={
                                row.severity === "critical"
                                  ? "destructive"
                                  : "outline"
                              }
                              className={
                                row.severity === "warning"
                                  ? "border-amber-300 bg-amber-50 text-amber-700"
                                  : undefined
                              }
                            >
                              {row.severity === "critical"
                                ? "สำคัญ"
                                : "คำเตือน"}
                            </Badge>
                          </TableCell>
                          <TableCell className="align-top text-sm whitespace-nowrap">
                            {formulaCategoryLabel[row.category] ?? row.category}
                          </TableCell>
                          <TableCell className="min-w-72 align-top">
                            <p className="text-sm font-semibold text-slate-900">
                              {row.title}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {row.detail}
                            </p>
                            <p className="mt-1 text-xs text-violet-700">
                              แนะนำ: {row.suggestion}
                            </p>
                          </TableCell>
                          <TableCell className="align-top text-right font-mono text-sm">
                            {fmtAuditValue(row.actual)}
                          </TableCell>
                          <TableCell className="align-top text-right font-mono text-sm font-semibold">
                            {fmtAuditValue(row.expected)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {result.truncated && (
                    <p className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
                      แสดง 200 รายการแรก
                      กรุณาเลือกระยะเวลาที่สั้นลงเพื่อตรวจรายละเอียด
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-slate-900">
        <ScrollText className="size-5 text-primary" /> บันทึกการใช้งาน
      </h2>

      <div className="flex gap-3 flex-wrap">
        <div className="relative min-w-0 flex-1 sm:min-w-56 sm:max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="ค้นหา ผู้ทำ / รายละเอียด"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="ทุกการกระทำ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกการกระทำ</SelectItem>
            {actions.map(a => (
              <SelectItem key={a} value={a}>
                {actionLabel[a] ?? a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>ผู้ทำ</TableHead>
                <TableHead>การกระทำ</TableHead>
                <TableHead>รายละเอียด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {fmtDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.actorName || "-"}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {actionLabel[r.action] ?? r.action}
                  </TableCell>
                  <TableCell className="text-sm">{r.detail}</TableCell>
                </TableRow>
              ))}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-8"
                  >
                    {search || action !== "all"
                      ? "ไม่พบรายการที่ค้นหา"
                      : "ยังไม่มีบันทึกการใช้งาน"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog
        open={approvalOpen}
        onOpenChange={open => {
          if (!approveFixPlan.isPending) setApprovalOpen(open);
        }}
      >
        <AlertDialogContent className="rounded-2xl sm:max-w-lg">
          <AlertDialogHeader>
            <div className="mb-1 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-700">
                <ShieldAlert className="size-5" />
              </span>
              <AlertDialogTitle>อนุมัติแผนแก้ไข AI Auditor</AlertDialogTitle>
            </div>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-sm leading-6">
                <p>
                  คุณกำลังอนุมัติให้แผนนี้เข้าสู่ขั้นตรวจโค้ดและทดสอบ
                  ระบบจะตรวจว่าหลักฐาน Audit
                  ยังตรงกับตอนสร้างแผนก่อนบันทึกการอนุมัติ
                </p>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
                  ขั้นตอนนี้ไม่รัน SQL ไม่แก้ข้อมูลธุรกิจ ไม่แก้ไฟล์โค้ด และไม่
                  deploy การเปลี่ยนแปลงอัตโนมัติ
                </div>
                {approveFixPlan.isError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
                    {approveFixPlan.error.message || "อนุมัติแผนไม่สำเร็จ"}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveFixPlan.isPending}>
              กลับไปตรวจแผน
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!fixPlan.data || approveFixPlan.isPending}
              onClick={event => {
                event.preventDefault();
                if (!fixPlan.data) return;
                approveFixPlan.mutate({
                  proposalId: fixPlan.data.proposalId,
                });
              }}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {approveFixPlan.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ShieldCheck />
              )}
              {approveFixPlan.isPending ? "กำลังตรวจหลักฐาน..." : "อนุมัติแผน"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
