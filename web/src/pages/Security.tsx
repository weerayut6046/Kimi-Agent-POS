import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  History,
  LoaderCircle,
  ScanSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { SecurityEvent } from "@db/schema";

type Severity = SecurityEvent["severity"];
type EventStatus = SecurityEvent["status"];
type Category = SecurityEvent["category"];
type WindowDays = "1" | "7" | "30";

const severityLabel: Record<Severity, string> = {
  critical: "ร้ายแรง",
  warning: "เตือน",
  info: "ทราบ",
};

const statusLabel: Record<EventStatus, string> = {
  new: "ใหม่",
  acknowledged: "รับทราบแล้ว",
  resolved: "ปิดเคส",
};

const categoryLabel: Record<Category, string> = {
  auth: "ยืนยันตัวตน",
  data_tampering: "แก้ไขข้อมูล",
  permission: "สิทธิ์ผู้ใช้",
  vulnerability: "ช่องโหว่ระบบ",
  system: "ค่าตั้งระบบ",
};

const windowLabel: Record<WindowDays, string> = {
  "1": "24 ชม.",
  "7": "7 วัน",
  "30": "30 วัน",
};

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge
      variant={
        severity === "critical"
          ? "destructive"
          : severity === "warning"
            ? "outline"
            : "secondary"
      }
      className={
        severity === "warning"
          ? "border-amber-300 bg-amber-50 text-amber-700"
          : undefined
      }
    >
      {severityLabel[severity]}
    </Badge>
  );
}

