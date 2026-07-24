import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  CircleDollarSign,
  CreditCard,
  Eye,
  HandCoins,
  History,
  Landmark,
  Printer,
  QrCode,
  ReceiptText,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { DebtPaymentDoc } from "@/components/DebtPaymentDoc";
import { printElement } from "@/lib/printDoc";
import { fmtMoney, fmtDateTime, debtMethodLabel } from "@/lib/format";
import type { DebtPayment } from "@db/schema";

const DEBT_METHODS = ["cash", "qr", "transfer"] as const;
const DEBT_METHOD_ICONS = {
  cash: Banknote,
  qr: QrCode,
  transfer: Landmark,
} as const;

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

  const { data: rows, isLoading } = trpc.credit.summary.useQuery({
    q: search || undefined,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-heading flex items-center gap-2">
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
          onChange={e => setQ(e.target.value)}
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
              {(rows ?? []).map(c => (
                <TableRow key={c.id}>
                  <TableCell className="text-sm font-medium">
                    {c.name}
                  </TableCell>
                  <TableCell className="text-sm">{c.phone || "-"}</TableCell>
                  <TableCell
                    className={`text-right font-semibold ${c.outstanding > 0 ? "text-amber-600" : ""}`}
                  >
                    ฿{fmtMoney(c.outstanding)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {c.creditLimit > 0
                      ? `฿${fmtMoney(c.creditLimit)}`
                      : "ไม่จำกัด"}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setErr("");
                        setDetailId(c.id);
                      }}
                    >
                      <Eye className="w-4 h-4 mr-1" /> รายละเอียด
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (rows ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
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
    onSuccess: p => {
      invalidate();
      setAmount("");
      setNote("");
      setErr("");
      setLastPayment(p ?? null);
    },
    onError: e => setErr(e.message),
  });

  const removePay = trpc.credit.removePayment.useMutation({
    onSuccess: () => {
      invalidate();
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const submit = () => {
    const n = Number(amount);
    if (!n || n <= 0) {
      setErr("กรุณาระบุจำนวนเงินที่ถูกต้อง");
      return;
    }
    setLastPayment(null);
    receive.mutate({
      customerId,
      amount: n,
      method,
      staffName,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[94vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl sm:p-0">
        <div className="shrink-0 border-b border-violet-100 bg-gradient-to-br from-violet-50 via-white to-indigo-50 px-5 py-5 sm:px-7 sm:py-6">
          <DialogHeader className="pr-8 text-left">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-[0_8px_20px_rgba(109,79,246,0.28)]">
                <HandCoins className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-violet-600">
                  บัญชีลูกค้าเครดิต
                </p>
                <DialogTitle className="truncate font-heading text-xl leading-tight text-slate-900 sm:text-2xl">
                  {detail?.customer.name ?? "รายละเอียดลูกค้า"}
                </DialogTitle>
              </div>
            </div>
          </DialogHeader>

          {detail && (
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3">
                <p className="text-xs font-medium text-amber-700">
                  ยอดค้างชำระ
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-amber-700 sm:text-2xl">
                  ฿{fmtMoney(detail.outstanding)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <CreditCard className="size-3.5" />
                  วงเงินเครดิต
                </div>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800 sm:text-xl">
                  {detail.customer.creditLimit > 0
                    ? `฿${fmtMoney(detail.customer.creditLimit)}`
                    : "ไม่จำกัด"}
                </p>
              </div>
            </div>
          )}
        </div>

        {!detail && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            กำลังโหลด...
          </p>
        )}
        {detail && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/70 p-4 sm:p-6">
            {/* บิลเครดิตค้าง */}
            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <ReceiptText className="size-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      บิลขายเชื่อค้างชำระ
                    </h3>
                    <p className="text-xs text-slate-500">
                      รายการที่นำมาคำนวณยอดค้าง
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {detail.creditSales.length} รายการ
                </span>
              </div>
              <div className="overflow-x-auto">
                <Table className="max-sm:!min-w-full max-sm:table-fixed sm:min-w-[620px]">
                  <TableHeader className="bg-slate-50/80">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="max-sm:w-[19%] max-sm:pl-3 sm:pl-5">
                        เลขที่บิล
                      </TableHead>
                      <TableHead className="max-sm:w-[28%]">วันที่</TableHead>
                      <TableHead className="max-sm:w-[27%]">พนักงาน</TableHead>
                      <TableHead className="max-sm:w-[26%] max-sm:pr-3 text-right sm:pr-5">
                        ยอด
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.creditSales.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="max-sm:pl-3 font-mono text-xs font-medium text-slate-700 sm:pl-5">
                          {s.receiptNo}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 max-sm:text-xs">
                          {fmtDateTime(s.createdAt)}
                        </TableCell>
                        <TableCell className="truncate text-slate-600">
                          {s.staffName || "-"}
                        </TableCell>
                        <TableCell className="max-sm:pr-3 text-right font-semibold tabular-nums text-slate-900 sm:pr-5">
                          ฿{fmtMoney(s.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {detail.creditSales.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-8 text-center text-muted-foreground"
                        >
                          ไม่มีบิลขายเชื่อค้างชำระ
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>

            {/* ประวัติการชำระ */}
            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                    <History className="size-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      ประวัติการชำระ
                    </h3>
                    <p className="text-xs text-slate-500">
                      รายการรับเงินที่ผ่านมา
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {detail.payments.length} รายการ
                </span>
              </div>
              <div className="overflow-x-auto">
                <Table className="max-sm:!min-w-full max-sm:table-fixed sm:min-w-[700px]">
                  <TableHeader className="bg-slate-50/80">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="max-sm:w-[16%] max-sm:pl-3 sm:pl-5">
                        เลขที่
                      </TableHead>
                      <TableHead className="max-sm:w-[25%]">วันที่</TableHead>
                      <TableHead className="max-sm:w-[17%]">วิธี</TableHead>
                      <TableHead className="max-sm:w-[18%]">พนักงาน</TableHead>
                      <TableHead className="max-sm:w-[16%] text-right">
                        ยอด
                      </TableHead>
                      {canManage && (
                        <TableHead className="w-12 pr-3 max-sm:w-[8%]" />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.payments.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="max-sm:pl-3 font-mono text-xs font-medium text-slate-700 sm:pl-5">
                          {p.paymentNo}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 max-sm:text-xs">
                          {fmtDateTime(p.createdAt)}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {debtMethodLabel[p.method] ?? p.method}
                          </span>
                        </TableCell>
                        <TableCell className="truncate text-slate-600">
                          {p.staffName || "-"}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-slate-900">
                          ฿{fmtMoney(p.amount)}
                        </TableCell>
                        {canManage && (
                          <TableCell className="pr-3">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-destructive hover:bg-red-50 hover:text-destructive"
                              title="ลบรายการชำระ"
                              disabled={removePay.isPending}
                              onClick={() => {
                                if (
                                  confirm(
                                    `ยืนยันลบรายการชำระ ${p.paymentNo} (฿${fmtMoney(p.amount)})?`
                                  )
                                ) {
                                  removePay.mutate({ id: p.id });
                                }
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {detail.payments.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={canManage ? 6 : 5}
                          className="py-8 text-center text-muted-foreground"
                        >
                          ยังไม่มีการชำระ
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>

            {/* ฟอร์มรับชำระ — สงวนสิทธิ์ admin/manager */}
            {canManage && detail.outstanding > 0 && (
              <form
                className="overflow-hidden rounded-2xl border border-violet-200/80 bg-gradient-to-br from-white via-white to-violet-50 shadow-[0_12px_34px_rgba(109,79,246,0.12)]"
                onSubmit={e => {
                  e.preventDefault();
                  submit();
                }}
              >
                <div className="flex items-center gap-3 border-b border-violet-100 px-4 py-4 sm:px-5">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-md shadow-violet-200">
                    <CircleDollarSign className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      รับชำระหนี้
                    </h3>
                    <p className="text-xs text-slate-500">
                      บันทึกยอดเงินและวิธีที่ลูกค้าชำระ
                    </p>
                  </div>
                </div>

                <div className="space-y-4 p-4 sm:p-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                    <div className="space-y-2 sm:col-span-5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="debt-payment-amount">
                          จำนวนเงิน (บาท)
                        </Label>
                        <button
                          type="button"
                          className="text-xs font-semibold text-violet-600 transition-colors hover:text-violet-800 hover:underline"
                          onClick={() =>
                            setAmount(detail.outstanding.toFixed(2))
                          }
                        >
                          ใส่ยอดเต็ม
                        </button>
                      </div>
                      <div className="relative">
                        <Input
                          id="debt-payment-amount"
                          className="h-12 rounded-xl bg-white pr-12 text-lg font-semibold tabular-nums shadow-sm"
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder={fmtMoney(detail.outstanding)}
                          value={amount}
                          aria-invalid={Boolean(err)}
                          onChange={e => {
                            setAmount(e.target.value);
                            if (err) setErr("");
                          }}
                        />
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                          บาท
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 sm:col-span-7">
                      <Label>วิธีชำระ</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {DEBT_METHODS.map(m => {
                          const MethodIcon = DEBT_METHOD_ICONS[m];
                          return (
                            <Button
                              key={m}
                              type="button"
                              className="h-12 gap-1 rounded-xl px-1 text-xs sm:px-2 sm:text-xs"
                              variant={method === m ? "default" : "outline"}
                              aria-pressed={method === m}
                              onClick={() => setMethod(m)}
                            >
                              <MethodIcon className="size-4" />
                              <span>{debtMethodLabel[m]}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="debt-payment-note">
                      หมายเหตุ{" "}
                      <span className="font-normal text-slate-400">
                        (ถ้ามี)
                      </span>
                    </Label>
                    <Input
                      id="debt-payment-note"
                      className="h-11 rounded-xl bg-white shadow-sm"
                      placeholder="เช่น เลขอ้างอิง หรือรายละเอียดเพิ่มเติม"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                    />
                  </div>

                  {err && (
                    <p
                      className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-destructive"
                      role="alert"
                    >
                      {err}
                    </p>
                  )}

                  <Button
                    type="submit"
                    className="h-12 w-full rounded-xl text-base"
                    disabled={receive.isPending}
                  >
                    <CircleDollarSign className="size-5" />
                    {receive.isPending ? "กำลังบันทึก..." : "ยืนยันรับชำระ"}
                  </Button>
                </div>
              </form>
            )}

            {err && (!canManage || detail.outstanding <= 0) && (
              <p
                className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-destructive"
                role="alert"
              >
                {err}
              </p>
            )}

            {/* ใบรับชำระหนี้หลังบันทึกสำเร็จ */}
            {lastPayment && (
              <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <div
                  ref={printRef}
                  className="rounded-xl border border-emerald-200 bg-white p-3"
                >
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
                    if (printRef.current)
                      printElement(printRef.current, "size: auto; margin: 8mm");
                  }}
                >
                  <Printer className="w-4 h-4 mr-2" /> พิมพ์ใบรับชำระหนี้
                </Button>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                ปิดหน้าต่าง
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
