import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Download,
  Fuel,
  Gauge,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { ZReportDoc } from "@/components/ZReportDoc";
import { downloadBase64, XLSX_MIME } from "@/lib/download";
import { printElement } from "@/lib/printDoc";
import { hasMenuPermission } from "@contracts/menuPermissions";
import {
  fmtMoney,
  fmtNum,
  fmtTime,
  paymentLabel,
  debtMethodLabel,
} from "@/lib/format";

/** วันนี้ในรูปแบบ YYYY-MM-DD (local — ห้ามใช้ toISOString เพราะจะเป็น UTC) */
function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const PAY_METHODS = ["cash", "qr", "card", "credit", "thungngern"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function ReportDateField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-xs font-semibold">{label}</span>
      <Input
        type="date"
        value={value}
        min={min}
        onChange={event => onChange(event.target.value)}
        className="block h-11 max-w-full appearance-none bg-card px-3 text-card-foreground [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left"
      />
    </label>
  );
}

export default function Reports() {
  const { staff } = useStaff();
  const canViewStock =
    staff != null &&
    hasMenuPermission(staff.role, staff.menuPermissions, "stock");
  const utils = trpc.useUtils();
  const [searchParams] = useSearchParams();
  const requestedDate = searchParams.get("date") ?? "";
  const [date, setDate] = useState(
    validDate(requestedDate) ? requestedDate : todayStr()
  );
  const [rangeFrom, setRangeFrom] = useState(date);
  const [rangeTo, setRangeTo] = useState(date);
  const [exporting, setExporting] = useState<"daily" | "range" | null>(null);
  const [exportError, setExportError] = useState("");
  const {
    data: r,
    isLoading,
    error,
  } = trpc.reports.daily.useQuery({ date }, { enabled: validDate(date) });
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();

  const runExport = async (
    type: "daily" | "range",
    fetch: () => Promise<{ fileName: string; contentBase64: string }>
  ) => {
    setExportError("");
    setExporting(type);
    try {
      const file = await fetch();
      downloadBase64(file.fileName, file.contentBase64, XLSX_MIME);
    } catch (failure) {
      setExportError(
        failure instanceof Error ? failure.message : String(failure)
      );
    } finally {
      setExporting(null);
    }
  };

  const printReport = () => {
    const el = document.getElementById("zreport-print");
    if (el) printElement(el, "size: auto; margin: 8mm");
  };

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <header className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 text-white shadow-sm">
        <div className="bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.4),transparent_65%)] p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,13rem)] sm:items-end">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-indigo-400/20 text-indigo-100 ring-1 ring-white/15 sm:size-12">
                <ClipboardList className="size-5" aria-hidden="true" />
              </span>
              <h1 className="min-w-0 font-heading text-2xl font-extrabold leading-tight sm:text-3xl">
                รายงานปิดวัน
                <span className="mt-0.5 block text-xs font-semibold text-indigo-200 sm:text-sm">
                  Z-Report
                </span>
              </h1>
            </div>
            <div className="min-w-0 text-indigo-100">
              <ReportDateField
                label="วันที่รายงาน"
                value={date}
                onChange={setDate}
              />
            </div>
          </div>
          {r && (
            <div className="mt-4 grid min-w-0 gap-3 border-t border-white/15 pt-4 sm:mt-5 sm:grid-cols-2 sm:items-start sm:gap-5">
              <dl className="min-w-0">
                <dt className="text-sm font-medium text-indigo-100">
                  ยอดขายรวม
                </dt>
                <dd className="mt-1 break-words font-heading text-3xl font-extrabold leading-tight tabular-nums sm:text-4xl">
                  ฿{fmtMoney(r.totalSales)}
                </dd>
              </dl>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2.5 sm:px-4">
                <dl className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <dt className="text-sm font-medium text-indigo-100">
                    เงินสดที่ควรมีในลิ้นชัก
                  </dt>
                  <dd className="min-w-0 break-words font-heading text-xl font-bold tabular-nums sm:text-2xl">
                    ฿{fmtMoney(r.expectedCash)}
                  </dd>
                </dl>
                <details className="mt-1 text-xs text-indigo-100">
                  <summary className="w-fit cursor-pointer py-1 font-medium">
                    ที่มาของยอดเงินสด
                  </summary>
                  <dl className="mt-1 grid gap-1.5">
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <dt>ขายเงินสด</dt>
                      <dd className="tabular-nums">
                        ฿{fmtMoney(r.byMethod.cash.total)}
                      </dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <dt>ชำระหนี้เงินสด</dt>
                      <dd className="tabular-nums">
                        + ฿{fmtMoney(r.debtPayments.byMethod.cash)}
                      </dd>
                    </div>
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <dt>ค่าใช้จ่าย</dt>
                      <dd className="tabular-nums">
                        − ฿{fmtMoney(r.expenses.total)}
                      </dd>
                    </div>
                  </dl>
                </details>
              </div>
            </div>
          )}
        </div>
      </header>

      <Card className="grid min-w-0 gap-2.5 p-3 sm:gap-3 sm:p-4 md:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] md:items-start">
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <Button
            type="button"
            className="h-11 min-w-0 whitespace-normal rounded-xl px-2 text-center"
            disabled={!r}
            onClick={printReport}
          >
            <Printer className="size-4" aria-hidden="true" />
            พิมพ์ Z-Report
          </Button>
          <Button
            type="button"
            className="h-11 min-w-0 whitespace-normal rounded-xl px-2 text-center"
            variant="outline"
            disabled={exporting !== null || !validDate(date)}
            onClick={() =>
              runExport("daily", () =>
                utils.reports.exportDailyExcel.fetch({ date })
              )
            }
          >
            <Download className="size-4" aria-hidden="true" />
            {exporting === "daily" ? "กำลังสร้างไฟล์..." : "Excel รายวัน"}
          </Button>
        </div>

        <Collapsible className="min-w-0 rounded-xl border border-border/80 bg-muted/35">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="group h-11 w-full min-w-0 justify-start rounded-xl px-3 text-left"
            >
              <CalendarDays
                className="size-4 text-primary"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">Excel ตามช่วงวันที่</span>
              <ChevronDown
                className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <form
              className="grid min-w-0 gap-3 border-t border-border/70 p-3 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              onSubmit={event => {
                event.preventDefault();
                void runExport("range", () =>
                  utils.reports.exportRangeExcel.fetch({
                    from: rangeFrom,
                    to: rangeTo,
                  })
                );
              }}
            >
              <ReportDateField
                label="จากวันที่"
                value={rangeFrom}
                onChange={setRangeFrom}
              />
              <ReportDateField
                label="ถึงวันที่"
                value={rangeTo}
                onChange={setRangeTo}
                min={rangeFrom}
              />
              <Button
                type="submit"
                variant="outline"
                className="h-11 min-w-0 whitespace-normal rounded-xl sm:col-span-2 xl:col-span-1"
                disabled={
                  exporting !== null ||
                  !validDate(rangeFrom) ||
                  !validDate(rangeTo) ||
                  rangeFrom > rangeTo
                }
              >
                <Download className="size-4" aria-hidden="true" />
                {exporting === "range"
                  ? "กำลังสร้างไฟล์..."
                  : "ดาวน์โหลด Excel"}
              </Button>
            </form>
          </CollapsibleContent>
        </Collapsible>

        {exportError && (
          <p
            data-slot="notice"
            data-tone="error"
            role="alert"
            className="text-sm text-destructive md:col-span-2"
          >
            {exportError}
          </p>
        )}
      </Card>

      {error && (
        <p
          data-slot="notice"
          data-tone="error"
          role="alert"
          className="text-sm text-destructive"
        >
          {error.message}
        </p>
      )}
      {isLoading && (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      )}

      {r && (
        <dl className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          {[
            { label: "จำนวนบิล", value: fmtNum(r.billCount) },
            {
              label: "บิลยกเลิก",
              value: fmtNum(r.voidedCount),
              note: "฿" + fmtMoney(r.voidedTotal),
            },
            { label: "ส่วนลด", value: "฿" + fmtMoney(r.discountTotal) },
            { label: "VAT (รวมใน)", value: "฿" + fmtMoney(r.vatTotal) },
          ].map(metric => (
            <div
              key={metric.label}
              className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm sm:px-4 sm:py-3"
            >
              <dt className="text-xs font-medium text-muted-foreground">
                {metric.label}
              </dt>
              <dd className="mt-1 break-words font-heading text-lg font-bold leading-tight tabular-nums sm:text-xl">
                {metric.value}
                {metric.note && (
                  <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                    {metric.note}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {canViewStock && (
        <nav
          aria-label="รายงานที่เกี่ยวข้อง"
          className="grid min-w-0 grid-cols-2 gap-2 sm:max-w-md sm:gap-3"
        >
          <Button
            asChild
            variant="outline"
            className="h-11 min-w-0 whitespace-normal rounded-xl px-2 text-center text-xs sm:text-sm"
          >
            <Link to="/reports/fuel-stock">
              <Fuel className="size-4 text-primary" aria-hidden="true" />
              สรุปสต๊อกน้ำมัน
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-11 min-w-0 whitespace-normal rounded-xl px-2 text-center text-xs sm:text-sm"
          >
            <Link to="/reports/tank-reconciliation">
              <Gauge className="size-4 text-primary" aria-hidden="true" />
              กระทบยอดถัง
            </Link>
          </Button>
        </nav>
      )}

      {r && (
        <>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {/* แยกวิธีชำระ */}
            <Card className="min-w-0 overflow-hidden py-0 sm:py-0">
              <CardContent className="min-w-0 p-0 sm:p-0">
                <h2 className="border-b border-border/75 px-4 py-3 font-heading text-base font-bold sm:px-5">
                  แยกตามวิธีชำระ
                </h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วิธีชำระ</TableHead>
                      <TableHead className="text-right">จำนวนบิล</TableHead>
                      <TableHead className="text-right">ยอดเงิน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PAY_METHODS.map(m => (
                      <TableRow key={m}>
                        <TableCell>{paymentLabel[m]}</TableCell>
                        <TableCell className="text-right">
                          {r.byMethod[m].count}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ฿{fmtMoney(r.byMethod[m].total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* ลิตรน้ำมัน */}
            <Card className="min-w-0 overflow-hidden py-0 sm:py-0">
              <CardContent className="min-w-0 p-0 sm:p-0">
                <h2 className="border-b border-border/75 px-4 py-3 font-heading text-base font-bold sm:px-5">
                  ปริมาณน้ำมันขาย
                </h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชนิดน้ำมัน</TableHead>
                      <TableHead className="text-right">ลิตร</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.fuelLiters.map(f => (
                      <TableRow key={f.name}>
                        <TableCell>{f.name}</TableCell>
                        <TableCell className="text-right">
                          {fmtNum(f.liters)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell>รวม</TableCell>
                      <TableCell className="text-right">
                        {fmtNum(r.totalLiters)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* กะการทำงาน */}
          <Card className="min-w-0 overflow-hidden py-0 sm:py-0">
            <CardContent className="min-w-0 p-0 sm:p-0">
              <h2 className="border-b border-border/75 px-4 py-3 font-heading text-base font-bold sm:px-5">
                กะการทำงาน ({r.shifts.length})
              </h2>
              <Table className="min-w-max" aria-label="รายละเอียดกะการทำงาน">
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
                    <TableHead className="text-right">เงินทอน</TableHead>
                    <TableHead className="text-right">ยอดนับได้รวม</TableHead>
                    <TableHead className="text-right">เงินสดต่าง</TableHead>
                    <TableHead className="text-right">
                      เงินสดต่างเทียบ P
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.shifts.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">
                        #{s.id}
                      </TableCell>
                      <TableCell className="text-sm">{s.staffName}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fmtTime(s.openedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {s.closedAt ? fmtTime(s.closedAt) : "-"}
                      </TableCell>
                      <TableCell>
                        {s.status === "open" ? (
                          <Badge>กำลังเปิด</Badge>
                        ) : (
                          <Badge variant="secondary">ปิดแล้ว</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtNum(s.totalLiters)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{fmtMoney(s.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{fmtMoney(s.totalMoneyMeter)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{fmtMoney(s.posAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.openingFloat > 0
                          ? `฿${fmtMoney(s.openingFloat)}`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.countedTotal != null
                          ? `฿${fmtMoney(s.countedTotal)}`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.cashDiff != null ? (
                          <span
                            className={
                              s.cashDiff < 0
                                ? "text-red-600 font-medium"
                                : s.cashDiff > 0
                                  ? "text-green-700 font-medium"
                                  : ""
                            }
                          >
                            {s.cashDiff > 0 ? "+" : ""}฿{fmtMoney(s.cashDiff)}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.cashDiffP != null ? (
                          <span
                            className={
                              s.cashDiffP < 0
                                ? "text-red-600 font-medium"
                                : s.cashDiffP > 0
                                  ? "text-green-700 font-medium"
                                  : ""
                            }
                          >
                            {s.cashDiffP > 0 ? "+" : ""}฿{fmtMoney(s.cashDiffP)}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {r.shifts.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={13}
                        className="text-center text-muted-foreground py-6"
                      >
                        ไม่มีกะในวันนี้
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {/* ค่าใช้จ่าย */}
            <Card className="min-w-0 overflow-hidden py-0 sm:py-0">
              <CardContent className="min-w-0 p-0 sm:p-0">
                <h2 className="border-b border-border/75 px-4 py-3 font-heading text-base font-bold sm:px-5">
                  ค่าใช้จ่าย ({r.expenses.items.length} รายการ · ฿
                  {fmtMoney(r.expenses.total)})
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
                    {r.expenses.items.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">
                          {fmtTime(e.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm">{e.title}</TableCell>
                        <TableCell className="text-sm">
                          {e.staffName || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          ฿{fmtMoney(e.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {r.expenses.items.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-muted-foreground py-6"
                        >
                          ไม่มีค่าใช้จ่าย
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* รับชำระหนี้ */}
            <Card className="min-w-0 overflow-hidden py-0 sm:py-0">
              <CardContent className="min-w-0 p-0 sm:p-0">
                <h2 className="border-b border-border/75 px-4 py-3 font-heading text-base font-bold sm:px-5">
                  รับชำระหนี้ ({r.debtPayments.items.length} รายการ · ฿
                  {fmtMoney(r.debtPayments.total)})
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
                    {r.debtPayments.items.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">
                          {p.paymentNo}
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.customerName}
                        </TableCell>
                        <TableCell className="text-sm">
                          {debtMethodLabel[p.method] ?? p.method}
                        </TableCell>
                        <TableCell className="text-right">
                          ฿{fmtMoney(p.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="text-sm">
                      <TableCell colSpan={4} className="text-muted-foreground">
                        {DEBT_METHODS.map(
                          m =>
                            `${debtMethodLabel[m]} ฿${fmtMoney(r.debtPayments.byMethod[m])}`
                        ).join(" · ")}
                      </TableCell>
                    </TableRow>
                    {r.debtPayments.items.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-muted-foreground py-6"
                        >
                          ไม่มีรายการชำระหนี้
                        </TableCell>
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
