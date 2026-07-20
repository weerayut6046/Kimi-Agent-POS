import { Link } from "react-router";
import {
  Banknote,
  Droplet,
  ReceiptText,
  AlertTriangle,
  Fuel,
  PackageX,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { fmtMoney, fmtNum, fmtTime, paymentLabel } from "@/lib/format";

export default function Dashboard() {
  const { data, isLoading } = trpc.pos.dashboard.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const { data: tanks } = trpc.catalog.listTanks.useQuery();

  if (isLoading || !data) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        กำลังโหลดข้อมูล...
      </div>
    );
  }

  const stats = [
    {
      label: "ยอดขายวันนี้",
      value: `฿${fmtMoney(data.todayTotal)}`,
      icon: Banknote,
      soft: "bg-blue-50 text-blue-700",
      bar: "bg-blue-500",
    },
    {
      label: "น้ำมันขายวันนี้",
      value: `${fmtNum(data.litersToday)} ลิตร`,
      icon: Droplet,
      soft: "bg-cyan-50 text-cyan-700",
      bar: "bg-cyan-500",
    },
    {
      label: "จำนวนบิลวันนี้",
      value: `${data.todayBills} บิล`,
      icon: ReceiptText,
      soft: "bg-violet-50 text-violet-700",
      bar: "bg-violet-500",
    },
  ];

  const todayLabel = new Intl.DateTimeFormat("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="space-y-5 lg:space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2854] p-5 text-white shadow-xl shadow-blue-950/10 sm:p-6">
        <div className="pointer-events-none absolute -right-12 -top-20 size-64 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-16 h-24 w-40 -skew-x-12 bg-orange-400/10" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-300">
              Station overview
            </div>
            <h1 className="mt-1 font-heading text-2xl font-bold sm:text-3xl">
              ภาพรวมสถานี
            </h1>
            <p className="mt-1.5 text-sm text-blue-100/[0.65]">{todayLabel}</p>
            <div className="mt-4">
              {data.openShift ? (
                <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative size-2 rounded-full bg-emerald-400" />
                  </span>
                  กะเปิดอยู่ · {data.openShift.staffName} · เริ่ม{" "}
                  {fmtTime(data.openShift.openedAt)}
                </div>
              ) : (
                <Link
                  to="/shifts"
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-300/[0.15]"
                >
                  <AlertTriangle className="size-4" /> ยังไม่ได้เปิดกะ ·
                  เปิดกะตอนนี้
                </Link>
              )}
            </div>
          </div>
          <Link to="/pos" className="w-full sm:w-auto">
            <Button className="h-12 w-full gap-3 rounded-xl bg-orange-500 px-5 text-white shadow-lg shadow-orange-950/20 hover:bg-orange-600 sm:w-auto">
              <ReceiptText className="size-5" /> เริ่มขายสินค้า{" "}
              <ArrowRight className="size-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* แจ้งเตือนสต๊อกต่ำ */}
      {(data.lowTanks.length > 0 || data.lowProducts.length > 0) && (
        <Card className="gap-0 border-amber-200 bg-amber-50/80 py-0 shadow-none">
          <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle className="size-[18px]" />
            </div>
            <div className="text-sm text-amber-900">
              {data.lowTanks.map(t => (
                <span key={t.id} className="mr-4">
                  <Fuel className="w-3.5 h-3.5 inline mr-1" />
                  {t.name} เหลือ {fmtNum(t.currentLiters)} ลิตร (ต่ำกว่าเกณฑ์!)
                </span>
              ))}
              {data.lowProducts.map(p => (
                <span key={p.id} className="mr-4">
                  <PackageX className="w-3.5 h-3.5 inline mr-1" />
                  {p.name} เหลือ {fmtNum(p.stockQty)} {p.unit}
                </span>
              ))}
            </div>
            <Link to="/stock" className="ml-auto">
              <Button
                size="sm"
                variant="outline"
                className="border-amber-300 bg-white text-amber-800"
              >
                จัดการสต๊อก <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* สถิติหลัก */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map(s => (
          <Card key={s.label} className="relative gap-0 overflow-hidden py-0">
            <span className={`absolute inset-y-0 left-0 w-1 ${s.bar}`} />
            <CardContent className="flex items-center gap-4 p-4 pl-5 sm:p-5 sm:pl-6">
              <div
                className={`grid size-11 shrink-0 place-items-center rounded-xl ${s.soft}`}
              >
                <s.icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-500">
                  {s.label}
                </div>
                <div className="mt-1 truncate font-heading text-xl font-bold text-slate-900 number-display">
                  {s.value}
                </div>
              </div>
              <TrendingUp className="size-4 text-slate-300" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* กราฟ 7 วัน */}
        <Card className="gap-4 lg:col-span-2">
          <CardHeader className="px-5 pb-0">
            <CardTitle className="font-heading text-base text-slate-800">
              ยอดขาย 7 วันย้อนหลัง
            </CardTitle>
            <p className="text-xs text-slate-400">แนวโน้มยอดขายรวมรายวัน</p>
          </CardHeader>
          <CardContent className="h-64 px-3 pb-2 sm:px-5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.chart}>
                <CartesianGrid
                  stroke="#e2e8f0"
                  strokeDasharray="4 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v / 1000}k`}
                />
                <Tooltip
                  cursor={{ fill: "#eff6ff" }}
                  contentStyle={{
                    borderRadius: 12,
                    borderColor: "#dbeafe",
                    boxShadow: "0 12px 30px rgba(15,23,42,.1)",
                  }}
                  formatter={v => [`฿${fmtMoney(Number(v))}`, "ยอดขาย"]}
                  labelFormatter={l => `วันที่ ${l}`}
                />
                <Bar dataKey="total" fill="#2563eb" radius={[7, 7, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ยอดแยกชนิดน้ำมัน */}
        <Card className="gap-4">
          <CardHeader className="px-5 pb-0">
            <CardTitle className="font-heading text-base text-slate-800">
              น้ำมันที่ขายวันนี้
            </CardTitle>
            <p className="text-xs text-slate-400">แยกตามชนิดเชื้อเพลิง</p>
          </CardHeader>
          <CardContent className="space-y-2 px-5">
            {Object.keys(data.fuelByCode).length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                ยังไม่มียอดขายน้ำมันวันนี้
              </p>
            )}
            {Object.entries(data.fuelByCode).map(([code, f]) => (
              <div
                key={code}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="size-2 rounded-full bg-blue-500" />
                  <div>
                    <div className="text-sm font-semibold text-slate-700">
                      {f.name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {fmtNum(f.liters)} ลิตร
                    </div>
                  </div>
                </div>
                <div className="font-heading font-bold text-slate-800 number-display">
                  ฿{fmtMoney(f.amount)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ระดับถังน้ำมัน */}
        <Card className="gap-4">
          <CardHeader className="px-5 pb-0">
            <CardTitle className="font-heading text-base text-slate-800">
              ระดับน้ำมันในถัง
            </CardTitle>
            <p className="text-xs text-slate-400">ปริมาณคงเหลือล่าสุด</p>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            {(tanks ?? []).map(t => (
              <div key={t.id}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="font-medium text-slate-700">{t.name}</span>
                  <span
                    className={
                      t.isLow
                        ? "text-destructive font-semibold"
                        : "text-muted-foreground"
                    }
                  >
                    {fmtNum(t.currentLiters)} / {fmtNum(t.capacityLiters)} ล.
                  </span>
                </div>
                <Progress
                  value={t.percent}
                  className={
                    t.isLow ? "[&>div]:bg-destructive" : "[&>div]:bg-primary"
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* บิลล่าสุด */}
        <Card className="gap-3 lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between px-5 pb-0">
            <div>
              <CardTitle className="font-heading text-base text-slate-800">
                บิลล่าสุด
              </CardTitle>
              <p className="mt-1 text-xs text-slate-400">
                รายการที่เพิ่งชำระเงิน
              </p>
            </div>
            <Link to="/sales">
              <Button variant="ghost" size="sm">
                ดูทั้งหมด
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="px-5">
            <div className="divide-y">
              {data.recentSales.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  ยังไม่มีการขาย
                </p>
              )}
              {data.recentSales.map(s => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-700">
                      {s.receiptNo}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {fmtTime(s.createdAt)} · {paymentLabel[s.paymentMethod]} ·{" "}
                      {s.staffName || "-"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading font-bold text-slate-800 number-display">
                      ฿{fmtMoney(s.total)}
                    </div>
                    {s.status === "voided" && (
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
