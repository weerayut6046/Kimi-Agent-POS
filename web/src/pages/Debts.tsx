import { useEffect, useRef, useState } from "react";
import { Eye, HandCoins, Printer, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { DebtPaymentDoc } from "@/components/DebtPaymentDoc";
import { printElement } from "@/lib/printDoc";
import { fmtMoney, fmtDateTime, debtMethodLabel } from "@/lib/format";
import type { DebtPayment } from "@db/schema";

const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

export default function Debts() {
  const { staff } = useStaff();
  const canManage = staff?.role === "admin" || staff?.role === "manager";

  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  // debounce ช่องค้นหา
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: rows, isLoading } = trpc.credit.summary.useQuery({ q: search || undefined });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-2xl font-semibold flex items-center gap-2">
          <HandCoins className="w-6 h-6 text-primary" /> ลูกหนี้เครดิต
        </h1>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="ค้นหา ชื่อ / โทรศัพท์ / เลขผู้เสียภาษี"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อลูกค้า</TableHead>
                <TableHead>โทรศัพท์</TableHead>
                <TableHead className="text-right">ยอดค้างชำระ</TableHead>
                <TableHead className="text-right">วงเงินเครดิต</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-sm font-medium">{c.name}</TableCell>
                  <TableCell className="text-sm">{c.phone || "-"}</TableCell>
                  <TableCell className={`text-right font-semibold ${c.outstanding > 0 ? "text-amber-600" : ""}`}>
                    ฿{fmtMoney(c.outstanding)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {c.creditLimit > 0 ? `฿${fmtMoney(c.creditLimit)}` : "ไม่จำกัด"}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => { setErr(""); setDetailId(c.id); }}>
                      <Eye className="w-4 h-4 mr-1" /> รายละเอียด
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (rows ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {search ? "ไม่พบลูกค้าที่ค้นหา" : "ยังไม่มีข้อมูลลูกค้า"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* รายละเอียดลูกค้าเครดิต + รับชำระหนี้ */}
      {detailId != null && (
        <DebtDetailDialog
          key={detailId}
          customerId={detailId}
          canManage={canManage}
          staffName={staff?.name ?? ""}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// ============ รายละเอียดลูกค้า: บิลเครดิตค้าง / ประวัติชำระ / รับชำระ ============
function DebtDetailDialog({
  customerId,
  canManage,
  staffName,
  onClose,
}: {
  customerId: number;
  canManage: boolean;
  staffName: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: detail } = trpc.credit.detail.useQuery({ customerId });
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof DEBT_METHODS)[number]>("cash");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [lastPayment, setLastPayment] = useState<DebtPayment | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const invalidate = () => {
    utils.credit.summary.invalidate();
    utils.credit.detail.invalidate({ customerId });
  };

  const receive = trpc.credit.receivePayment.useMutation({
    onSuccess: (p) => {
      invalidate();
      setAmount("");
      setNote("");
      setErr("");
      setLastPayment(p ?? null);
    },
    onError: (e) => setErr(e.message),
  });

  const removePay = trpc.credit.removePayment.useMutation({
    onSuccess: () => {
      invalidate();
      setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  const submit = () => {
    const n = Number(amount);
    if (!n || n <= 0) {
      setErr("กรุณาระบุจำนวนเงินที่ถูกต้อง");
      return;
    }
    setLastPayment(null);
    receive.mutate({ customerId, amount: n, method, staffName, note: note.trim() || undefined });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{detail?.customer.name ?? "รายละเอียดลูกค้า"}</DialogTitle>
        </DialogHeader>
        {!detail && <p className="text-sm text-muted-foreground py-6 text-center">กำลังโหลด...</p>}
        {detail && (
          <div className="space-y-4">
            {/* สรุปยอด */}
            <div className="flex gap-4 text-sm flex-wrap">
              <div>
                ยอดค้างชำระ <span className="font-semibold text-amber-600">฿{fmtMoney(detail.outstanding)}</span>
              </div>
              <div className="text-muted-foreground">
                วงเงินเครดิต{" "}
                {detail.customer.creditLimit > 0 ? `฿${fmtMoney(detail.customer.creditLimit)}` : "ไม่จำกัด"}
              </div>
            </div>

            {/* บิลเครดิตค้าง */}
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">บิลขายเชื่อค้างชำระ</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่บิล</TableHead>
                    <TableHead>วันที่</TableHead>
                    <TableHead>พนักงาน</TableHead>
                    <TableHead className="text-right">ยอด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.creditSales.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.receiptNo}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDateTime(s.createdAt)}</TableCell>
                      <TableCell>{s.staffName || "-"}</TableCell>
                      <TableCell className="text-right">฿{fmtMoney(s.total)}</TableCell>
                    </TableRow>
                  ))}
                  {detail.creditSales.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                        ไม่มีบิลขายเชื่อค้างชำระ
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* ประวัติการชำระ */}
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">ประวัติการชำระ</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่</TableHead>
                    <TableHead>วันที่</TableHead>
                    <TableHead>วิธี</TableHead>
                    <TableHead>พนักงาน</TableHead>
                    <TableHead className="text-right">ยอด</TableHead>
                    {canManage && <TableHead></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.paymentNo}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDateTime(p.createdAt)}</TableCell>
                      <TableCell>{debtMethodLabel[p.method] ?? p.method}</TableCell>
                      <TableCell>{p.staffName || "-"}</TableCell>
                      <TableCell className="text-right">฿{fmtMoney(p.amount)}</TableCell>
                      {canManage && (
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive"
                            title="ลบรายการชำระ"
                            disabled={removePay.isPending}
                            onClick={() => {
                              if (confirm(`ยืนยันลบรายการชำระ ${p.paymentNo} (฿${fmtMoney(p.amount)})?`)) {
                                removePay.mutate({ id: p.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {detail.payments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground py-4">
                        ยังไม่มีการชำระ
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* ฟอร์มรับชำระ */}
            {detail.outstanding > 0 && (
              <div className="space-y-3 border-t pt-3">
                <h3 className="text-sm font-semibold">รับชำระหนี้</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>จำนวนเงิน (บาท)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={fmtMoney(detail.outstanding)}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>วิธีชำระ</Label>
                    <div className="grid grid-cols-3 gap-1">
                      {DEBT_METHODS.map((m) => (
                        <Button
                          key={m}
                          type="button"
                          size="sm"
                          variant={method === m ? "default" : "outline"}
                          onClick={() => setMethod(m)}
                        >
                          {debtMethodLabel[m]}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>หมายเหตุ (ถ้ามี)</Label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <Button
                  className="w-full"
                  disabled={receive.isPending}
                  onClick={submit}
                >
                  {receive.isPending ? "กำลังบันทึก..." : "รับชำระ"}
                </Button>
              </div>
            )}

            {err && <p className="text-sm text-destructive">{err}</p>}

            {/* ใบรับชำระหนี้หลังบันทึกสำเร็จ */}
            {lastPayment && (
              <div className="space-y-2 border-t pt-3">
                <div ref={printRef} className="border rounded-lg p-3">
                  <DebtPaymentDoc
                    payment={lastPayment}
                    customerName={detail.customer.name}
                    settingMap={settingMap}
                    logoUrl={logoUrl}
                  />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    if (printRef.current) printElement(printRef.current, "size: auto; margin: 8mm");
                  }}
                >
                  <Printer className="w-4 h-4 mr-2" /> พิมพ์ใบรับชำระหนี้
                </Button>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>ปิด</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
