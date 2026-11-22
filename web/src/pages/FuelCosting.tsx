import { useState } from "react";
import {
  Calculator,
  Download,
  CalendarDays,
  ChevronDown,
  Info,
  Fuel,
  ArrowUpRight,
  Wallet,
  ReceiptText,
  AlertCircle,
  SlidersHorizontal,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { fmtMoney, fmtNum, fmtDateTime } from "@/lib/format";

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
const amount = (value: number | null | undefined) =>
  value == null ? "รอข้อมูลต้นทุน" : "฿" + fmtMoney(value);
const kindLabel = { receipt: "รับเข้า", sale: "ขาย", return: "คืนสินค้า" };

function CostDateField({
  label,
  value,
  onChange,
  type = "date",
  min,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "date" | "datetime-local";
  min?: string;
  required?: boolean;
}) {
  const date = new Date(type === "date" ? value + "T00:00:00" : value);
  const valid = Number.isFinite(date.getTime());
  const display = valid
    ? date.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      })
    : "เลือกวันที่";
  const time =
    type === "datetime-local" && valid
      ? date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
      : "";
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <span className="relative flex h-12 min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
        <span
          className="min-w-0 flex-1 truncate tabular-nums"
          aria-hidden="true"
        >
          {display}
          {time && <span className="ml-2 text-slate-500">{time}</span>}
        </span>
        <CalendarDays
          className="hidden size-4 shrink-0 text-indigo-400 sm:block"
          aria-hidden="true"
        />
        <Input
          aria-label={label}
          type={type}
          value={value}
          min={min}
          required={required}
          onChange={event => onChange(event.target.value)}
          className="absolute inset-0 block h-full w-full min-w-0 max-w-full cursor-pointer appearance-none opacity-0"
          style={{
            width: "100%",
            minWidth: 0,
            minInlineSize: 0,
            boxSizing: "border-box",
          }}
        />
      </span>
    </label>
  );
}

