import { Link } from "react-router";
import {
  Banknote,
  Droplet,
  ReceiptText,
  Clock,
  AlertTriangle,
  Fuel,
  PackageX,
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
  const { data, isLoading } = trpc.pos.dashboard.useQuery(undefined, { refetchInterval: 30000 });
  const { data: tanks } = trpc.catalog.listTanks.useQuery();

  if (isLoading || !data) {
    return <div className="py-20 text-center text-muted-foreground">กำลังโหลดข้อมูล...</div>;
  }

  const stats = [
    { label: "ยอดขายวันนี้", value: `฿${fmtMoney(data.todayTotal)}`, icon: Banknote, color: "bg-blue-600" },
    { label: "น้ำมันขายวันนี้", value: `${fmtNum(data.litersToday)} ลิตร`, icon: Droplet, color: "bg-sky-500" },
    { label: "จำนวนบิลวันนี้", value: `${data.todayBills} บิล`, icon: ReceiptText, color: "bg-indigo-500" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-heading text-2xl font-semibold">แดชบอร์ด</h1>
        {data.openShift ? (
          <Badge className="bg-green-600 hover:bg-green-600 text-white gap-1.5 px-3 py-1.5">
            <Clock className="w-3.5 h-3.5" /> กะเปิดอยู่ — {data.openShift.staffName} (เริ่ม {fmtTime(data.openShift.openedAt)})
          </Badge>
        ) : (
          <Link to="/shifts">
            <Badge variant="outline" className="gap-1.5 px-3 py-1.5 border-amber-500 text-amber-600 cursor-pointer">
              <AlertTriangle className="w-3.5 h-3.5" /> ยังไม่ได้เปิดกะ — กดเพื่อเปิดกะ
            </Badge>
          </Link>
        )}
      </div>

      {/* แจ้งเตือนสต๊อกต่ำ */}
      {(data.lowTanks.length > 0 || data.lowProducts.length > 0) && (
        <Card className="border-amber-400 bg-amber-50">
          <CardContent className="py-3 px-4 flex flex-wrap items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="text-sm text-amber-800">
              {data.lowTanks.map((t) => (
                <span key={t.id} className="mr-4">
                  <Fuel className="w-3.5 h-3.5 inline mr-1" />
                  {t.name} เหลือ {fmtNum(t.currentLiters)} ลิตร (ต่ำกว่าเกณฑ์!)
                </span>
              ))}
              {data.lowProducts.map((p) => (
                <span key={p.id} className="mr-4">
                  <PackageX className="w-3.5 h-3.5 inline mr-1" />
                  {p.name} เหลือ {fmtNum(p.stockQty)} {p.unit}
                </span>
              ))}
            </div>
            <Link to="/stock" className="ml-auto">
              <Button size="sm" variant="outline" className="border-amber-500 text-amber-700">จัดการสต๊อก</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* สถิติหลัก */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`${s.color} text-white rounded-xl p-3`}>
                <s.icon className="w-6 h-6" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">{s.label}</div>
                <div className="font-heading text-xl font-semibold">{s.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* กราฟ 7 วัน */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base">ยอดขาย 7 วันย้อนหลัง</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v: number) => `${v / 1000}k`} />
                <Tooltip
                  formatter={(v) => [`฿${fmtMoney(Number(v))}`, "ยอดขาย"]}
                  labelFormatter={(l) => `วันที่ ${l}`}
                />
                <Bar dataKey="total" fill="hsl(213, 94%, 44%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ยอดแยกชนิดน้ำมัน */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base">น้ำมันที่ขายวันนี้</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.keys(data.fuelByCode).length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">ยังไม่มียอดขายน้ำมันวันนี้</p>
            )}
            {Object.entries(data.fuelByCode).map(([code, f]) => (
              <div key={code} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div>
                  <div className="font-medium text-sm">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{fmtNum(f.liters)} ลิตร</div>
                </div>
                <div className="font-heading font-semibold">฿{fmtMoney(f.amount)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ระดับถังน้ำมัน */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base">ระดับน้ำมันในถัง</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(tanks ?? []).map((t) => (
              <div key={t.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{t.name}</span>
                  <span className={t.isLow ? "text-destructive font-semibold" : "text-muted-foreground"}>
                    {fmtNum(t.currentLiters)} / {fmtNum(t.capacityLiters)} ล.
                  </span>
                </div>
                <Progress value={t.percent} className={t.isLow ? "[&>div]:bg-destructive" : "[&>div]:bg-primary"} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* บิลล่าสุด */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="font-heading text-base">บิลล่าสุด</CardTitle>
            <Link to="/sales"><Button variant="ghost" size="sm">ดูทั้งหมด</Button></Link>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {data.recentSales.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">ยังไม่มีการขาย</p>
              )}
              {data.recentSales.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{s.receiptNo}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtTime(s.createdAt)} · {paymentLabel[s.paymentMethod]} · {s.staffName || "-"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading font-semibold">฿{fmtMoney(s.total)}</div>
                    {s.status === "voided" && <Badge variant="destructive" className="text-[10px]">ยกเลิก</Badge>}
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
