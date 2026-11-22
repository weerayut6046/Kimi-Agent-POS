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
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import SalesTrendChart from "@/components/SalesTrendChart";
import BusinessSetupPrompt from "@/components/BusinessSetupPrompt";
import { trpc } from "@/providers/trpc";
import { fmtMoney, fmtNum, fmtTime, paymentLabel } from "@/lib/format";

function createDashboardPlaceholder() {
  const now = new Date();
  return {
    todayTotal: 0,
    todayPosTotal: 0,
    todayShiftTotal: 0,
    todayShiftCount: 0,
    todayBills: 0,
    litersToday: 0,
    shiftLitersToday: 0,
    fuelSource: "pos" as "pos" | "shift",
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
        posTotal: 0,
        shiftTotal: 0,
        bills: 0,
        shifts: 0,
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
  const { data, isError, error, refetch, isFetching, isPlaceholderData } =
    trpc.pos.dashboard.useQuery(undefined, {
      refetchInterval: 30000,
      placeholderData: createDashboardPlaceholder,
    });

  if (isError || !data) {
    return (
      <div
        data-slot="notice"
        data-tone="error"
        role="alert"
        className="mx-auto flex max-w-lg flex-col items-center gap-3 py-20 text-center"
      >
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

  // รองรับช่วงที่ frontend โหลดใหม่ก่อน backend ระหว่าง dev/hot reload
  const todayTotal = Number(data.todayTotal ?? 0);
  const todayPosTotal = Number(data.todayPosTotal ?? todayTotal);
  const todayShiftCount = Number(data.todayShiftCount ?? 0);
  const todayBills = Number(data.todayBills ?? 0);
  const litersToday = Number(data.litersToday ?? 0);
  const averageBill = todayBills ? todayPosTotal / todayBills : 0;
  const lowStockCount = data.lowTanks.length + data.lowProducts.length;
  const fuelTotal = Object.values(data.fuelByCode).reduce(
    (sum, fuel) => sum + fuel.amount,
    0
  );
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
      <BusinessSetupPrompt />
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="page-kicker">Command center · {todayLabel}</div>
          <h1 className="mt-1 font-heading text-2xl font-bold tracking-[-0.025em] text-slate-950 sm:text-3xl">
            ภาพรวมการทำงานวันนี้
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            ติดตามยอดขาย กะ และสถานะสต๊อกจากจุดเดียว
          </p>
        </div>
        <Link to="/pos" className="w-full sm:w-auto">
          <Button className="h-11 w-full gap-2 px-5 sm:w-auto">
            เริ่มขายหน้าลาน <ArrowUpRight className="size-4" />
          </Button>
        </Link>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card className="gap-0 p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>ยอดขายวันนี้</span>
            <Banknote className="size-4 text-primary" />
          </div>
          <div className="mt-3 font-heading text-2xl font-bold text-slate-950 number-display sm:text-3xl">
            ฿{fmtMoney(todayTotal)}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700">
            <TrendingUp className="size-3" />
            {isPlaceholderData ? "กำลังอัปเดตข้อมูล" : "อัปเดตแบบเรียลไทม์"}
          </div>
        </Card>
        <Card className="gap-0 p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>จำนวนรายการ</span>
            <ReceiptText className="size-4 text-primary" />
          </div>
          <div className="mt-3 font-heading text-2xl font-bold text-slate-950 number-display sm:text-3xl">
            {todayBills}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            เฉลี่ย ฿{fmtMoney(averageBill)} ต่อบิล
          </div>
        </Card>
        <Card className="gap-0 p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>น้ำมันที่จ่ายแล้ว</span>
            <Droplet className="size-4 text-primary" />
          </div>
          <div className="mt-3 font-heading text-2xl font-bold text-slate-950 number-display sm:text-3xl">
            {fmtNum(litersToday)}{" "}
            <span className="text-sm font-medium text-slate-400">ลิตร</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            จากกะที่ปิดแล้ว {todayShiftCount} กะ
          </div>
        </Card>
        <Card
          className={
            lowStockCount
              ? "gap-0 border-orange-200 bg-orange-50 p-4 sm:p-5"
              : "gap-0 p-4 sm:p-5"
          }
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>สถานีและกะ</span>
            {lowStockCount ? (
              <Boxes className="size-4 text-orange-600" />
            ) : (
              <Gauge className="size-4 text-primary" />
            )}
          </div>
          <div className="mt-3 font-heading text-lg font-bold text-slate-950">
            {data.openShift ? "กำลังให้บริการ" : "รอเปิดกะ"}
          </div>
          <div className="mt-2 truncate text-[11px] text-slate-500">
            {data.openShift
              ? `${data.openShift.staffName} · เริ่ม ${fmtTime(data.openShift.openedAt)}`
              : lowStockCount
                ? `มี ${lowStockCount} รายการที่ควรตรวจสอบ`
                : "สถานีพร้อมเริ่มงาน"}
          </div>
        </Card>
      </section>

      {(data.lowTanks.length > 0 || data.lowProducts.length > 0) && (
        <Card
          data-slot="notice"
          data-tone="warning"
          role="alert"
          className="gap-0 overflow-hidden border-orange-200/80 bg-gradient-to-r from-orange-50/90 via-amber-50/80 to-white/80 py-0 shadow-[0_12px_30px_rgba(251,146,60,0.08)]"
        >
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="gap-4 overflow-hidden lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between px-5 pb-0 sm:px-6">
            <div>
              <div className="page-kicker">Revenue pulse</div>
              <CardTitle className="mt-1.5 font-heading text-lg font-bold text-slate-900">
                จังหวะยอดขาย 7 วัน
              </CardTitle>
              <p className="mt-1 text-xs text-slate-400">
                ยอด P จากกะที่ปิด + ยอด POS รายวัน
              </p>
            </div>
            <div className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground">
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
            <p className="text-xs text-slate-400">
              {data.fuelSource === "shift"
                ? "จากมิเตอร์กะที่ปิดวันนี้"
                : "จากรายการขาย POS ระหว่างรอปิดกะ"}
            </p>
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
                "from-teal-500 to-teal-700",
                "from-cyan-400 to-teal-500",
                "from-orange-400 to-rose-500",
                "from-sky-400 to-teal-500",
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
                  aria-label={`ระดับน้ำมันในถัง ${tank.name}`}
                  aria-valuetext={`${fmtNum(tank.percent)} เปอร์เซ็นต์`}
                  className={`h-2.5 ${
                    tank.isLow ? "[&>div]:bg-destructive" : "[&>div]:bg-primary"
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
              <Button variant="ghost" size="sm" className="text-primary">
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
                  className="group -mx-2 flex items-center justify-between gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-accent/70"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
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
