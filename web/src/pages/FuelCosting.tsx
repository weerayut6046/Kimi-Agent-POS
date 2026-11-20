import { useState } from "react";
import { Calculator, Download } from "lucide-react";
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

  const exportCsv = () => {
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
    for (const item of items) {
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
  };

  return (
    <div className="min-w-0 space-y-4">
      <header className="space-y-3 rounded-2xl bg-slate-950 p-4 text-white sm:p-6">
        <h1 className="flex items-center gap-2 font-heading text-xl font-bold sm:text-2xl">
          <Calculator className="size-6 shrink-0" /> ต้นทุนและกำไรน้ำมัน
        </h1>
        <p className="text-sm text-slate-300">
          ต้นทุนถัวเฉลี่ยใหม่ทุกครั้งที่รับเข้า คิดกำไรตามราคาขายจริงหลังส่วนลด
        </p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-3 sm:items-end">
          <label className="grid min-w-0 gap-1 text-xs">
            จากวันที่
            <Input
              type="date"
              className="max-w-full bg-white text-slate-950"
              value={from}
              onChange={event => setFrom(event.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs">
            ถึงวันที่
            <Input
              type="date"
              min={from}
              className="max-w-full bg-white text-slate-950"
              value={to}
              onChange={event => setTo(event.target.value)}
            />
          </label>
          <Button
            onClick={exportCsv}
            disabled={!report.data || report.isFetching}
          >
            <Download className="size-4" /> ส่งออก CSV
          </Button>
        </div>
      </header>
      <p className="text-xs leading-relaxed text-muted-foreground">
        ใช้รายการน้ำมันที่ขายสำเร็จใน POS แยกตามสาขาและชนิดน้ำมัน
        รวมยอดคืนสินค้า ภาษีขายใช้ VAT ของแต่ละบิล
        บันทึกยอดยกมาและต้นทุนรับเข้าเป็นมูลค่าไม่รวม VAT ที่ขอคืนได้
        ส่วนลดระดับบิลปันส่วนตามมูลค่าสินค้าในบิล บัญชีปริมาณนี้ติดตามยอดขาย POS
        ส่วนยอดวัดจริงและมิเตอร์ตรวจได้ในรายงานกระทบยอดถัง
      </p>
      {(report.error || openings.error) && (
        <p role="alert" className="text-sm text-destructive">
          {report.error?.message ?? openings.error?.message}
        </p>
      )}
      {report.isLoading && <p role="status">กำลังคำนวณต้นทุน...</p>}
      {report.data && !complete && (
        <p
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          ข้อมูลบางชนิดยังไม่ครอบคลุมทั้งงวด
          กรุณาตรวจยอดยกมาและรายการที่แจ้งเตือนก่อนใช้ยอดกำไรรวม
        </p>
      )}
      <dl className="grid min-w-0 gap-3 sm:grid-cols-3">
        {[
          ["ยอดขายสุทธิที่มีบัญชีต้นทุน", amount(totalRevenue)],
          ["ต้นทุนขาย", amount(costOfSales)],
          ["กำไรขั้นต้นน้ำมัน", amount(grossProfit)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl border bg-card p-4">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-2 break-words text-xl font-bold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {items.map(item => (
        <Card key={item.id} className="min-w-0">
          <CardContent className="min-w-0 space-y-3">
            <h2 className="font-heading text-lg font-bold">{item.name}</h2>
            {!item.ledger ? (
              <p className="text-sm text-amber-800">
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
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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
                            {row.kind === "receipt" ? "—" : amount(row.profit)}
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
      {pending.length > 0 && (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-heading text-lg font-bold">
              ตั้งยอดยกมาต้นทุน
            </h2>
            <p className="text-sm text-muted-foreground">
              ใช้ยอดคงเหลือและต้นทุนที่ตรวจสอบแล้ว ณ วันเวลาเริ่มต้น
              ตั้งครั้งเดียวต่อชนิดน้ำมัน
              รายการตั้งแต่เวลานี้จะนำมาคิดต่อจากยอดยกมา
              กรุณาตรวจว่ายอดยกมายังไม่รวมรายการรับเข้าหรือขาย ณ เวลาเดียวกัน
            </p>
            <form
              className="grid min-w-0 gap-3 sm:grid-cols-2"
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
              <label className="grid min-w-0 gap-1 text-sm">
                ชนิดน้ำมัน
                <select
                  required
                  value={selected}
                  onChange={event => setSelected(event.target.value)}
                  className="h-11 min-w-0 rounded-xl border bg-background px-3"
                >
                  <option value="">เลือกชนิดน้ำมัน</option>
                  {pending.map(item => (
                    <option key={item.productId} value={item.productId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                วันเวลาเริ่มต้น
                <Input
                  type="datetime-local"
                  required
                  value={effectiveAt}
                  onChange={event => setEffectiveAt(event.target.value)}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
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
              <label className="grid min-w-0 gap-1 text-sm">
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
              <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">
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
        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-heading text-lg font-bold">
              ยืนยันต้นทุนล็อตเดิม
            </h2>
            <p className="text-sm text-muted-foreground">
              ล็อตเดิมยังไม่มีฐาน VAT ที่ยืนยัน
              ตรวจใบซื้อแล้วระบุมูลค่ารวมไม่รวม VAT ที่ขอคืนได้
              รวมค่าขนส่งและหักส่วนลดซื้อแล้ว แสดงล็อตที่รอยืนยันล่าสุด 100
              รายการ
            </p>
            <form
              className="grid min-w-0 gap-3 sm:grid-cols-2"
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
              <label className="grid min-w-0 gap-1 text-sm">
                ล็อตรับเข้า
                <select
                  required
                  value={receiptId}
                  onChange={event => setReceiptId(event.target.value)}
                  className="h-11 min-w-0 rounded-xl border bg-background px-3"
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
              <label className="grid min-w-0 gap-1 text-sm">
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
              <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">
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
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        กำไรขั้นต้นยังต้องหักค่าใช้จ่ายดำเนินงานและมูลค่าส่วนต่างถังเพิ่มเติมเพื่อสรุปผลกำไรของสถานี
      </p>
    </div>
  );
}