export default function Security() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<EventStatus | "all">("all");
  const [category, setCategory] = useState<Category | "all">("all");
  const [windowDays, setWindowDays] = useState<WindowDays>("7");
  const [selected, setSelected] = useState<SecurityEvent | null>(null);
  const [answer, setAnswer] = useState<{ text: string; source: string } | null>(
    null
  );
  const [reportsOpen, setReportsOpen] = useState(false);
  const utils = trpc.useUtils();

  // debounce ช่องค้นหา
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const overview = trpc.security.overview.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const events = trpc.security.events.useQuery({
    severity: severity === "all" ? undefined : severity,
    status: status === "all" ? undefined : status,
    category: category === "all" ? undefined : category,
    q: search || undefined,
  });
  const reports = trpc.security.reports.useQuery({ limit: 10 });

  const invalidateEvents = () => {
    void utils.security.overview.invalidate();
    void utils.security.events.invalidate();
  };

  const scan = trpc.security.scan.useMutation({
    onSuccess: result => {
      toast.success(
        `พบ ${result.created} เหตุการณ์ใหม่ จาก ${result.scanned} รายการตรวจสอบ`
      );
      invalidateEvents();
    },
    onError: err => toast.error(err.message || "สแกนความปลอดภัยไม่สำเร็จ"),
  });
  const analyze = trpc.security.analyze.useMutation({
    onSuccess: result => {
      setAnswer({
        text: result.answer,
        source: `วิเคราะห์ย้อนหลัง ${windowLabel[windowDays]} · ${fmtDateTime(new Date())}`,
      });
      void utils.security.overview.invalidate();
      void utils.security.reports.invalidate();
    },
    onError: err =>
      toast.error(err.message || "AI ไม่สามารถวิเคราะห์ได้ในขณะนี้"),
  });
  const setEventStatus = trpc.security.setEventStatus.useMutation({
    onSuccess: (_result, vars) => {
      toast.success(
        vars.status === "resolved" ? "ปิดเคสแล้ว" : "รับทราบเหตุการณ์แล้ว"
      );
      invalidateEvents();
      setSelected(null);
    },
    onError: err => toast.error(err.message || "อัปเดตสถานะไม่สำเร็จ"),
  });

  const rows = events.data?.rows ?? [];
  const latestReport = reports.data?.[0];
  const shownAnswer =
    answer ??
    (latestReport
      ? {
          text: latestReport.answer,
          source: `รายงานล่าสุด · ย้อนหลัง ${latestReport.windowDays} วัน · ${fmtDateTime(latestReport.createdAt)}`,
        }
      : null);
  const stats = overview.data;

  return (
    <div className="space-y-5">
      <h1 className="page-heading flex items-center gap-2">
        <ShieldAlert className="w-6 h-6 text-primary" /> ความปลอดภัย
      </h1>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-red-100 bg-white/85 p-4 shadow-sm">
          <p className="text-xs font-semibold text-red-600">
            ร้ายแรง (ยังไม่รับทราบ)
          </p>
          <p className="mt-1 font-heading text-2xl font-bold text-red-700">
            {(stats?.criticalNew ?? 0).toLocaleString("th-TH")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            ต้องตรวจสอบโดยเร็ว
          </p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-white/85 p-4 shadow-sm">
          <p className="text-xs font-semibold text-amber-600">เตือน</p>
          <p className="mt-1 font-heading text-2xl font-bold text-amber-700">
            {(stats?.warningNew ?? 0).toLocaleString("th-TH")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            เหตุการณ์ที่ควรยืนยัน
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-100 bg-white/85 p-4 shadow-sm">
          <p className="text-xs font-semibold text-cyan-700">
            เหตุการณ์ 24 ชม.
          </p>
          <p className="mt-1 font-heading text-2xl font-bold text-slate-900">
            {(stats?.last24h ?? 0).toLocaleString("th-TH")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            รวมทุกระดับในช่วง 24 ชั่วโมง
          </p>
        </div>
        <div className="rounded-2xl border bg-white/85 p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">
            สแกนล่าสุด
          </p>
          <p className="mt-2 font-heading text-base font-bold text-slate-900">
            {stats?.lastScanAt ? fmtDateTime(stats.lastScanAt) : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            เวลาของเหตุการณ์ล่าสุดในระบบ
          </p>
        </div>
      </div>

      <Card className="overflow-hidden border-violet-200/80 bg-gradient-to-br from-white via-violet-50/45 to-cyan-50/55">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="flex min-w-0 gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/20">
                <ShieldAlert className="size-6" />
              </span>
              <div>
                <h2 className="font-heading text-lg font-bold text-slate-900">
                  สแกนความปลอดภัยและให้ AI วิเคราะห์
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  ตรวจหาการเข้าสู่ระบบผิดปกติ การแก้ไขข้อมูล การใช้สิทธิ์
                  และช่องโหว่ของระบบ โดยไม่แก้ไขข้อมูลใด ๆ
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={windowDays}
                onValueChange={value => setWindowDays(value as WindowDays)}
              >
                <SelectTrigger className="w-full bg-white sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">ย้อนหลัง 24 ชม.</SelectItem>
                  <SelectItem value="7">ย้อนหลัง 7 วัน</SelectItem>
                  <SelectItem value="30">ย้อนหลัง 30 วัน</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={scan.isPending || analyze.isPending}
                onClick={() =>
                  scan.mutate({ windowDays: Number(windowDays) as 1 | 7 | 30 })
                }
              >
                {scan.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ScanSearch />
                )}
                {scan.isPending ? "กำลังสแกน..." : "สแกนตอนนี้"}
              </Button>
              <Button
                type="button"
                disabled={analyze.isPending || scan.isPending}
                onClick={() =>
                  analyze.mutate({
                    windowDays: Number(windowDays) as 1 | 7 | 30,
                  })
                }
                className="bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-md shadow-violet-500/20 hover:from-violet-700 hover:to-cyan-700"
              >
                <Sparkles
                  className={analyze.isPending ? "animate-pulse" : undefined}
                />
                {analyze.isPending ? "AI กำลังวิเคราะห์..." : "ให้ AI วิเคราะห์"}
              </Button>
            </div>
          </div>

          {(scan.isError || analyze.isError) && (
            <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {scan.error?.message ||
                  analyze.error?.message ||
                  "ดำเนินการไม่สำเร็จ"}
              </span>
            </div>
          )}

          {shownAnswer && (
            <div className="rounded-2xl border border-violet-200 bg-white/90 p-4 shadow-sm sm:p-5">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                    <Sparkles className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-heading font-bold text-slate-900">
                      คำวิเคราะห์ความปลอดภัย
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {shownAnswer.source}
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
                {shownAnswer.text}
              </div>
            </div>
          )}

          {reports.data && reports.data.length > 0 && (
            <Collapsible open={reportsOpen} onOpenChange={setReportsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-between text-violet-700 hover:bg-violet-50 hover:text-violet-800"
                >
                  <span className="flex items-center gap-2">
                    <History className="size-4" />
                    รายงานย้อนหลัง ({reports.data.length})
                  </span>
                  <ChevronDown
                    className={`size-4 transition-transform ${reportsOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                {reports.data.map(report => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() =>
                      setAnswer({
                        text: report.answer,
                        source: `รายงานย้อนหลัง ${report.windowDays} วัน · ${report.eventCount} เหตุการณ์ · ${fmtDateTime(report.createdAt)}`,
                      })
                    }
                    className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white/80 px-4 py-2.5 text-left text-sm transition-colors hover:border-violet-200 hover:bg-violet-50/60"
                  >
                    <span className="font-medium text-slate-700">
                      ย้อนหลัง {report.windowDays} วัน · {report.eventCount}{" "}
                      เหตุการณ์
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(report.createdAt)}
                    </span>
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-0 flex-1 sm:min-w-56 sm:max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="ค้นหา เหตุการณ์ / ผู้เกี่ยวข้อง / กฎ"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <Select
          value={severity}
          onValueChange={value => setSeverity(value as Severity | "all")}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="ทุกระดับ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกระดับ</SelectItem>
            <SelectItem value="critical">ร้ายแรง</SelectItem>
            <SelectItem value="warning">เตือน</SelectItem>
            <SelectItem value="info">ทราบ</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={value => setStatus(value as EventStatus | "all")}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="ทุกสถานะ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            <SelectItem value="new">ใหม่</SelectItem>
            <SelectItem value="acknowledged">รับทราบแล้ว</SelectItem>
            <SelectItem value="resolved">ปิดเคส</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={category}
          onValueChange={value => setCategory(value as Category | "all")}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="ทุกหมวด" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกหมวด</SelectItem>
            <SelectItem value="auth">ยืนยันตัวตน</SelectItem>
            <SelectItem value="data_tampering">แก้ไขข้อมูล</SelectItem>
            <SelectItem value="permission">สิทธิ์ผู้ใช้</SelectItem>
            <SelectItem value="vulnerability">ช่องโหว่ระบบ</SelectItem>
            <SelectItem value="system">ค่าตั้งระบบ</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!events.isLoading && rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50/80 px-5 py-8 text-center">
          <ShieldCheck className="size-10 text-emerald-600" />
          <h3 className="mt-3 font-heading font-bold text-emerald-900">
            ไม่พบเหตุการณ์
          </h3>
          <p className="mt-1 text-sm text-emerald-700">
            {search || severity !== "all" || status !== "all" || category !== "all"
              ? "ไม่พบเหตุการณ์ที่ตรงกับตัวกรอง ลองปรับเงื่อนไขการค้นหา"
              : "ยังไม่มีเหตุการณ์ความปลอดภัย — ลองกดสแกน"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>ระดับ</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead>เหตุการณ์</TableHead>
                <TableHead>ผู้เกี่ยวข้อง</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(row)}
                >
                  <TableCell className="text-sm whitespace-nowrap">
                    {fmtDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={row.severity} />
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {categoryLabel[row.category] ?? row.category}
                  </TableCell>
                  <TableCell className="min-w-72">
                    <p className="text-sm font-semibold text-slate-900">
                      {row.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.rule}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.actorName || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        row.status === "new"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : row.status === "acknowledged"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }
                    >
                      {statusLabel[row.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {events.data?.truncated && (
            <p className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
              แสดง 200 รายการแรก
              กรุณาใช้ตัวกรองหรือค้นหาเพื่อดูเหตุการณ์เฉพาะส่วน
            </p>
          )}
        </div>
      )}

      <Dialog
        open={selected !== null}
        onOpenChange={open => {
          if (!open && !setEventStatus.isPending) setSelected(null);
        }}
      >
        {selected && (
          <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-2xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
            <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  {selected.title}
                </DialogTitle>
                <SeverityBadge severity={selected.severity} />
              </div>
              <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                {categoryLabel[selected.category] ?? selected.category} ·{" "}
                {selected.rule}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/80 p-4 sm:p-6">
              <dl className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-2 sm:p-5">
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">
                    เวลา
                  </dt>
                  <dd className="mt-0.5 text-slate-900">
                    {fmtDateTime(selected.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">
                    หมวด
                  </dt>
                  <dd className="mt-0.5 text-slate-900">
                    {categoryLabel[selected.category] ?? selected.category}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">
                    กฎที่ตรวจพบ
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs break-all text-slate-900">
                    {selected.rule}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">
                    ผู้เกี่ยวข้อง
                  </dt>
                  <dd className="mt-0.5 text-slate-900">
                    {selected.actorName || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">
                    สถานะ
                  </dt>
                  <dd className="mt-0.5 text-slate-900">
                    {statusLabel[selected.status]}
                  </dd>
                </div>
              </dl>

              <div>
                <p className="text-xs font-semibold text-slate-700">
                  รายละเอียด
                </p>
                <div className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                  {JSON.stringify(selected.detail, null, 2)}
                </div>
              </div>
            </div>

            <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 sm:items-center sm:justify-end sm:px-6">
              {selected.status === "new" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={setEventStatus.isPending}
                  onClick={() =>
                    setEventStatus.mutate({
                      id: selected.id,
                      status: "acknowledged",
                    })
                  }
                >
                  {setEventStatus.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ShieldCheck />
                  )}
                  รับทราบ
                </Button>
              )}
              {selected.status !== "resolved" && (
                <Button
                  type="button"
                  disabled={setEventStatus.isPending}
                  onClick={() =>
                    setEventStatus.mutate({
                      id: selected.id,
                      status: "resolved",
                    })
                  }
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {setEventStatus.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ShieldCheck />
                  )}
                  ปิดเคส
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
