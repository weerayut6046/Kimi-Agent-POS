import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Banknote,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  CircleSlash2,
  ClipboardCheck,
  Clock3,
  CreditCard,
  FileSpreadsheet,
  Fuel,
  Gauge,
  Layers3,
  PackageSearch,
  Percent,
  ReceiptText,
  RotateCcw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  WalletCards,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTableEmpty, DataTableToolbar } from "@/components/DataTablePanel";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadBase64, XLSX_MIME } from "@/lib/download";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtNum, paymentLabel } from "@/lib/format";
import { trpc } from "@/providers/trpc";

type PeriodView = "day" | "month" | "year";

const CATEGORY_COLORS: Record<"fuel" | "lubricant" | "other", string> = {
  fuel: "#6d5df4",
  lubricant: "#0ea5a4",
  other: "#f59e0b",
};

const PAYMENT_METHODS = ["cash", "qr", "card", "credit", "thungngern"] as const;
const PAYMENT_COLORS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "#16a34a",
  qr: "#6d5df4",
  card: "#0ea5e9",
  credit: "#f59e0b",
  thungngern: "#ec4899",
};

const PANEL_CLASS =
  "relative overflow-hidden rounded-[28px] border-0 bg-white/72 shadow-[0_20px_60px_rgba(38,31,91,0.08)] backdrop-blur-xl";

const chartTooltipStyle = {
  borderRadius: 14,
  border: "1px solid rgba(226,232,240,.9)",
  boxShadow: "0 16px 40px rgba(30,41,59,.12)",
  fontSize: 12,
};

function bangkokTodayParts() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    month: `${parts.year}-${parts.month}`,
    year: Number(parts.year),
  };
}

function signedMoney(value: number) {
  return `${value < 0 ? "−" : ""}฿${fmtMoney(Math.abs(value))}`;
}

function percent(value: number) {
  return `${fmtNum(value)}%`;
}

function formatShiftDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
  tone = "violet",
  negative = false,
  featured = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: "violet" | "cyan" | "amber" | "emerald" | "rose";
  negative?: boolean;
  featured?: boolean;
}) {
  const toneClass = {
    violet: "from-violet-100 to-indigo-50 text-violet-700",
    cyan: "from-cyan-100 to-sky-50 text-cyan-700",
    amber: "from-amber-100 to-orange-50 text-amber-700",
    emerald: "from-emerald-100 to-teal-50 text-emerald-700",
    rose: "from-rose-100 to-pink-50 text-rose-700",
  }[tone];
  return (
    <Card
      className={cn(
        "group relative h-full overflow-hidden rounded-[26px] border-0 transition duration-300",
        featured
          ? "bg-[radial-gradient(circle_at_85%_10%,rgba(52,211,153,.24),transparent_28%),linear-gradient(135deg,#15142f_0%,#28225d_55%,#145e64_100%)] text-white shadow-[0_22px_55px_rgba(28,24,76,0.2)]"
          : "bg-white/70 shadow-[0_14px_42px_rgba(38,31,91,0.07)] backdrop-blur-xl"
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 opacity-80",
          featured
            ? "bg-gradient-to-r from-violet-400 via-cyan-300 to-emerald-300"
            : tone === "violet"
              ? "bg-violet-500"
              : tone === "cyan"
                ? "bg-cyan-500"
                : tone === "amber"
                  ? "bg-amber-500"
                  : tone === "rose"
                    ? "bg-rose-500"
                    : "bg-emerald-500"
        )}
      />
      <CardContent className="relative p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3.5">
          <div className="min-w-0">
            <p
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.08em]",
                featured ? "text-white/55" : "text-slate-500"
              )}
            >
              {label}
            </p>
            <p
              className={cn(
                "mt-2 truncate font-heading text-xl font-extrabold tracking-[-0.045em] sm:text-2xl",
                featured
                  ? negative
                    ? "text-rose-300"
                    : "text-white"
                  : negative
                    ? "text-rose-600"
                    : "text-slate-950"
              )}
            >
              {value}
            </p>
            <p
              className={cn(
                "mt-1.5 text-[11px] leading-relaxed",
                featured ? "text-white/45" : "text-slate-400"
              )}
            >
              {detail}
            </p>
          </div>
          <span
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br transition duration-300 group-hover:rotate-3 group-hover:scale-105",
              featured ? "from-white/20 to-white/5 text-cyan-100" : toneClass
            )}
          >
            {icon}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfitValue({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        value < 0 ? "text-rose-600" : "text-emerald-700"
      )}
    >
      {signedMoney(value)}
    </span>
  );
}

function HeroMetric({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: "violet" | "emerald" | "cyan";
}) {
  const toneClass = {
    violet: "from-violet-400/25 to-indigo-400/5 text-violet-100",
    emerald: "from-emerald-400/25 to-teal-400/5 text-emerald-100",
    cyan: "from-cyan-400/25 to-sky-400/5 text-cyan-100",
  }[tone];
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-[20px] border-0 bg-gradient-to-br p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.08)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 sm:p-4",
        toneClass
      )}
    >
      <div className="absolute -right-5 -top-5 size-16 rounded-full bg-current opacity-[0.07] blur-xl" />
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/10 text-current">
          {icon}
        </span>
        <p className="truncate text-[11px] font-medium text-white/55">
          {label}
        </p>
      </div>
      <p className="relative mt-3 truncate font-heading text-lg font-bold tracking-[-0.035em] text-white tabular-nums sm:text-xl">
        {value}
      </p>
      <p className="relative mt-1 truncate text-[10px] text-white/45">
        {detail}
      </p>
    </div>
  );
}