export default function FuelCosting() {
  const today = localDateTime().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [selected, setSelected] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(localDateTime);
  const [liters, setLiters] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [receiptNet, setReceiptNet] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const utils = trpc.useUtils();
  const openings = trpc.fuelCosting.openings.useQuery();
  const unconfirmed = trpc.fuelCosting.unconfirmedReceipts.useQuery();
  const confirmReceipt = trpc.fuelCosting.confirmReceiptCost.useMutation({
    onSuccess: async () => {
      setReceiptId("");
      setReceiptNet("");
      setReceiptNote("");
      setMessage("ยืนยันต้นทุนล็อตแล้ว");
      await Promise.all([
        utils.fuelCosting.unconfirmedReceipts.invalidate(),
        utils.fuelCosting.report.invalidate(),
      ]);
    },
    onError: error => setMessage(error.message),
  });
  const report = trpc.fuelCosting.report.useQuery(
    { from, to },
    {
      enabled:
        /^\d{4}-\d{2}-\d{2}$/.test(from) &&
        /^\d{4}-\d{2}-\d{2}$/.test(to) &&
        from <= to,
    }
  );
  const save = trpc.fuelCosting.setOpening.useMutation({
    onSuccess: async () => {
      setMessage("บันทึกยอดยกมาแล้ว");
      setConfirmed(false);
      setSelected("");
      await Promise.all([
        utils.fuelCosting.openings.invalidate(),
        utils.fuelCosting.report.invalidate(),
      ]);
    },
    onError: error => setMessage(error.message),
  });
  const items = report.data?.items ?? [];
  const pending = openings.data?.filter(item => !item.opening) ?? [];
  const complete =
    items.length > 0 && items.every(item => item.ledger?.complete);
  const totalRevenue = items.reduce(
    (sum, item) => sum + (item.ledger?.revenue ?? 0),
    0
  );
  const grossProfit = complete
    ? items.reduce((sum, item) => sum + (item.ledger?.grossProfit ?? 0), 0)
    : null;
  const costOfSales = complete
    ? items.reduce((sum, item) => sum + (item.ledger?.costOfSales ?? 0), 0)
    : null;

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const { items: exportItems } =
        await utils.client.fuelCosting.report.query({
          from,
          to,
          fullDetails: true,
        });
      const rows: Array<Array<string | number | null>> = [
        ["ต้นทุนเฉลี่ยเคลื่อนที่ น้ำมัน", from, to],
        ["ฐานคำนวณ", "ยอดขาย POS หลังส่วนลด และต้นทุนไม่รวม VAT ที่ขอคืนได้"],
        [
          "น้ำมัน",
          "วันเวลา",
          "ประเภท",
          "อ้างอิง",
          "ลิตร",
          "ยอดขาย/รับเข้าสุทธิ",
          "ต้นทุนขาย",
          "กำไรขั้นต้น",
          "ลิตรคงเหลือ",
          "ต้นทุนเฉลี่ย",
          "สถานะ",
        ],
      ];
      for (const item of exportItems) {
        if (!item.ledger) {
          rows.push([
            item.name,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "ยังไม่มียอดยกมา",
          ]);
          continue;
        }
        for (const row of item.ledger.rows)
          rows.push([
            item.name,
            fmtDateTime(row.at),
            kindLabel[row.kind],
            row.reference,
            row.liters,
            row.netAmount,
            row.costOfSales,
            row.profit,
            row.balanceLiters,
            row.averageCost,
            row.issue ?? "",
          ]);
        rows.push([
          item.name,
          "",
          "สรุปงวด",
          "",
          item.ledger.soldLiters,
          item.ledger.revenue,
          item.ledger.costOfSales,
          item.ledger.grossProfit,
          item.ledger.closingLiters,
          item.ledger.averageCost,
          item.ledger.complete ? "ข้อมูลครบ" : "ข้อมูลต้นทุนยังไม่ครบ",
        ]);
      }
      const csv = rows
        .map(row =>
          row
            .map(cell => {
              const value = String(cell ?? "");
              const safe =
                /^[=+@-]/.test(value) && typeof cell === "string"
                  ? "'" + value
                  : value;
              return '"' + safe.replaceAll('"', '""') + '"';
            })
            .join(",")
        )
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `fuel-costing-${from}-${to}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <header className="flex min-w-0 items-center gap-3 py-1">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600">
          <Calculator className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-extrabold leading-tight text-slate-950 sm:text-2xl">
            ต้นทุนและกำไรน้ำมัน
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            ต้นทุนถัวเฉลี่ย · กำไรตามยอดขายจริง
          </p>
        </div>
      </header>
      <section
        aria-label="ช่วงวันที่รายงาน"
        className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 sm:p-4"
      >
        <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end sm:gap-3">
          <CostDateField label="จากวันที่" value={from} onChange={setFrom} />
          <CostDateField
            label="ถึงวันที่"
            value={to}
            onChange={setTo}
            min={from}
          />
          <Button
            onClick={exportCsv}
            disabled={!report.data || report.isFetching || exporting}
            className="col-span-2 h-11 min-w-0 rounded-xl bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 sm:col-span-1 sm:h-12 sm:px-5"
          >
            <Download className="size-4" /> ส่งออก CSV
          </Button>
        </div>
      </section>
      {(report.error || openings.error) && (
        <p role="alert" className="text-sm text-destructive">
          {report.error?.message ?? openings.error?.message}
        </p>
      )}
      {report.isLoading && <p role="status">กำลังคำนวณต้นทุน...</p>}
      {report.data && !complete && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5 text-amber-950 sm:px-4"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-amber-600"
            aria-hidden="true"
          />
          <div className="min-w-0 text-xs leading-relaxed sm:text-sm">
            <p className="font-semibold">ข้อมูลต้นทุนยังไม่ครบทั้งงวด</p>
            <p className="mt-0.5 text-amber-800">
              ตรวจยอดยกมาและต้นทุนล็อตเพื่อดูผลกำไรรวม
            </p>
          </div>
        </div>
      )}
      <dl className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4">
        <div className="order-first col-span-2 min-w-0 rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 p-4 text-white shadow-[0_8px_22px_rgba(79,70,229,0.15)] sm:order-last sm:col-span-1 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs font-medium text-indigo-100 sm:text-sm">
              กำไรขั้นต้นน้ำมัน
            </dt>
            <ArrowUpRight
              className="size-5 text-indigo-200"
              aria-hidden="true"
            />
          </div>
          <dd className="mt-2 break-words font-heading text-2xl font-extrabold tabular-nums sm:text-3xl">
            {amount(grossProfit)}
          </dd>
          <p className="mt-1 text-[11px] text-indigo-200">
            ก่อนค่าใช้จ่ายสถานี
          </p>
        </div>
        {[
          {
            label: "ยอดขายสุทธิที่มีบัญชีต้นทุน",
            value: amount(totalRevenue),
            icon: Wallet,
          },
          { label: "ต้นทุนขาย", value: amount(costOfSales), icon: ReceiptText },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="min-w-0 rounded-2xl border border-slate-200/80 bg-card p-3.5 shadow-sm sm:p-5"
          >
            <Icon className="mb-2 size-4 text-indigo-400" aria-hidden="true" />
            <dt className="text-[11px] leading-relaxed text-slate-500 sm:text-xs">
              {label}
            </dt>
            <dd className="mt-1.5 break-words font-heading text-lg font-bold tabular-nums text-slate-900 sm:text-2xl">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <details className="group rounded-xl border border-slate-200/80 bg-white/60 text-slate-600">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium sm:px-4 [&::-webkit-details-marker]:hidden">
          <Info className="size-4 text-slate-400" aria-hidden="true" />
          วิธีคำนวณต้นทุนและกำไร
          <ChevronDown
            className="ml-auto size-4 text-slate-400 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <p className="border-t border-slate-100 px-3 py-3 text-xs leading-relaxed sm:px-4">
          ใช้รายการน้ำมันที่ขายสำเร็จใน POS แยกตามสาขาและชนิดน้ำมัน
          รวมยอดคืนสินค้า ภาษีขายใช้ VAT ของแต่ละบิล
          ยอดยกมาและต้นทุนรับเข้าใช้มูลค่าไม่รวม VAT ที่ขอคืนได้
          ส่วนลดระดับบิลปันส่วนตามมูลค่าสินค้าในบิล บัญชีปริมาณติดตามยอดขาย POS
          ส่วนยอดวัดจริงและมิเตอร์ตรวจได้ในรายงานกระทบยอดถัง
        </p>
      </details>
      {items.length > 0 && (
        <h2 className="pt-1 font-heading text-base font-bold text-slate-900">
          แยกตามชนิดน้ำมัน
        </h2>
      )}
      <div className="grid min-w-0 gap-3 sm:gap-4 lg:grid-cols-2">
        {items.map(item => (
          <Card
            key={item.id}
            className="min-w-0 gap-0 rounded-2xl border-slate-200/80 py-4 shadow-sm sm:py-5"
          >
            <CardContent className="min-w-0 space-y-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Fuel className="size-4" aria-hidden="true" />
                </span>
                <h3 className="min-w-0 flex-1 font-heading text-base font-bold text-slate-900">
                  {item.name}
                </h3>
                {!item.ledger && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                    รอยอดยกมา
                  </span>
                )}
              </div>
              {!item.ledger ? (
                <p className="text-xs leading-relaxed text-slate-500">
                  ตั้งยอดยกมาเพื่อเริ่มคำนวณน้ำมันชนิดนี้
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    เริ่มบัญชี {fmtDateTime(item.ledger.openingAt)} · ยกมา{" "}
                    {fmtNum(item.ledger.openingLiters)} ลิตร · รับเข้า{" "}
                    {fmtNum(item.ledger.receivedLiters)} ลิตร · ขายสุทธิ{" "}
                    {fmtNum(item.ledger.soldLiters)} ลิตร
                  </p>
                  <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 [&_dd]:mt-1 [&_dd]:break-words [&_dd]:text-sm [&_dd]:tabular-nums [&_dd]:text-slate-900">
                    <div>
                      <dt>ต้นทุนเฉลี่ยคงเหลือ/ลิตร</dt>
                      <dd className="font-semibold">
                        {item.ledger.averageCost == null
                          ? "รอข้อมูล"
                          : "฿" + item.ledger.averageCost.toFixed(6)}
                      </dd>
                    </div>
                    <div>
                      <dt>คงเหลือตามบัญชี POS</dt>
                      <dd className="font-semibold">
                        {fmtNum(item.ledger.closingLiters)} ลิตร
                      </dd>
                    </div>
                    <div>
                      <dt>มูลค่าคงเหลือ</dt>
                      <dd className="font-semibold">
                        {amount(item.ledger.closingValue)}
                      </dd>
                    </div>
                    <div>
                      <dt>กำไรขั้นต้นในงวด</dt>
                      <dd className="font-semibold">
                        {amount(item.ledger.grossProfit)}
                      </dd>
                    </div>
                  </dl>
                  <details>
                    <summary className="cursor-pointer py-2 text-sm font-semibold text-primary">
                      รายการต้นทุนและกำไร ({item.ledger.eventCount})
                    </summary>
                    {item.ledger.eventCount > 1000 && (
                      <p className="text-xs">
                        แสดงล่าสุด 1,000 รายการ ยอดรวมคำนวณจากทุกรายการ
                        เลือกช่วงวันให้สั้นลงเพื่อดูรายการก่อนหน้า
                      </p>
                    )}
                    <Table className="min-w-max">
                      <TableHeader>
                        <TableRow>
                          {[
                            "วันเวลา",
                            "รายการ",
                            "ลิตร",
                            "ยอดสุทธิ",
                            "ต้นทุนขาย",
                            "กำไรขั้นต้น",
                            "กำไร/ลิตร",
                            "ต้นทุนเฉลี่ยหลังรายการ",
                            "สถานะ",
                          ].map(label => (
                            <TableHead key={label}>{label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.ledger.rows.map(row => (
                          <TableRow key={row.id}>
                            <TableCell>{fmtDateTime(row.at)}</TableCell>
                            <TableCell>
                              {kindLabel[row.kind]} {row.reference}
                            </TableCell>
                            <TableCell>{fmtNum(row.liters)}</TableCell>
                            <TableCell>{amount(row.netAmount)}</TableCell>
                            <TableCell>
                              {row.kind === "receipt"
                                ? "—"
                                : amount(row.costOfSales)}
                            </TableCell>
                            <TableCell>
                              {row.kind === "receipt"
                                ? "—"
                                : amount(row.profit)}
                            </TableCell>
                            <TableCell>
                              {row.profit == null || row.liters === 0
                                ? "—"
                                : amount(
                                    row.profit /
                                      (row.kind === "return"
                                        ? -row.liters
                                        : row.liters)
                                  )}
                            </TableCell>
                            <TableCell>
                              {row.averageCost?.toFixed(6) ?? "—"}
                            </TableCell>
                            <TableCell>{row.issue ?? "ข้อมูลครบ"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </details>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {pending.length > 0 && (
        <Card
          id="fuel-cost-opening"
          className="min-w-0 rounded-2xl border-indigo-100 shadow-sm"
        >
          <CardContent className="space-y-3">
            <h2 className="flex items-center gap-2 font-heading text-base font-bold text-slate-900">
              <SlidersHorizontal
                className="size-4 text-indigo-500"
                aria-hidden="true"
              />{" "}
              ตั้งยอดยกมาต้นทุน
            </h2>
            <p className="text-xs leading-relaxed text-slate-500">
              ใช้ยอดคงเหลือและต้นทุนที่ตรวจสอบแล้ว ณ วันเวลาเริ่มต้น
              ตั้งครั้งเดียวต่อชนิดน้ำมัน
              รายการตั้งแต่เวลานี้จะนำมาคิดต่อจากยอดยกมา
              กรุณาตรวจว่ายอดยกมายังไม่รวมรายการรับเข้าหรือขาย ณ เวลาเดียวกัน
            </p>
            <form
              className="grid min-w-0 gap-4 rounded-xl bg-slate-50/70 p-3 sm:grid-cols-2 sm:p-4"
              onSubmit={event => {
                event.preventDefault();
                if (!confirmed || !selected || liters === "" || unitCost === "")
                  return;
                save.mutate({
                  productId: Number(selected),
                  effectiveAt: new Date(effectiveAt),
                  liters: Number(liters),
                  unitCost: Number(unitCost),
                  note,
                });
              }}
            >
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">
                ชนิดน้ำมัน
                <select
                  required
                  value={selected}
                  onChange={event => setSelected(event.target.value)}
                  className="h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900"
                >
                  <option value="">เลือกชนิดน้ำมัน</option>
                  {pending.map(item => (
                    <option key={item.productId} value={item.productId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <CostDateField
                label="วันเวลาเริ่มต้น"
                type="datetime-local"
                required
                value={effectiveAt}
                onChange={setEffectiveAt}
              />
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">
                ลิตรยกมา
                <Input
                  type="number"
                  required
                  min="0"
                  step="0.001"
                  value={liters}
                  onChange={event => setLiters(event.target.value)}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">
                ต้นทุนยกมา/ลิตร ไม่รวม VAT ที่ขอคืนได้
                <Input
                  type="number"
                  required
                  min="0"
                  step="0.000001"
                  value={unitCost}
                  onChange={event => setUnitCost(event.target.value)}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600 sm:col-span-2">
                ที่มาของยอดยกมา
                <Input
                  required
                  maxLength={500}
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  placeholder="เช่น ตรวจนับและกระทบใบซื้อ ณ เวลาเริ่มต้น"
                />
              </label>
              <Label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={event => setConfirmed(event.target.checked)}
                />
                ตรวจสอบวันเวลา ลิตร และต้นทุนยกมาแล้ว
              </Label>
              <Button
                type="submit"
                disabled={!confirmed || save.isPending || !selected}
              >
                {save.isPending ? "กำลังบันทึก..." : "บันทึกยอดยกมา"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {(unconfirmed.data?.length ?? 0) > 0 && (
        <Card className="min-w-0 rounded-2xl border-slate-200/80 shadow-sm">
          <CardContent className="space-y-3">
            <h2 className="font-heading text-lg font-bold">
              ยืนยันต้นทุนล็อตเดิม
            </h2>
            <p className="text-xs leading-relaxed text-slate-500">
              ล็อตเดิมยังไม่มีฐาน VAT ที่ยืนยัน
              ตรวจใบซื้อแล้วระบุมูลค่ารวมไม่รวม VAT ที่ขอคืนได้
              รวมค่าขนส่งและหักส่วนลดซื้อแล้ว แสดงล็อตที่รอยืนยันล่าสุด 100
              รายการ
            </p>
            <form
              className="grid min-w-0 gap-4 rounded-xl bg-slate-50/70 p-3 sm:grid-cols-2 sm:p-4"
              onSubmit={event => {
                event.preventDefault();
                if (receiptId && receiptNet !== "")
                  confirmReceipt.mutate({
                    id: Number(receiptId),
                    netAmount: Number(receiptNet),
                    note: receiptNote,
                  });
              }}
            >
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">
                ล็อตรับเข้า
                <select
                  required
                  value={receiptId}
                  onChange={event => setReceiptId(event.target.value)}
                  className="h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900"
                >
                  <option value="">เลือกล็อต</option>
                  {unconfirmed.data?.map(row => (
                    <option key={row.id} value={row.id}>
                      #{row.id} {row.name} {fmtNum(row.liters)} ลิตร{" "}
                      {fmtDateTime(row.at)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600">
                มูลค่าต้นทุนสุทธิทั้งล็อต (บาท)
                <Input
                  type="number"
                  required
                  min="0"
                  step="0.000001"
                  value={receiptNet}
                  onChange={event => setReceiptNet(event.target.value)}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-slate-600 sm:col-span-2">
                ที่มาของต้นทุนที่ตรวจสอบแล้ว
                <Input
                  required
                  maxLength={500}
                  value={receiptNote}
                  onChange={event => setReceiptNote(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                disabled={!receiptId || confirmReceipt.isPending}
              >
                ยืนยันต้นทุนล็อต
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800"
        >
          {message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        กำไรขั้นต้นยังต้องหักค่าใช้จ่ายดำเนินงานและมูลค่าส่วนต่างถังเพิ่มเติมเพื่อสรุปผลกำไรของสถานี
      </p>
    </div>
  );
}
