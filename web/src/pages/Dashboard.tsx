import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  Droplet,
  Gauge,
  ReceiptText,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import SalesTrendChart from "@/components/SalesTrendChart";
import { trpc } from "@/providers/trpc";
import { fmtMoney, fmtNum, fmtTime, paymentLabel } from "@/lib/format";

function createDashboardPlaceholder() {
  const now = new Date();
  return {
    todayTotal: 0,
    todayBills: 0,
    litersToday: 0,
    fuelByCode: {} as Record<
      string,
      { name: string; liters: number; amount: number }
    >,
    chart: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));
      return {
        date: date.toISOString().slice(0, 10),
        label: `${date.getDate()}/${date.getMonth() + 1}`,
        total: 0,
        bills: 0,
      };
    }),
    openShift: null,
    tanks: [],
    lowTanks: [],
    lowProducts: [],
    recentSales: [],
  };
}

export default function Dashboard() {
  const {
    data,
    isError,
    error,
    refetch,
    isFetching,
    isPlaceholderData,
  } = trpc.pos.dashboard.useQuery(undefined, {
    refetchInterval: 30000,
    placeholderData: createDashboardPlaceholder,
  });

  if (isError || !data) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-20 text-center">
        <AlertTriangle className="size-9 text-amber-500" />
        <div>
          <h2 className="font-heading text-lg font-bold text-slate-800">
            โหลดข้อมูลภาพรวมไม่สำเร็จ
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {error?.message || "กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? "กำลังลองใหม่..." : "ลองใหม่"}
        </Button>
      </div>
    );
  }

  const averageBill = data.todayBills ? data.todayTotal / data.todayBills : 0;
  const lowStockCount = data.lowTanks.length + data.lowProducts.length;
  const fuelTotal = Object.values(data.fuelByCode).reduce(
    (sum, fuel) => sum + fuel.amount,
    0
  );
  const stats = [
    {
      label: "น้ำมันที่จ่ายแล้ว",
      value: `${fmtNum(data.litersToday)} ลิตร`,
      icon: Droplet,
      color: "text-cyan-700",
      iconBg: "from-cyan-100 to-blue-50",
      glow: "bg-cyan-400/15",
    },
    {
      label: "จำนวนธุรกรรม",
      value: `${data.todayBills} บิล`,
      icon: ReceiptText,
      color: "text-violet-700",
      iconBg: "from-violet-100 to-fuchsia-50",
      glow: "bg-violet-400/15",
    },
    {
      label: "ยอดเฉลี่ยต่อบิล",
      value: `฿${fmtMoney(averageBill)}`,
      icon: Banknote,
      color: "text-orange-700",
      iconBg: "from-orange-100 to-amber-50",
      glow: "bg-orange-400/15",
    },
  ];

  const todayLabel = new Intl.DateTimeFormat("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div
      className="space-y-5 lg:space-y-6"
      aria-busy={isPlaceholderData || isFetching}
    >
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)]">
        <div className="aurora-border relative z-0 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#11112c] via-[#1b1950] to-[#12344c] p-5 text-white shadow-[0_28px_70px_rgba(30,24,82,0.28)] sm:p-7 lg:p-8">
          <div className="surface-grid pointer-events-none absolute inset-0 opacity-70" />
          <div className="ambient-float pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-violet-500/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 right-1/4 size-52 rounded-full bg-cyan-400/15 blur-3xl" />

          <div className="relative flex h-full min-h-[330px] flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.075] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/80 backdrop-blur-md">
                <Sparkles className="size-3.5 text-cyan-300" /> Command center
              </div>
              <div className="rounded-full border border-white/10 bg-black/10 px-3 py-1.5 text-[11px] text-white/55 backdrop-blur-sm">
                {todayLabel}
              </div>
            </div>

            <div className="mt-8">
              <h1 className="font-heading text-4xl font-extrabold leading-none tracking-[-0.04em] sm:text-5xl lg:text-[3.5rem]">
                ยอดขายวันนี้
              </h1>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="font-heading text-3xl font-extrabold leading-none tracking-[-0.04em] number-display">
                  {isPlaceholderData ? "฿—" : `฿${fmtMoney(data.todayTotal)}`}
                </div>
                <div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-200">
                  <TrendingUp className="size-3" />{" "}
                  {isPlaceholderData ? "กำลังอัปเดตข้อมูล" : "อัปเดตแบบเรียลไทม์"}
                </div>
              </div>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/50">
                ดูยอดขาย สถานะกะ และสัญญาณสำคัญของสถานีได้จากหน้าจอเดียว
              </p>
            </div>

            <div className="mt-auto flex flex-wrap items-end justify-between gap-5 pt-8">
              <div className="flex gap-6">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                    ปริมาณจ่าย
                  </div>
                  <div className="mt-1 font-heading text-lg font-bold number-display">
                    {fmtNum(data.litersToday)} ลิตร
                  </div>
                </div>
                <div className="h-10 w-px bg-white/10" />
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                    ธุรกรรม
                  </div>
                  <div className="mt-1 font-heading text-lg font-bold number-display">
                    {data.todayBills} บิล
                  </div>
                </div>
              </div>
              <Link to="/pos" className="w-full sm:w-auto">
                <Button className="shine-button h-12 w-full gap-2 rounded-2xl border border-white/15 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500 px-5 text-white shadow-[0_12px_32px_rgba(76,84,255,0.35)] hover:from-violet-500 hover:via-indigo-500 hover:to-cyan-400 sm:w-auto">
                  เริ่มขายสินค้า <ArrowUpRight className="size-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <Card className="spotlight-card gap-0 overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100/80 px-5 py-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="page-kicker">Live operations</div>
                <CardTitle className="mt-1.5 font-heading text-lg font-bold text-slate-900">
                  สถานะสถานี
                </CardTitle>
              </div>
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-50" />
                <span className="relative size-3 rounded-full bg-cyan-500" />
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 p-5">
            <div
              className={`rounded-2xl border p-4 ${
                data.openShift
                  ? "border-cyan-100 bg-gradient-to-br from-cyan-50 to-white"
                  : "border-orange-100 bg-gradient-to-br from-orange-50 to-white"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`grid size-11 place-items-center rounded-2xl ${
                    data.openShift
                      ? "bg-cyan-500 text-white shadow-lg shadow-cyan-500/20"
                      : "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                  }`}
                >
                  <Gauge className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">สถานะกะ</div>
                  <div className="truncate font-semibold text-slate-900">
                    {data.openShift ? "กำลังให้บริการ" : "รอเปิดกะ"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {data.openShift
                      ? `${data.openShift.staffName} · เริ่ม ${fmtTime(data.openShift.openedAt)}`
                      : "เปิดกะเพื่อเริ่มรับรายการ"}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[#f3f1ff] p-4">
                <Boxes className="size-5 text-violet-600" />
                <div className="mt-3 text-2xl font-extrabold text-slate-900 number-display">
                  {lowStockCount}
                </div>
                <div className="text-[11px] text-slate-500">รายการต้องดูแล</div>
              </div>
              <div className="rounded-2xl bg-[#ecfbf9] p-4">
                <ReceiptText className="size-5 text-cyan-600" />
                <div className="mt-3 text-2xl font-extrabold text-slate-900 number-display">
                  {data.todayBills}
                </div>
                <div className="text-[11px] text-slate-500">บิลวันนี้</div>
              </div>
            </div>

            <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
              <Link
                to="/shifts"
                className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2.5 text-xs font-semibold text-slate-600 transition-all hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
              >
                จัดการกะ <ArrowRight className="size-3.5" />
              </Link>
              <Link
                to="/stock"
                className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2.5 text-xs font-semibold text-slate-600 transition-all hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700"
              >
                ดูสต๊อก <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      {(data.lowTanks.length > 0 || data.lowProducts.length > 0) && (
        <Card className="gap-0 overflow-hidden border-orange-200/80 bg-gradient-to-r from-orange-50/90 via-amber-50/80 to-white/80 py-0 shadow-[0_12px_30px_rgba(251,146,60,0.08)]">
          <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/20">
              <AlertTriangle className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1 text-sm text-orange-950">
              <div className="font-semibold">มีรายการที่ควรตรวจสอบ</div>
              <div className="mt-0.5 truncate text-xs text-orange-800/60">
                {[
                  ...data.lowTanks.map(
                    tank => `${tank.name} ${fmtNum(tank.currentLiters)} ลิตร`
                  ),
                  ...data.lowProducts.map(
                    product =>
                      `${product.name} ${fmtNum(product.stockQty)} ${product.unit}`
                  ),
                ].join(" · ")}
              </div>
            </div>
            <Link to="/stock">
              <Button
                size="sm"
                variant="outline"
                className="border-orange-200 bg-white/90 text-orange-800 hover:border-orange-300 hover:bg-orange-100"
              >
                จัดการทันที <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map(stat => (
          <Card
            key={stat.label}
            className="interactive-card spotlight-card group gap-0 overflow-hidden py-0"
          >
            <span
              className={`pointer-events-none absolute -right-8 -top-8 size-28 rounded-full blur-2xl ${stat.glow}`}
            />
            <CardContent className="relative flex items-center gap-4 p-5">
              <div
                className={`grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br shadow-inner ring-1 ring-white transition-all duration-300 group-hover:-rotate-6 group-hover:scale-110 ${stat.iconBg} ${stat.color}`}
              >
                <stat.icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-slate-500">
                  {stat.label}
                </div>
                <div className="mt-1 truncate font-heading text-xl font-extrabold text-slate-900 number-display">
                  {stat.value}
                </div>
              </div>
              <span className="grid size-8 place-items-center rounded-full bg-slate-50 text-slate-300 transition-all group-hover:bg-violet-50 group-hover:text-violet-500">
                <ArrowUpRight className="size-4" />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="gap-4 overflow-hidden lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between px-5 pb-0 sm:px-6">
            <div>
              <div className="page-kicker">Revenue pulse</div>
              <CardTitle className="mt-1.5 font-heading text-lg font-bold text-slate-900">
                จังหวะยอดขาย 7 วัน
              </CardTitle>
              <p className="mt-1 text-xs text-slate-400">
                แนวโน้มยอดขายรวมรายวัน
              </p>
            </div>
            <div className="grid size-10 place-items-center rounded-2xl bg-violet-50 text-violet-600">
              <TrendingUp className="size-5" />
            </div>
          </CardHeader>
          <CardContent className="h-72 px-2 pb-2 sm:px-4">
            <SalesTrendChart data={data.chart} />
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader className="px-5 pb-0">
            <div className="page-kicker">Fuel mix</div>
            <CardTitle className="mt-1.5 font-heading text-lg font-bold text-slate-900">
              สัดส่วนน้ำมันวันนี้
            </CardTitle>
            <p className="text-xs text-slate-400">ยอดขายแยกตามชนิดเชื้อเพลิง</p>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            {Object.keys(data.fuelByCode).length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                ยังไม่มียอดขายน้ำมันวันนี้
              </p>
            )}
            {Object.entries(data.fuelByCode).map(([code, fuel], index) => {
              const percent = fuelTotal ? (fuel.amount / fuelTotal) * 100 : 0;
              const barColors = [
                "from-violet-500 to-indigo-500",
                "from-cyan-400 to-teal-500",
                "from-orange-400 to-rose-500",
                "from-fuchsia-400 to-violet-500",
              ];
              return (
                <div key={code} className="group">
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-700">
                        {fuel.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {fmtNum(fuel.liters)} ลิตร
                      </div>
                    </div>
                    <div className="font-heading text-sm font-bold text-slate-800 number-display">
                      ฿{fmtMoney(fuel.amount)}
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 shadow-inner">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 group-hover:brightness-110 ${barColors[index % barColors.length]}`}
                      style={{ width: `${Math.max(percent, 4)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="gap-4">
          <CardHeader className="px-5 pb-0">
            <div className="page-kicker">Tank telemetry</div>
            <CardTitle className="mt-1.5 font-heading text-lg font-bold text-slate-900">
              ระดับน้ำมันในถัง
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 px-5">
            {data.tanks.map(tank => (
              <div key={tank.id}>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="font-semibold text-slate-700">
                    {tank.name}
                  </span>
                  <span
                    className={
                      tank.isLow
                        ? "font-semibold text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {fmtNum(tank.percent)}%
                  </span>
                </div>
                <Progress
                  value={tank.percent}
                  className={`h-2.5 ${
                    tank.isLow
                      ? "[&>div]:bg-destructive"
                      : "[&>div]:bg-violet-600"
                  }`}
                />
                <div className="mt-1.5 text-right text-[10px] text-slate-400">
                  {fmtNum(tank.currentLiters)} / {fmtNum(tank.capacityLiters)}{" "}
                  ล.
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="gap-3 lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between px-5 pb-0">
            <div>
              <div className="page-kicker">Latest activity</div>
              <CardTitle className="mt-1.5 font-heading text-lg font-bold text-slate-900">
                การขายล่าสุด
              </CardTitle>
            </div>
            <Link to="/sales">
              <Button variant="ghost" size="sm" className="text-violet-700">
                ดูทั้งหมด <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="px-5">
            <div className="space-y-1">
              {data.recentSales.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  ยังไม่มีการขาย
                </p>
              )}
              {data.recentSales.map(sale => (
                <div
                  key={sale.id}
                  className="group -mx-2 flex items-center justify-between gap-3 rounded-2xl px-3 py-3 transition-all hover:bg-violet-50/60"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-400 transition-all group-hover:bg-violet-100 group-hover:text-violet-600">
                      <ReceiptText className="size-[18px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-700">
                        {sale.receiptNo}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-400">
                        {fmtTime(sale.createdAt)} ·{" "}
                        {paymentLabel[sale.paymentMethod]} ·{" "}
                        {sale.staffName || "-"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading font-bold text-slate-900 number-display">
                      ฿{fmtMoney(sale.total)}
                    </div>
                    {sale.status === "voided" && (
                      <Badge variant="destructive" className="text-[10px]">
                        ยกเลิก
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
