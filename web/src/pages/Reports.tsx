import { useState } from "react";
import { ClipboardList, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { ZReportDoc } from "@/components/ZReportDoc";
import { printElement } from "@/lib/printDoc";
import { fmtMoney, fmtNum, fmtTime, paymentLabel, debtMethodLabel } from "@/lib/format";

/** วันนี้ในรูปแบบ YYYY-MM-DD (local — ห้ามใช้ toISOString เพราะจะเป็น UTC) */
function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const PAY_METHODS = ["cash", "qr", "card", "credit"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

export default function Reports() {
  const { staff } = useStaff();
  const [date, setDate] = useState(todayStr());

  const { data: r, isLoading, error } = trpc.reports.daily.useQuery(
    { date },
    { enabled: /^\d{4}-\d{2}-\d{2}$/.test(date) },
  );
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();

  const printReport = () => {
    const el = document.getElementById("zreport-print");
    if (el) printElement(el, "size: auto; margin: 8mm");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-2xl font-semibold flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-primary" /> รายงานปิดวัน (Z-Report)
        </h1>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="z-date" className="text-xs text-muted-foreground">วันที่</Label>
            <Input
              id="z-date"
              type="date"
              className="w-44"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button variant="outline" disabled={!r} onClick={printReport}>
            <Printer className="w-4 h-4 mr-1" /> พิมพ์ Z-report
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">กำลังโหลด...</p>}

      {r && (
        <>
          {/* การ์ดสรุป */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="py-3">
                <div className="text-xs text-muted-foreground">ยอดขายรวม</div>
                <div className="text-xl font-bold text-primary">฿{fmtMoney(r.totalSales)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3">
                <div className="text-xs text-muted-foreground">จำนวนบิล</div>
                <div className="text-xl font-bold">{r.billCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3">
                <div className="text-xs text-muted-foreground">ยกเลิก</div>
                <div className="text-xl font-bold text-destructive">
                  {r.voidedCount} <span className="text-sm font-normal">/ ฿{fmtMoney(r.voidedTotal)}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3">
                <div className="text-xs text-muted-foreground">ส่วนลด</div>
                <div className="text-xl font-bold">฿{fmtMoney(r.discountTotal)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3">
                <div className="text-xs text-muted-foreground">VAT (รวมใน)</div>
                <div className="text-xl font-bold">฿{fmtMoney(r.vatTotal)}</div>
              </CardContent>
            </Card>
          </div>

          {/* เงินสดที่ควรมีในลิ้นชัก */}
          <Card className="border-primary bg-primary/5">
            <CardContent className="py-4 flex items-baseline justify-between gap-2 flex-wrap">
              <div>
                <div className="font-semibold">เงินสดที่ควรมีในลิ้นชัก</div>
                <div className="text-xs text-muted-foreground">
                  = ขายเงินสด ฿{fmtMoney(r.byMethod.cash.total)} + ชำระหนี้เงินสด ฿{fmtMoney(r.debtPayments.byMethod.cash)} − ค่าใช้จ่าย ฿{fmtMoney(r.expenses.total)}
                </div>
              </div>
              <div className="text-2xl font-bold text-primary">฿{fmtMoney(r.expectedCash)}</div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            {/* แยกวิธีชำระ */}
            <Card>
              <CardContent className="pt-4">
                <h2 className="font-heading font-semibold mb-2">แยกตามวิธีชำระ</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วิธีชำระ</TableHead>
                      <TableHead className="text-right">จำนวนบิล</TableHead>
                      <TableHead className="text-right">ยอดเงิน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PAY_METHODS.map((m) => (
                      <TableRow key={m}>
                        <TableCell>{paymentLabel[m]}</TableCell>
                        <TableCell className="text-right">{r.byMethod[m].count}</TableCell>
                        <TableCell className="text-right font-semibold">฿{fmtMoney(r.byMethod[m].total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* ลิตรน้ำมัน */}
            <Card>
              <CardContent className="pt-4">
                <h2 className="font-heading font-semibold mb-2">ปริมาณน้ำมันขาย</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชนิดน้ำมัน</TableHead>
                      <TableHead className="text-right">ลิตร</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.fuelLiters.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell>{f.name}</TableCell>
                        <TableCell className="text-right">{fmtNum(f.liters)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell>รวม</TableCell>
                      <TableCell className="text-right">{fmtNum(r.totalLiters)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* กะการทำงาน */}
          <Card>
            <CardContent className="pt-4 overflow-x-auto">
              <h2 className="font-heading font-semibold mb-2">กะการทำงาน ({r.shifts.length})</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>กะ</TableHead>
                    <TableHead>พนักงาน</TableHead>
                    <TableHead>เปิด</TableHead>
                    <TableHead>ปิด</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">ลิตร</TableHead>
                    <TableHead className="text-right">ยอดลิตร×ราคา</TableHead>
                    <TableHead className="text-right">ยอด P</TableHead>
                    <TableHead className="text-right">ยอด POS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.shifts.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">#{s.id}</TableCell>
                      <TableCell className="text-sm">{s.staffName}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtTime(s.openedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">{s.closedAt ? fmtTime(s.closedAt) : "-"}</TableCell>
                      <TableCell>
                        {s.status === "open" ? <Badge>กำลังเปิด</Badge> : <Badge variant="secondary">ปิดแล้ว</Badge>}
                      </TableCell>
                      <TableCell className="text-right">{fmtNum(s.totalLiters)}</TableCell>
                      <TableCell className="text-right">฿{fmtMoney(s.totalAmount)}</TableCell>
                      <TableCell className="text-right">฿{fmtMoney(s.totalMoneyMeter)}</TableCell>
                      <TableCell className="text-right">฿{fmtMoney(s.posAmount)}</TableCell>
                    </TableRow>
                  ))}
                  {r.shifts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-6">ไม่มีกะในวันนี้</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            {/* ค่าใช้จ่าย */}
            <Card>
              <CardContent className="pt-4">
                <h2 className="font-heading font-semibold mb-2">
                  ค่าใช้จ่าย ({r.expenses.items.length} รายการ · ฿{fmtMoney(r.expenses.total)})
                </h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เวลา</TableHead>
                      <TableHead>รายการ</TableHead>
                      <TableHead>พนักงาน</TableHead>
                      <TableHead className="text-right">จำนวนเงิน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.expenses.items.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">{fmtTime(e.createdAt)}</TableCell>
                        <TableCell className="text-sm">{e.title}</TableCell>
                        <TableCell className="text-sm">{e.staffName || "-"}</TableCell>
                        <TableCell className="text-right">฿{fmtMoney(e.amount)}</TableCell>
                      </TableRow>
                    ))}
                    {r.expenses.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-6">ไม่มีค่าใช้จ่าย</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* รับชำระหนี้ */}
            <Card>
              <CardContent className="pt-4">
                <h2 className="font-heading font-semibold mb-2">
                  รับชำระหนี้ ({r.debtPayments.items.length} รายการ · ฿{fmtMoney(r.debtPayments.total)})
                </h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่</TableHead>
                      <TableHead>ลูกค้า</TableHead>
                      <TableHead>วิธีชำระ</TableHead>
                      <TableHead className="text-right">จำนวนเงิน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.debtPayments.items.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.paymentNo}</TableCell>
                        <TableCell className="text-sm">{p.customerName}</TableCell>
                        <TableCell className="text-sm">{debtMethodLabel[p.method] ?? p.method}</TableCell>
                        <TableCell className="text-right">฿{fmtMoney(p.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="text-sm">
                      <TableCell colSpan={4} className="text-muted-foreground">
                        {DEBT_METHODS.map((m) => `${debtMethodLabel[m]} ฿${fmtMoney(r.debtPayments.byMethod[m])}`).join(" · ")}
                      </TableCell>
                    </TableRow>
                    {r.debtPayments.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-6">ไม่มีรายการชำระหนี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* เอกสารสำหรับพิมพ์ (ซ่อนไว้บนหน้าจอ) */}
          <div className="hidden">
            <div id="zreport-print">
              <ZReportDoc
                report={r}
                settingMap={settingMap}
                logoUrl={logoUrl}
                printedBy={staff?.name}
                printedAt={new Date()}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