export default function Profitability() {
  const today = useMemo(() => bangkokTodayParts(), []);
  const [view, setView] = useState<PeriodView>("day");
  const [date, setDate] = useState(today.date);
  const [month, setMonth] = useState(today.month);
  const [year, setYear] = useState(today.year);
  const [shiftId, setShiftId] = useState("all");
  const [rangeFrom, setRangeFrom] = useState(today.date);
  const [rangeTo, setRangeTo] = useState(today.date);
  const [exporting, setExporting] = useState<"daily" | "range" | null>(null);
  const [exportError, setExportError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "fuel" | "lubricant" | "other"
  >("all");
  const utils = trpc.useUtils();

  const input = useMemo(() => {
    const selectedShiftId = shiftId === "all" ? undefined : Number(shiftId);
    if (view === "day")
      return { view, date, shiftId: selectedShiftId } as const;
    if (view === "month")
      return { view, month, shiftId: selectedShiftId } as const;
    return { view, year, shiftId: selectedShiftId } as const;
  }, [date, month, shiftId, view, year]);

  const { data, isLoading, isFetching, error, refetch } =
    trpc.reports.profitability.useQuery(input, {
      enabled:
        (view === "day" && /^\d{4}-\d{2}-\d{2}$/.test(date)) ||
        (view === "month" && /^\d{4}-\d{2}$/.test(month)) ||
        view === "year",
    });

  const runExport = async (
    type: "daily" | "range",
    fetch: () => Promise<{ fileName: string; contentBase64: string }>
  ) => {
    setExportError("");
    setExporting(type);
    try {
      const file = await fetch();
      downloadBase64(file.fileName, file.contentBase64, XLSX_MIME);
    } catch (exportFailure) {
      setExportError(
        exportFailure instanceof Error
          ? exportFailure.message
          : String(exportFailure)
      );
    } finally {
      setExporting(null);
    }
  };

  const exportDaily = () =>
    runExport("daily", () => utils.reports.exportDailyExcel.fetch({ date }));
  const exportRange = () =>
    runExport("range", () =>
      utils.reports.exportRangeExcel.fetch({ from: rangeFrom, to: rangeTo })
    );

  const filteredProducts = useMemo(
    () =>
      data?.products.filter(
        product =>
          categoryFilter === "all" || product.category === categoryFilter
      ) ?? [],
    [categoryFilter, data?.products]
  );
  const topProducts = useMemo(
    () => [...filteredProducts].sort((a, b) => b.profit - a.profit).slice(0, 8),
    [filteredProducts]
  );
  const paymentChart = useMemo(
    () =>
      data
        ? PAYMENT_METHODS.map(method => ({
            method,
            label: paymentLabel[method],
            count: data.zReport.byMethod[method].count,
            total: data.zReport.byMethod[method].total,
          })).filter(item => item.count > 0 || item.total !== 0)
        : [],
    [data]
  );

  return (
    <div className="relative isolate -mx-0.5 space-y-5 pb-12 sm:space-y-6 lg:pb-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -left-24 top-72 size-80 rounded-full bg-violet-300/20 blur-[110px]" />
        <div className="absolute -right-24 top-[48rem] size-96 rounded-full bg-cyan-300/20 blur-[120px]" />
      </div>

      <section className="relative isolate overflow-hidden rounded-[34px] bg-[#111329] text-white shadow-[0_34px_100px_rgba(25,24,73,0.28)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_76%_12%,rgba(34,211,238,0.25),transparent_27%),radial-gradient(circle_at_8%_92%,rgba(139,92,246,0.34),transparent_34%),linear-gradient(128deg,#101226_0%,#29235f_50%,#0d5d68_100%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom_right,black,transparent_80%)]" />
        <div className="absolute -right-12 -top-16 size-52 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="absolute -bottom-24 left-[36%] size-64 rounded-full bg-violet-300/15 blur-3xl" />

        <div className="relative grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8 lg:p-8 xl:p-10">
          <div className="flex min-w-0 flex-col justify-between py-1">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100/90 backdrop-blur-xl">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
                </span>
                <Sparkles className="size-3.5" /> Financial intelligence
              </div>
              <h1 className="max-w-3xl font-heading text-3xl font-extrabold leading-[1.08] tracking-[-0.05em] sm:text-4xl lg:text-[2.9rem]">
                ต้นทุนและกำไร
                <span className="mt-1 block bg-gradient-to-r from-cyan-200 via-white to-violet-200 bg-clip-text text-transparent">
                  มองเห็นทุกบาทแบบเรียลไทม์
                </span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/58 sm:text-[15px]">
                ศูนย์ควบคุมผลประกอบการที่รวมยอดขาย ต้นทุนรับเข้าล่าสุด
                ค่าใช้จ่าย กำไรสุทธิ และยอดมิเตอร์ P ไว้ในมุมมองเดียว
              </p>
            </div>

            <div className="mt-7 grid gap-2.5 min-[460px]:grid-cols-3 lg:max-w-3xl">
              <HeroMetric
                label="ยอดขายสุทธิ"
                value={data ? signedMoney(data.summary.revenue) : "—"}
                detail={
                  data
                    ? `${fmtNum(data.summary.billCount)} บิล`
                    : "กำลังโหลดข้อมูล"
                }
                icon={<CircleDollarSign className="size-3.5" />}
                tone="violet"
              />
              <HeroMetric
                label="กำไรสุทธิ"
                value={data ? signedMoney(data.summary.netProfit) : "—"}
                detail={
                  data
                    ? `มาร์จิ้น ${percent(data.summary.netMargin)}`
                    : "กำลังคำนวณ"
                }
                icon={
                  data && data.summary.netProfit < 0 ? (
                    <TrendingDown className="size-3.5" />
                  ) : (
                    <TrendingUp className="size-3.5" />
                  )
                }
                tone="emerald"
              />
              <HeroMetric
                label="น้ำมันจากมิเตอร์"
                value={
                  data
                    ? `${fmtNum(data.meterProfitSummary.fuelLiters)} ลิตร`
                    : "—"
                }
                detail={
                  data?.meterProfitSummary.available
                    ? `ยอด P ${signedMoney(data.meterProfitSummary.fuelRevenue)}`
                    : "รอกะปิดพร้อมยอด P"
                }
                icon={<Fuel className="size-3.5" />}
                tone="cyan"
              />
            </div>
          </div>

          <aside className="relative overflow-hidden rounded-[28px] bg-slate-950/25 p-3.5 shadow-[0_24px_65px_rgba(7,12,38,0.24)] backdrop-blur-2xl sm:p-4">
            <div className="absolute -right-8 -top-10 size-28 rounded-full bg-cyan-300/10 blur-2xl" />
            <div className="relative mb-3 flex items-center justify-between px-1">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Activity className="size-3.5 text-emerald-300" />
                  ตัวควบคุมข้อมูล
                </p>
                <p className="mt-0.5 text-[10px] text-white/45">
                  เลือกช่วงเวลาและกะที่ต้องการ
                </p>
              </div>
              <span className="grid size-10 place-items-center rounded-2xl bg-white/10 text-cyan-200">
                <CalendarDays className="size-4" />
              </span>
            </div>

            <div className="relative grid grid-cols-3 gap-1 rounded-2xl bg-black/20 p-1.5">
              {(
                [
                  ["day", "รายวัน"],
                  ["month", "รายเดือน"],
                  ["year", "รายปี"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => {
                    setView(key);
                    setShiftId("all");
                  }}
                  className={cn(
                    "h-10 rounded-xl px-3 text-xs font-semibold transition duration-200",
                    view === key
                      ? "bg-gradient-to-r from-white to-violet-50 text-violet-800 shadow-[0_10px_24px_rgba(8,15,50,0.24)]"
                      : "text-white/65 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative mt-3 space-y-2.5">
              {view === "day" && (
                <Input
                  aria-label="เลือกวันที่"
                  type="date"
                  value={date}
                  onChange={event => {
                    setDate(event.target.value);
                    setShiftId("all");
                  }}
                  className="h-12 rounded-2xl border-white/15 bg-white/[0.96] px-4 text-sm font-semibold text-slate-900 shadow-[0_10px_28px_rgba(4,9,35,.18)]"
                />
              )}
              {view === "month" && (
                <Input
                  aria-label="เลือกเดือน"
                  type="month"
                  value={month}
                  onChange={event => {
                    setMonth(event.target.value);
                    setShiftId("all");
                  }}
                  className="h-12 rounded-2xl border-white/15 bg-white/[0.96] px-4 text-sm font-semibold text-slate-900 shadow-[0_10px_28px_rgba(4,9,35,.18)]"
                />
              )}
              {view === "year" && (
                <select
                  aria-label="เลือกปี"
                  value={year}
                  onChange={event => {
                    setYear(Number(event.target.value));
                    setShiftId("all");
                  }}
                  className="h-12 w-full rounded-2xl border border-white/15 bg-white/[0.96] px-4 text-sm font-semibold text-slate-900 shadow-[0_10px_28px_rgba(4,9,35,.18)] outline-none"
                >
                  {Array.from(
                    { length: 10 },
                    (_, index) => today.year - index
                  ).map(value => (
                    <option key={value} value={value}>
                      พ.ศ. {value + 543}
                    </option>
                  ))}
                </select>
              )}
              <label className="relative block">
                <Clock3 className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-violet-500" />
                <select
                  aria-label="เลือกกะขาย"
                  value={shiftId}
                  onChange={event => setShiftId(event.target.value)}
                  className="h-12 w-full appearance-none rounded-2xl border border-white/15 bg-white/[0.96] pl-11 pr-4 text-sm font-semibold text-slate-900 shadow-[0_10px_28px_rgba(4,9,35,.18)] outline-none"
                >
                  <option value="all">ทุกกะขาย</option>
                  {data?.availableShifts.map(shift => (
                    <option key={shift.id} value={String(shift.id)}>
                      กะ #{shift.id} · {shift.staffName} ·{" "}
                      {formatShiftDateTime(shift.openedAt)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="relative mt-3 flex items-center justify-between border-t border-white/10 px-1 pt-3 text-[10px] text-white/45">
              <span>{data?.period.label ?? "กำลังเตรียมรายงาน"}</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    isFetching ? "animate-pulse bg-amber-300" : "bg-emerald-300"
                  )}
                />
                {isFetching ? "กำลังอัปเดต" : "ข้อมูลล่าสุด"}
              </span>
            </div>
          </aside>
        </div>
      </section>

      {error && (
        <Card
          data-slot="notice"
          data-tone="error"
          role="alert"
          className="rounded-[24px] border-rose-200/80 bg-rose-50/90 shadow-[0_16px_40px_rgba(190,24,93,.08)] backdrop-blur-xl"
        >
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-rose-800">โหลดข้อมูลไม่สำเร็จ</p>
              <p className="mt-1 text-sm text-rose-600">{error.message}</p>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className={PANEL_CLASS}>
        <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-violet-300/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-64 rounded-full bg-cyan-200/20 blur-3xl" />
        <CardContent className="relative p-0">
          <div className="flex flex-col gap-4 bg-gradient-to-r from-slate-950 via-[#242052] to-[#135b65] p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-start gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-cyan-100">
                <ArrowDownToLine className="size-5" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/65">
                  Export studio
                </p>
                <h2 className="mt-1 font-heading text-xl font-bold tracking-[-0.03em]">
                  ส่งออกข้อมูลพร้อมใช้งาน
                </h2>
                <p className="mt-1 text-xs leading-5 text-white/50">
                  เลือกไฟล์รายวันหรือรวมหลายวัน รองรับสูงสุด 92 วันต่อครั้ง
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 text-[10px] font-semibold">
              <span className="rounded-full bg-white/[0.09] px-3 py-1.5 text-white/65">
                <FileSpreadsheet className="mr-1.5 inline size-3.5 text-emerald-300" />
                EXCEL .XLSX
              </span>
              <span className="rounded-full bg-white/[0.09] px-3 py-1.5 text-white/65">
                <Zap className="mr-1.5 inline size-3.5 text-amber-300" />
                ดาวน์โหลดทันที
              </span>
            </div>
          </div>

          <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2 xl:p-6">
            <section className="relative overflow-hidden rounded-[24px] bg-violet-50/80 p-4 sm:p-5">
              <div className="absolute -right-8 -top-10 size-28 rounded-full bg-violet-200/35 blur-2xl" />
              <div className="relative flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white shadow-[0_10px_25px_rgba(124,58,237,.25)]">
                  <CalendarDays className="size-4.5" />
                </span>
                <div>
                  <h3 className="font-heading text-sm font-bold text-slate-950">
                    ไฟล์รายวัน
                  </h3>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    Z-Report พร้อมรายการขาย ต้นทุน และกำไรของวันที่เลือก
                  </p>
                </div>
              </div>
              <div className="relative mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label htmlFor="profitability-export-date">
                  <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">
                    วันที่รายงาน
                  </span>
                  <Input
                    id="profitability-export-date"
                    type="date"
                    value={date}
                    onChange={event => setDate(event.target.value)}
                    className="h-12 rounded-2xl border-violet-100 bg-white px-3 shadow-[0_8px_20px_rgba(91,70,180,.06)]"
                  />
                </label>
                <Button
                  type="button"
                  className="h-12 rounded-2xl bg-violet-600 px-5 font-semibold shadow-[0_12px_28px_rgba(124,58,237,0.24)] hover:bg-violet-700"
                  disabled={
                    exporting != null || !/^\d{4}-\d{2}-\d{2}$/.test(date)
                  }
                  onClick={exportDaily}
                >
                  <ArrowDownToLine className="mr-2 size-4" />
                  {exporting === "daily" ? "กำลังสร้าง..." : "ดาวน์โหลด"}
                </Button>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-[24px] bg-cyan-50/80 p-4 sm:p-5">
              <div className="absolute -right-8 -top-10 size-28 rounded-full bg-cyan-200/35 blur-2xl" />
              <div className="relative flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-cyan-700 text-white shadow-[0_10px_25px_rgba(14,116,144,.22)]">
                  <Layers3 className="size-4.5" />
                </span>
                <div>
                  <h3 className="font-heading text-sm font-bold text-slate-950">
                    ไฟล์ตามช่วงเวลา
                  </h3>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    รวมยอดขายและผลกำไรหลายวันไว้ในไฟล์เดียว
                  </p>
                </div>
              </div>
              <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
                <label htmlFor="profitability-range-from">
                  <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">
                    จากวันที่
                  </span>
                  <Input
                    id="profitability-range-from"
                    type="date"
                    value={rangeFrom}
                    onChange={event => setRangeFrom(event.target.value)}
                    className="h-12 rounded-2xl border-cyan-100 bg-white px-3 shadow-[0_8px_20px_rgba(14,116,144,.06)]"
                  />
                </label>
                <label htmlFor="profitability-range-to">
                  <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">
                    ถึงวันที่
                  </span>
                  <Input
                    id="profitability-range-to"
                    type="date"
                    value={rangeTo}
                    onChange={event => setRangeTo(event.target.value)}
                    className="h-12 rounded-2xl border-cyan-100 bg-white px-3 shadow-[0_8px_20px_rgba(14,116,144,.06)]"
                  />
                </label>
              </div>
              <Button
                type="button"
                className="relative mt-3 h-12 w-full rounded-2xl bg-cyan-700 font-semibold shadow-[0_12px_28px_rgba(14,116,144,0.22)] hover:bg-cyan-800"
                disabled={
                  exporting != null ||
                  !/^\d{4}-\d{2}-\d{2}$/.test(rangeFrom) ||
                  !/^\d{4}-\d{2}-\d{2}$/.test(rangeTo)
                }
                onClick={exportRange}
              >
                <ArrowDownToLine className="mr-2 size-4" />
                {exporting === "range"
                  ? "กำลังสร้างไฟล์..."
                  : "ดาวน์โหลดรายงานช่วงเวลา"}
              </Button>
            </section>
          </div>

          {exportError && (
            <p
              data-slot="notice"
              data-tone="error"
              role="alert"
              className="mx-4 mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:mx-5 sm:mb-5 xl:mx-6 xl:mb-6"
            >
              {exportError}
            </p>
          )}
        </CardContent>
      </Card>

      {isLoading && !data && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-32 animate-pulse rounded-[26px] bg-gradient-to-br from-white via-slate-100 to-violet-100/60 shadow-[0_12px_32px_rgba(38,31,91,.06)] ring-1 ring-slate-200/50"
            />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/45 px-3.5 py-2.5 backdrop-blur-xl sm:px-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="grid size-8 place-items-center rounded-xl bg-violet-100 text-violet-700">
                <CalendarDays className="size-4" />
              </span>
              <span className="font-semibold text-slate-800">
                {data.period.label}
              </span>
              {isFetching && (
                <span className="size-3 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
              )}
            </div>
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-3 py-1",
                data.summary.costCoveragePercent === 100
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              )}
            >
              ข้อมูลต้นทุนครบ {percent(data.summary.costCoveragePercent)}
            </Badge>
          </div>

          <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            <div className="col-span-2">
              <SummaryCard
                label="กำไรสุทธิ"
                value={signedMoney(data.summary.netProfit)}
                detail={`หลังหักค่าใช้จ่ายทั้งหมด · มาร์จิ้น ${percent(data.summary.netMargin)}`}
                icon={
                  data.summary.netProfit < 0 ? (
                    <TrendingDown className="size-5" />
                  ) : (
                    <Target className="size-5" />
                  )
                }
                tone={data.summary.netProfit < 0 ? "rose" : "emerald"}
                negative={data.summary.netProfit < 0}
                featured
              />
            </div>
            <SummaryCard
              label="ยอดขายสุทธิ"
              value={signedMoney(data.summary.revenue)}
              detail={`${fmtNum(data.summary.billCount)} บิล · เฉลี่ย ${signedMoney(data.summary.averageBill)}`}
              icon={<CircleDollarSign className="size-5" />}
            />
            <SummaryCard
              label="ต้นทุนขาย"
              value={signedMoney(data.summary.cost)}
              detail="ต้นทุน ณ เวลาที่ขายสินค้า"
              icon={<WalletCards className="size-5" />}
              tone="amber"
            />
            <SummaryCard
              label="กำไรขั้นต้น"
              value={signedMoney(data.summary.grossProfit)}
              detail={`อัตรากำไร ${percent(data.summary.grossMargin)}`}
              icon={
                data.summary.grossProfit < 0 ? (
                  <TrendingDown className="size-5" />
                ) : (
                  <TrendingUp className="size-5" />
                )
              }
              tone={data.summary.grossProfit < 0 ? "rose" : "emerald"}
              negative={data.summary.grossProfit < 0}
            />
            <SummaryCard
              label="ค่าใช้จ่าย"
              value={signedMoney(data.summary.expenses)}
              detail={`${fmtNum(data.expensesByCategory.length)} หมวดค่าใช้จ่าย`}
              icon={<Banknote className="size-5" />}
              tone="cyan"
            />
          </section>

          <Card className={PANEL_CLASS}>
            <CardContent className="p-0">
              <div className="relative flex flex-col gap-3 overflow-hidden border-b border-slate-200/70 bg-gradient-to-r from-emerald-50 via-white to-violet-50 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                <div className="pointer-events-none absolute -right-10 -top-14 size-40 rounded-full bg-violet-200/30 blur-3xl" />
                <div>
                  <h2 className="flex items-center gap-2 font-heading text-base font-bold text-slate-900 sm:text-lg">
                    <Gauge className="size-5 text-emerald-600" />
                    สรุปผลประกอบการจากยอด P
                  </h2>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                    รวมยอด P และลิตรจากกะที่ปิดใน{data.period.label}
                    แล้วนำมาคำนวณร่วมกับสินค้าอื่น ต้นทุน
                    และค่าใช้จ่ายในช่วงเดียวกัน
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit rounded-full px-3 py-1",
                      data.meterProfitSummary.fallbackShiftCount > 0
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : data.meterProfitSummary.available
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                    )}
                  >
                    {data.meterProfitSummary.available
                      ? `${fmtNum(data.meterProfitSummary.meterShiftCount)} กะจาก P${
                          data.meterProfitSummary.fallbackShiftCount > 0
                            ? ` · สำรอง ${fmtNum(data.meterProfitSummary.fallbackShiftCount)} กะ`
                            : ""
                        }`
                      : "ยังไม่มีกะที่ปิดพร้อมยอดมิเตอร์"}
                  </Badge>
                  {data.meterProfitSummary.available && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "w-fit rounded-full px-3 py-1",
                        data.meterProfitSummary.fuelCostCoveragePercent === 100
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      )}
                    >
                      ต้นทุนลิตรครบ{" "}
                      {percent(data.meterProfitSummary.fuelCostCoveragePercent)}
                    </Badge>
                  )}
                </div>
              </div>

              {data.meterProfitSummary.available ? (
                <div className="grid gap-5 bg-gradient-to-br from-white/40 via-transparent to-emerald-50/25 p-4 sm:p-6 xl:grid-cols-[minmax(330px,0.85fr)_minmax(0,1.15fr)]">
                  <div className="space-y-3">
                    <div className="relative overflow-hidden rounded-[26px] bg-[radial-gradient(circle_at_90%_10%,rgba(255,255,255,.2),transparent_27%),linear-gradient(135deg,#047857_0%,#0f766e_52%,#0e7490_100%)] p-5 text-white shadow-[0_22px_50px_rgba(5,150,105,0.24)] ring-1 ring-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-white/70">
                            ยอดเงินขายน้ำมันจาก P
                          </p>
                          <p className="mt-1 font-heading text-3xl font-bold tracking-[-0.04em] tabular-nums">
                            {signedMoney(data.meterProfitSummary.fuelRevenue)}
                          </p>
                        </div>
                        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15">
                          <Fuel className="size-5" />
                        </span>
                      </div>
                      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-white/15 pt-4">
                        <div>
                          <p className="text-[10px] text-white/60">
                            ยอดลิตรรวม
                          </p>
                          <p className="mt-0.5 text-xl font-bold tabular-nums">
                            {fmtNum(data.meterProfitSummary.fuelLiters)} ลิตร
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-white/60">
                            ราคาเฉลี่ยจาก P
                          </p>
                          <p className="mt-0.5 text-sm font-semibold tabular-nums">
                            {signedMoney(
                              data.meterProfitSummary.averagePricePerLiter
                            )}
                            /ลิตร
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      {[
                        {
                          label: "รายรับรวม",
                          value: data.meterProfitSummary.revenue,
                          detail: "P น้ำมัน + สินค้าอื่น",
                          color: "text-violet-700",
                        },
                        {
                          label: "ต้นทุนรวม",
                          value: data.meterProfitSummary.cost,
                          detail: "ต้นทุนน้ำมันตามลิตร + สินค้าอื่น",
                          color: "text-amber-700",
                        },
                        {
                          label: "รายจ่าย",
                          value: data.meterProfitSummary.expenses,
                          detail: "ค่าใช้จ่ายในช่วงนี้",
                          color: "text-cyan-700",
                        },
                        {
                          label: "กำไรสุทธิ",
                          value: data.meterProfitSummary.netProfit,
                          detail: `มาร์จิ้น ${percent(data.meterProfitSummary.netMargin)}`,
                          color:
                            data.meterProfitSummary.netProfit < 0
                              ? "text-rose-600"
                              : "text-emerald-700",
                        },
                      ].map(metric => (
                        <div
                          key={metric.label}
                          className="rounded-2xl bg-slate-100/75 p-3.5"
                        >
                          <p className="text-[11px] font-medium text-slate-500">
                            {metric.label}
                          </p>
                          <p
                            className={cn(
                              "mt-1 font-heading text-base font-bold tabular-nums sm:text-lg",
                              metric.color
                            )}
                          >
                            {signedMoney(metric.value)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {metric.detail}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl bg-slate-100/70 px-4 py-3 text-xs text-slate-500">
                      <div className="flex items-center justify-between gap-3">
                        <span>ยอดน้ำมันในบิล POS</span>
                        <strong className="text-slate-700">
                          {signedMoney(
                            data.meterProfitSummary.fuelRevenueFromPos
                          )}
                        </strong>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                        <span>ส่วนต่าง P เทียบ POS</span>
                        <ProfitValue
                          value={data.meterProfitSummary.fuelRevenueDifference}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                        <span>รวมต้นทุนน้ำมันทุกประเภท</span>
                        <strong className="text-amber-700">
                          {signedMoney(data.meterProfitSummary.fuelCost)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 rounded-[24px] bg-slate-100/60 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-heading text-sm font-bold text-slate-900">
                          ยอด P และลิตรตามช่วงเวลา
                        </h3>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {view === "day"
                            ? "แยกตามชั่วโมงที่ปิดกะ"
                            : view === "month"
                              ? "แยกตามวันที่ปิดกะ"
                              : "แยกตามเดือนที่ปิดกะ"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <i className="size-2 rounded-sm bg-emerald-500" /> ยอด
                          P
                        </span>
                        <span className="flex items-center gap-1.5">
                          <i className="size-2 rounded-full bg-violet-500" />{" "}
                          ลิตร
                        </span>
                      </div>
                    </div>
                    <div
                      className="mt-3 h-[290px] w-full"
                      role="img"
                      aria-label="กราฟยอดเงินจากมิเตอร์ P และยอดลิตรตามช่วงเวลา"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={data.meterProfitSummary.trend}
                          margin={{ top: 12, right: 0, left: -16, bottom: 0 }}
                        >
                          <CartesianGrid
                            stroke="#e9e7f1"
                            strokeDasharray="3 6"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: "#8a889d" }}
                            interval={
                              view === "month" ? 2 : view === "day" ? 3 : 0
                            }
                          />
                          <YAxis
                            yAxisId="money"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: "#8a889d" }}
                            tickFormatter={value =>
                              new Intl.NumberFormat("th-TH", {
                                notation: "compact",
                                maximumFractionDigits: 1,
                              }).format(Number(value))
                            }
                          />
                          <YAxis
                            yAxisId="liters"
                            orientation="right"
                            axisLine={false}
                            tickLine={false}
                            width={42}
                            tick={{ fontSize: 10, fill: "#8a889d" }}
                            tickFormatter={value =>
                              `${fmtNum(Number(value))} ล.`
                            }
                          />
                          <Tooltip
                            contentStyle={chartTooltipStyle}
                            formatter={(value, name) => [
                              name === "revenue"
                                ? signedMoney(Number(value))
                                : `${fmtNum(Number(value))} ลิตร`,
                              name === "revenue" ? "ยอดจาก P" : "ยอดลิตร",
                            ]}
                          />
                          <Bar
                            yAxisId="money"
                            dataKey="revenue"
                            name="revenue"
                            fill="#10b981"
                            radius={[7, 7, 0, 0]}
                            maxBarSize={30}
                          />
                          <Line
                            yAxisId="liters"
                            type="monotone"
                            dataKey="liters"
                            name="liters"
                            stroke="#6d5df4"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: "#6d5df4", strokeWidth: 0 }}
                            activeDot={{ r: 5 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <section className="xl:col-span-2">
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h3 className="font-heading text-sm font-bold text-slate-900">
                          ต้นทุนและกำไรน้ำมันแยกตามประเภท
                        </h3>
                        <p className="mt-1 text-[11px] text-slate-500">
                          แต่ละชนิดใช้ต้นทุนจากการรับเข้าน้ำมันครั้งล่าสุดของชนิดนั้น
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="rounded-full border-violet-200 bg-violet-50 text-violet-700"
                      >
                        {fmtNum(data.meterProfitSummary.fuelTypes.length)}{" "}
                        ประเภท
                      </Badge>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {data.meterProfitSummary.fuelTypes.map(fuel => (
                        <article
                          key={fuel.productId}
                          className="group/fuel relative overflow-hidden rounded-[24px] bg-slate-50/90 p-4 transition duration-300 hover:bg-white hover:shadow-[0_16px_38px_rgba(38,31,91,.08)]"
                        >
                          <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-500 via-cyan-400 to-emerald-400" />
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700">
                                <Fuel className="size-5" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-heading text-sm font-bold text-slate-900">
                                  {fuel.name}
                                </p>
                                <p className="mt-0.5 text-[10px] font-semibold tracking-[0.12em] text-slate-400">
                                  {fuel.code}
                                </p>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-[10px] text-slate-400">
                                {fuel.usesLatestReceivedCost
                                  ? "ต้นทุนรับเข้าล่าสุด"
                                  : "ต้นทุนที่บันทึกในกะ"}
                              </p>
                              <p className="mt-0.5 font-heading text-base font-bold text-amber-700 tabular-nums">
                                {signedMoney(fuel.costPerLiter)}/ลิตร
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
                            <div>
                              <p className="text-[10px] text-slate-400">
                                ขายได้
                              </p>
                              <p className="mt-1 text-sm font-semibold text-slate-700 tabular-nums">
                                {fmtNum(fuel.liters)} ลิตร
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400">
                                ยอดขาย
                              </p>
                              <p className="mt-1 text-sm font-semibold text-violet-700 tabular-nums">
                                {signedMoney(fuel.revenue)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400">
                                ต้นทุนรวม
                              </p>
                              <p className="mt-1 text-sm font-semibold text-amber-700 tabular-nums">
                                {signedMoney(fuel.cost)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400">
                                กำไรขั้นต้น
                              </p>
                              <div className="mt-1 text-sm font-semibold tabular-nums">
                                <ProfitValue value={fuel.profit} />
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                            <span>
                              กำไรต่อลิตร {signedMoney(fuel.profitPerLiter)}
                            </span>
                            <span>มาร์จิ้น {percent(fuel.margin)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <p className="text-[11px] leading-relaxed text-slate-400 xl:col-span-2">
                    รายรับรวม = ยอด P ของน้ำมัน + ยอดสินค้าอื่นจาก POS ·
                    ต้นทุนน้ำมัน = ลิตรหัวจ่าย ×
                    ต้นทุนรับเข้าล่าสุดของน้ำมันแต่ละชนิด · กำไรสุทธิ =
                    รายรับรวม − ต้นทุนสินค้าทั้งหมด − ค่าใช้จ่าย
                    {data.meterProfitSummary.fallbackShiftCount > 0
                      ? " · กะเก่าที่ไม่มี P ใช้ยอดลิตร × ราคาที่บันทึกไว้แทน"
                      : ""}
                  </p>
                </div>
              ) : (
                <div className="grid min-h-48 place-items-center p-6 text-center">
                  <div>
                    <Gauge className="mx-auto size-9 text-slate-300" />
                    <p className="mt-3 text-sm font-semibold text-slate-600">
                      ยังไม่มียอด P ในช่วงที่เลือก
                    </p>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">
                      ยอด P และลิตรจะถูกบันทึกเมื่อปิดกะ ลองเลือกวันที่ เดือน ปี
                      หรือกะที่ปิดแล้ว
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={PANEL_CLASS}>
            <CardContent className="p-0">
              <div className="relative flex flex-col gap-3 overflow-hidden border-b border-slate-200/70 bg-gradient-to-r from-violet-50 via-white to-cyan-50 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                <div className="pointer-events-none absolute -right-8 -top-12 size-36 rounded-full bg-cyan-200/30 blur-3xl" />
                <div>
                  <h2 className="flex items-center gap-2 font-heading text-base font-bold text-slate-900 sm:text-lg">
                    <ClipboardCheck className="size-5 text-violet-600" />
                    {view === "day"
                      ? "สรุปปิดวัน (Z-Report)"
                      : "สรุป Z-Report ตามช่วงที่เลือก"}
                  </h2>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                    ตรวจยอดรับเงิน ภาษี ส่วนลด บิลยกเลิก และเงินสดที่ควรมี
                    จากยอดขายชุดเดียวกับรายงานกำไร จึงไม่มีการบวกยอดซ้ำ
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "w-fit rounded-full px-3 py-1",
                    Math.abs(data.zReport.reconciliationDifference) <= 0.01
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  )}
                >
                  {Math.abs(data.zReport.reconciliationDifference) <= 0.01 ? (
                    <>
                      <CheckCircle2 className="mr-1 size-3.5" />
                      ยอดขายตรงกับรายงานกำไร
                    </>
                  ) : (
                    `ส่วนต่าง ${signedMoney(data.zReport.reconciliationDifference)}`
                  )}
                </Badge>
              </div>

              <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-2xl bg-slate-100/75 p-3.5">
                      <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                        <Percent className="size-3.5 text-violet-500" /> VAT
                        ในยอดขาย
                      </div>
                      <p className="mt-1.5 font-heading text-lg font-bold tabular-nums text-slate-900">
                        {signedMoney(data.zReport.vatTotal)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-100/75 p-3.5">
                      <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                        <ReceiptText className="size-3.5 text-cyan-600" />{" "}
                        ส่วนลด
                      </div>
                      <p className="mt-1.5 font-heading text-lg font-bold tabular-nums text-slate-900">
                        {signedMoney(data.zReport.discountTotal)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-rose-50/80 p-3.5">
                      <div className="flex items-center gap-2 text-[11px] font-medium text-rose-600">
                        <CircleSlash2 className="size-3.5" /> บิลยกเลิก
                      </div>
                      <p className="mt-1.5 font-heading text-lg font-bold tabular-nums text-rose-700">
                        {fmtNum(data.zReport.voidedCount)} บิล
                      </p>
                      <p className="mt-0.5 text-[10px] text-rose-500">
                        มูลค่า {signedMoney(data.zReport.voidedTotal)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-amber-50/80 p-3.5">
                      <div className="flex items-center gap-2 text-[11px] font-medium text-amber-700">
                        <CreditCard className="size-3.5" /> รับชำระหนี้
                      </div>
                      <p className="mt-1.5 font-heading text-lg font-bold tabular-nums text-amber-800">
                        {signedMoney(data.zReport.debtPayments.total)}
                      </p>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_85%_10%,rgba(34,211,238,.18),transparent_26%),linear-gradient(135deg,#111827_0%,#29245f_62%,#164e63_100%)] p-4 text-white shadow-[0_20px_46px_rgba(30,27,75,0.22)] ring-1 ring-white/10">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-white/70">
                          เงินสดที่ควรมีตามระบบ
                        </p>
                        <p className="mt-1 font-heading text-2xl font-bold tracking-tight tabular-nums">
                          {signedMoney(data.zReport.expectedCash)}
                        </p>
                      </div>
                      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/10 text-emerald-300">
                        <Banknote className="size-5" />
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1 text-center text-[10px] text-white/55">
                      <div>
                        <p>ขายเงินสด</p>
                        <p className="mt-1 font-semibold text-white">
                          {signedMoney(data.zReport.byMethod.cash.total)}
                        </p>
                      </div>
                      <span className="text-base text-white/35">+</span>
                      <div>
                        <p>รับหนี้เงินสด</p>
                        <p className="mt-1 font-semibold text-white">
                          {signedMoney(data.zReport.debtPayments.byMethod.cash)}
                        </p>
                      </div>
                      <span className="text-base text-white/35">−</span>
                      <div>
                        <p>ค่าใช้จ่าย</p>
                        <p className="mt-1 font-semibold text-white">
                          {signedMoney(data.summary.expenses)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] bg-slate-100/60 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-heading text-sm font-bold text-slate-900">
                        ช่องทางรับชำระยอดขาย
                      </h3>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {fmtNum(data.zReport.billCount)} รายการ · ขาย{" "}
                        {fmtNum(data.zReport.saleCount)} · คืน{" "}
                        {fmtNum(data.zReport.returnCount)}
                      </p>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-violet-700">
                      {signedMoney(data.zReport.totalSales)}
                    </span>
                  </div>
                  <div className="mt-3 h-[210px] w-full">
                    {paymentChart.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={paymentChart}
                          layout="vertical"
                          margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
                        >
                          <CartesianGrid
                            stroke="#e9e7f1"
                            strokeDasharray="3 6"
                            horizontal={false}
                          />
                          <XAxis
                            type="number"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: "#8a889d" }}
                            tickFormatter={value =>
                              new Intl.NumberFormat("th-TH", {
                                notation: "compact",
                                maximumFractionDigits: 1,
                              }).format(Number(value))
                            }
                          />
                          <YAxis
                            type="category"
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            width={82}
                            tick={{ fontSize: 11, fill: "#5f5c70" }}
                          />
                          <Tooltip
                            contentStyle={chartTooltipStyle}
                            formatter={(value, _name, item) => [
                              signedMoney(Number(value)),
                              `${item.payload.label} · ${fmtNum(item.payload.count)} รายการ`,
                            ]}
                          />
                          <Bar
                            dataKey="total"
                            radius={[0, 9, 9, 0]}
                            barSize={18}
                          >
                            {paymentChart.map(item => (
                              <Cell
                                key={item.method}
                                fill={PAYMENT_COLORS[item.method]}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="grid h-full place-items-center text-sm text-slate-400">
                        ยังไม่มีรายการรับชำระในช่วงนี้
                      </div>
                    )}
                  </div>

                  <div className="mt-3 border-t border-slate-200/80 pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold text-slate-600">
                        น้ำมันที่ขายรวม
                      </p>
                      <p className="text-sm font-bold tabular-nums text-slate-900">
                        {fmtNum(data.zReport.totalLiters)} ลิตร
                      </p>
                    </div>
                    {data.zReport.fuelLiters.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {data.zReport.fuelLiters.map(fuel => (
                          <span
                            key={fuel.name}
                            className="rounded-full border border-violet-100 bg-white px-2.5 py-1 text-[10px] text-slate-600"
                          >
                            {fuel.name}{" "}
                            <strong>{fmtNum(fuel.liters)} ล.</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={cn(PANEL_CLASS, "data-table-panel")}>
            <CardContent className="p-0">
              <DataTableToolbar
                className="border-b border-border/70 p-4 sm:p-6"
                title="ยอดขายและกำไรแยกตามกะ"
                icon={Clock3}
                description="รวมยอดขาย ต้นทุน ค่าใช้จ่าย และกำไรของแต่ละกะขาย"
                count={data.shiftSummaries.length}
                countLabel="กะ"
                actions={
                  <Badge
                    variant="outline"
                    className="w-fit px-3 py-1"
                    data-status="neutral"
                  >
                    {shiftId === "all" ? "ทุกกะขาย" : `กะ #${shiftId}`}
                  </Badge>
                }
              />

              {data.shiftSummaries.length > 0 ? (
                <>
                  <div className="hidden min-w-0 max-w-full md:block">
                    <Table
                      className="min-w-[880px]"
                      containerClassName="!mx-0 !w-full max-w-full"
                      aria-label="ยอดขายและกำไรแยกตามกะ"
                    >
                      <TableHeader>
                        <TableRow className="bg-gradient-to-r from-slate-50 to-violet-50/45">
                          <TableHead>กะขาย</TableHead>
                          <TableHead className="text-right">จำนวนบิล</TableHead>
                          <TableHead className="text-right">
                            ยอดขายสุทธิ
                          </TableHead>
                          <TableHead className="text-right">ต้นทุน</TableHead>
                          <TableHead className="text-right">
                            กำไรขั้นต้น
                          </TableHead>
                          <TableHead className="text-right">
                            ค่าใช้จ่าย
                          </TableHead>
                          <TableHead className="text-right">
                            กำไรสุทธิ
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.shiftSummaries.map(shift => (
                          <TableRow key={shift.shiftId ?? "unassigned"}>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900">
                                  {shift.shiftId == null
                                    ? "ไม่ระบุกะ"
                                    : `กะ #${shift.shiftId}`}
                                </span>
                                <Badge
                                  variant="outline"
                                  data-status={
                                    shift.status === "open"
                                      ? "success"
                                      : "neutral"
                                  }
                                  className={cn(
                                    "rounded-full text-[10px]",
                                    shift.status === "open"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-slate-200 bg-slate-50 text-slate-600"
                                  )}
                                >
                                  {shift.status === "open"
                                    ? "กำลังเปิด"
                                    : shift.status === "closed"
                                      ? "ปิดแล้ว"
                                      : "ไม่ระบุ"}
                                </Badge>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-400">
                                {shift.staffName}
                                {shift.openedAt
                                  ? ` · เปิด ${formatShiftDateTime(shift.openedAt)}`
                                  : ""}
                              </p>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtNum(shift.billCount)}
                              {shift.returnCount > 0
                                ? ` / คืน ${fmtNum(shift.returnCount)}`
                                : ""}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {signedMoney(shift.revenue)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {signedMoney(shift.cost)}
                            </TableCell>
                            <TableCell className="text-right">
                              <ProfitValue value={shift.grossProfit} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {signedMoney(shift.expenses)}
                            </TableCell>
                            <TableCell className="text-right">
                              <ProfitValue value={shift.netProfit} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="divide-y divide-slate-100 md:hidden">
                    {data.shiftSummaries.map(shift => (
                      <article
                        key={shift.shiftId ?? "unassigned"}
                        className="p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-slate-900">
                              {shift.shiftId == null
                                ? "ไม่ระบุกะ"
                                : `กะ #${shift.shiftId} · ${shift.staffName}`}
                            </h3>
                            <p className="mt-1 text-xs text-slate-500">
                              {fmtNum(shift.billCount)} บิล
                              {shift.openedAt
                                ? ` · เปิด ${formatShiftDateTime(shift.openedAt)}`
                                : ""}
                            </p>
                          </div>
                          <ProfitValue value={shift.netProfit} />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
                          <div>
                            <p className="text-[10px] text-slate-400">
                              ยอดขายสุทธิ
                            </p>
                            <p className="mt-1 text-xs font-semibold tabular-nums">
                              {signedMoney(shift.revenue)}
                            </p>
                          </div>
                          <div className="border-l border-slate-200">
                            <p className="text-[10px] text-slate-400">ต้นทุน</p>
                            <p className="mt-1 text-xs font-semibold tabular-nums">
                              {signedMoney(shift.cost)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400">
                              กำไรขั้นต้น
                            </p>
                            <p className="mt-1 text-xs font-semibold tabular-nums">
                              {signedMoney(shift.grossProfit)}
                            </p>
                          </div>
                          <div className="border-l border-slate-200">
                            <p className="text-[10px] text-slate-400">
                              ค่าใช้จ่าย
                            </p>
                            <p className="mt-1 text-xs font-semibold tabular-nums">
                              {signedMoney(shift.expenses)}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <Table
                  className="min-w-0 max-sm:min-w-0"
                  containerClassName="!mx-0 !w-full max-w-full"
                  aria-label="ยอดขายและกำไรแยกตามกะ"
                >
                  <TableBody>
                    <DataTableEmpty
                      colSpan={7}
                      icon={Clock3}
                      message="ยังไม่มียอดขายที่ผูกกับกะในช่วงเวลานี้"
                    />
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
            <Card className={PANEL_CLASS}>
              <CardContent className="p-4 sm:p-6">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-heading text-base font-bold text-slate-900">
                      แนวโน้มยอดขาย ต้นทุน และกำไร
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {view === "day"
                        ? "แยกรายชั่วโมง"
                        : view === "month"
                          ? "แยกรายวัน"
                          : "แยกรายเดือน"}
                    </p>
                  </div>
                  <div className="hidden items-center gap-3 text-[11px] text-slate-500 sm:flex">
                    <span className="flex items-center gap-1.5">
                      <i className="size-2 rounded-full bg-violet-500" /> ยอดขาย
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="size-2 rounded-full bg-amber-500" /> ต้นทุน
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="size-2 rounded-full bg-emerald-500" /> กำไร
                    </span>
                  </div>
                </div>
                <div className="h-[280px] w-full rounded-[22px] bg-gradient-to-br from-violet-50/70 via-white to-cyan-50/50 p-2 sm:h-[330px] sm:p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data.trend}
                      margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="profit-revenue"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#6d5df4"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#6d5df4"
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                        <linearGradient
                          id="profit-cost"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#f59e0b"
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="95%"
                            stopColor="#f59e0b"
                            stopOpacity={0.01}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="#eceaf3"
                        strokeDasharray="3 6"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#8a889d" }}
                        interval={view === "month" ? 2 : view === "day" ? 3 : 0}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#8a889d" }}
                        tickFormatter={value =>
                          new Intl.NumberFormat("th-TH", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(Number(value))
                        }
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value, name) => [
                          signedMoney(Number(value)),
                          name === "revenue"
                            ? "ยอดขาย"
                            : name === "cost"
                              ? "ต้นทุน"
                              : "กำไรขั้นต้น",
                        ]}
                        labelFormatter={label => `ช่วง ${label}`}
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        name="revenue"
                        stroke="#6d5df4"
                        strokeWidth={2.5}
                        fill="url(#profit-revenue)"
                      />
                      <Area
                        type="monotone"
                        dataKey="cost"
                        name="cost"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        fill="url(#profit-cost)"
                      />
                      <Area
                        type="monotone"
                        dataKey="grossProfit"
                        name="grossProfit"
                        stroke="#059669"
                        strokeWidth={2.5}
                        fill="transparent"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className={PANEL_CLASS}>
              <CardContent className="p-4 sm:p-6">
                <h2 className="font-heading text-base font-bold text-slate-900">
                  สัดส่วนยอดขายตามหมวด
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  เปรียบเทียบทุกกลุ่มสินค้าในช่วงที่เลือก
                </p>
                <div className="relative mx-auto h-[220px] max-w-sm">
                  <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      ยอดขายรวม
                    </p>
                    <p className="mt-1 max-w-24 truncate text-sm font-bold text-slate-900 tabular-nums">
                      {signedMoney(data.summary.revenue)}
                    </p>
                  </div>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.categories}
                        dataKey="revenue"
                        nameKey="label"
                        innerRadius={55}
                        outerRadius={86}
                        paddingAngle={3}
                        stroke="none"
                      >
                        {data.categories.map(category => (
                          <Cell
                            key={category.key}
                            fill={CATEGORY_COLORS[category.key]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={value => signedMoney(Number(value))}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2.5">
                  {data.categories.map(category => (
                    <div
                      key={category.key}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-slate-600">
                        <i
                          className="size-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: CATEGORY_COLORS[category.key],
                          }}
                        />
                        <span className="truncate">{category.label}</span>
                      </span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {signedMoney(category.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <Card className={PANEL_CLASS}>
              <CardContent className="p-4 sm:p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-heading text-base font-bold text-slate-900">
                      สรุปกำไรตามหมวดสินค้า
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      ยอดขายสุทธิหลังส่วนลดและการคืนสินค้า
                    </p>
                  </div>
                  <div
                    className="flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1"
                    role="group"
                    aria-label="หมวดสินค้า"
                  >
                    {(
                      [
                        ["all", "ทั้งหมด"],
                        ["fuel", "น้ำมัน"],
                        ["lubricant", "น้ำมันเครื่อง"],
                        ["other", "อื่นๆ"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={categoryFilter === key}
                        onClick={() => setCategoryFilter(key)}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition sm:px-3",
                          categoryFilter === key
                            ? "bg-white text-violet-700 shadow-sm"
                            : "text-slate-500 hover:text-slate-800"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {data.categories.map(category => (
                    <div
                      key={category.key}
                      className="relative overflow-hidden rounded-[20px] bg-slate-100/65 p-4 transition duration-300 hover:bg-white hover:shadow-[0_12px_30px_rgba(38,31,91,.07)]"
                    >
                      <div
                        className="absolute inset-x-0 top-0 h-1"
                        style={{
                          backgroundColor: CATEGORY_COLORS[category.key],
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{
                            backgroundColor: CATEGORY_COLORS[category.key],
                          }}
                        />
                        <span className="text-xs font-semibold text-slate-600">
                          {category.label}
                        </span>
                      </div>
                      <p className="mt-3 font-heading text-lg font-bold text-slate-900">
                        {signedMoney(category.profit)}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        มาร์จิ้น {percent(category.margin)} · ต้นทุน{" "}
                        {signedMoney(category.cost)}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className={PANEL_CLASS}>
              <CardContent className="p-4 sm:p-6">
                <h2 className="font-heading text-base font-bold text-slate-900">
                  สินค้าที่ทำกำไรสูงสุด
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  เรียงตามกำไรขั้นต้นในหมวดที่เลือก
                </p>
                <div className="mt-4 h-[245px] rounded-[22px] bg-gradient-to-br from-slate-50 via-white to-violet-50/55 p-2">
                  {topProducts.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={topProducts}
                        layout="vertical"
                        margin={{ top: 0, right: 8, left: 10, bottom: 0 }}
                      >
                        <CartesianGrid
                          stroke="#eceaf3"
                          strokeDasharray="3 6"
                          horizontal={false}
                        />
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={94}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 10, fill: "#676579" }}
                        />
                        <Tooltip
                          contentStyle={chartTooltipStyle}
                          formatter={value => [
                            signedMoney(Number(value)),
                            "กำไร",
                          ]}
                        />
                        <Bar dataKey="profit" radius={[0, 8, 8, 0]}>
                          {topProducts.map(product => (
                            <Cell
                              key={`${product.productId ?? "deleted"}-${product.name}`}
                              fill={
                                product.profit < 0
                                  ? "#e11d48"
                                  : CATEGORY_COLORS[product.category]
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-slate-400">
                      ยังไม่มียอดขายในช่วงนี้
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>

          {data.summary.missingCostProductCount > 0 && (
            <Card
              data-slot="notice"
              data-tone="warning"
              role="alert"
              className="overflow-hidden rounded-[26px] border-0 bg-gradient-to-r from-amber-50 via-white to-orange-50 shadow-[0_18px_46px_rgba(217,119,6,.08)]"
            >
              <CardContent className="flex gap-3 p-4 sm:p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
                  <AlertTriangle className="size-5" />
                </span>
                <div>
                  <p className="font-semibold text-amber-900">
                    พบสินค้าที่ยังไม่มีต้นทุน{" "}
                    {fmtNum(data.summary.missingCostProductCount)} รายการ
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-700">
                    ยอดขายที่ยังคำนวณต้นทุนไม่ได้{" "}
                    {signedMoney(data.summary.missingCostRevenue)} —
                    กรุณาตั้งราคาทุนในหน้าตั้งค่าสินค้า:{" "}
                    {data.missingCostProducts.join(", ")}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className={cn(PANEL_CLASS, "data-table-panel")}>
            <CardContent className="p-0">
              <DataTableToolbar
                className="border-b border-border/70 p-4 sm:p-6"
                title="รายละเอียดรายสินค้า"
                icon={PackageSearch}
                description="รวมรายการคืนสินค้าแล้ว"
                count={filteredProducts.length}
                countLabel="รายการ"
                actions={
                  <div className="flex max-w-full flex-wrap gap-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5">
                      <ReceiptText className="size-3.5" /> ขาย{" "}
                      {fmtNum(data.summary.billCount)} บิล
                    </span>
                    <span className="flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1.5 text-rose-600">
                      <RotateCcw className="size-3.5" /> คืน{" "}
                      {fmtNum(data.summary.returnCount)} บิล
                    </span>
                  </div>
                }
              />

              <div className="hidden min-w-0 max-w-full md:block">
                <Table
                  className="min-w-[860px]"
                  containerClassName="!mx-0 !w-full max-w-full"
                  aria-label="รายละเอียดรายสินค้า"
                >
                  <TableHeader>
                    <TableRow className="bg-gradient-to-r from-slate-50 to-violet-50/45">
                      <TableHead>สินค้า</TableHead>
                      <TableHead>หมวด</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead className="text-right">ยอดขาย</TableHead>
                      <TableHead className="text-right">ต้นทุน</TableHead>
                      <TableHead className="text-right">กำไร</TableHead>
                      <TableHead className="text-right">มาร์จิ้น</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map(product => (
                      <TableRow
                        key={`${product.productId ?? "deleted"}-${product.name}`}
                      >
                        <TableCell>
                          <div className="font-medium text-slate-900">
                            {product.name}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            ขายเฉลี่ย {signedMoney(product.averageSalePrice)} ·
                            ทุนเฉลี่ย {signedMoney(product.averageCost)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="whitespace-nowrap"
                            data-status="neutral"
                          >
                            {product.categoryLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNum(product.qty)} {product.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {signedMoney(product.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {product.missingCost ? (
                            <Badge variant="outline" data-status="warning">
                              ยังไม่ครบ
                            </Badge>
                          ) : (
                            signedMoney(product.cost)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <ProfitValue value={product.profit} />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {percent(product.margin)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredProducts.length === 0 && (
                      <DataTableEmpty
                        colSpan={7}
                        icon={PackageSearch}
                        message="ยังไม่มียอดขายในหมวดและช่วงเวลานี้"
                      />
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="divide-y divide-slate-100 md:hidden">
                {filteredProducts.map(product => (
                  <article
                    key={`${product.productId ?? "deleted"}-${product.name}`}
                    className="p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-slate-900">
                          {product.name}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {product.categoryLabel} · {fmtNum(product.qty)}{" "}
                          {product.unit}
                        </p>
                      </div>
                      <ProfitValue value={product.profit} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
                      <div>
                        <p className="text-[10px] text-slate-400">ยอดขาย</p>
                        <p className="mt-1 text-xs font-semibold tabular-nums">
                          {signedMoney(product.revenue)}
                        </p>
                      </div>
                      <div className="border-x border-slate-200">
                        <p className="text-[10px] text-slate-400">ต้นทุน</p>
                        <p className="mt-1 text-xs font-semibold tabular-nums">
                          {product.missingCost
                            ? "ไม่ครบ"
                            : signedMoney(product.cost)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400">มาร์จิ้น</p>
                        <p className="mt-1 text-xs font-semibold tabular-nums">
                          {percent(product.margin)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {filteredProducts.length === 0 && (
                <div className="grid min-h-44 place-items-center p-8 text-center md:hidden">
                  <div>
                    <PackageSearch className="mx-auto size-8 text-slate-300" />
                    <p className="mt-2 text-sm font-medium text-slate-500">
                      ยังไม่มียอดขายในหมวดและช่วงเวลานี้
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="px-1 text-xs leading-relaxed text-slate-400">
            กำไรขั้นต้น = ยอดขายหลังส่วนลดและคืนสินค้า − ต้นทุนขาย · กำไรสุทธิ =
            กำไรขั้นต้น − ค่าใช้จ่ายที่บันทึกในระบบ
            ค่าที่แสดงเป็นข้อมูลบริหารภายใน
          </p>
        </>
      )}
    </div>
  );
}
