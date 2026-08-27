import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Eye,
  Ban,
  Banknote,
  Printer,
  Receipt,
  FileText,
  Search,
  ShoppingCart,
  Plus,
  Pencil,
  Trash2,
  UserRound,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppConfirm } from "@/components/AppConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { TaxInvoiceDialog } from "@/components/TaxInvoiceDialog";
import { ReceiptDoc } from "@/components/ReceiptDoc";
import { printReceiptElement, parseReceiptPaper } from "@/lib/printDoc";
import { fmtMoney, fmtNum, fmtDateTime, paymentLabel } from "@/lib/format";
import {
  activeBillThresholdPromotion,
  appliedBillThresholdPromotionDiscount,
  type ActiveBillThresholdPromotion,
} from "@contracts/promotion";

const r2 = (n: number) => Math.round(n * 100) / 100;

type PayMethod = "cash" | "qr" | "card" | "credit" | "thungngern";

// ตัวเลือกวิธีชำระที่ API รับ (ตรงกับ enum ใน pos router)
const PAY_METHODS: PayMethod[] = ["cash", "qr", "card", "credit", "thungngern"];

type SaleRow = {
  id: number;
  receiptNo: string;
  staffName: string;
  paymentMethod: PayMethod;
  subtotal: number;
  discount: number;
  total: number;
  status: "completed" | "voided";
  transactionType: "sale" | "return";
  returnStatus: "none" | "partial" | "full";
};

export default function Sales() {
  const confirmAction = useAppConfirm();
  const utils = trpc.useUtils();
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const canManage = isAdmin || staff?.role === "manager";

  // ค้นหา (debounce 300ms) + กรองสถานะ
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "completed" | "voided"
  >("all");
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const { data: salesList, isLoading } = trpc.pos.salesHistory.useQuery({
    q: q || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 200,
  });
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const activePromotion = activeBillThresholdPromotion(settingMap);
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [taxSaleId, setTaxSaleId] = useState<number | null>(null);
  const [editSale, setEditSale] = useState<SaleRow | null>(null);
  const [returnSaleId, setReturnSaleId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [err, setErr] = useState("");

  const { data: detail } = trpc.pos.saleDetail.useQuery(
    { id: detailId! },
    { enabled: detailId != null }
  );
  const detailNeedsPaymentQr = Boolean(
    detail &&
      detail.sale.paymentMethod === "qr" &&
      detail.sale.transactionType === "sale" &&
      detail.sale.total > 0
  );
  const detailQrAmount = detailNeedsPaymentQr
    ? r2(Math.abs(detail!.sale.total))
    : 1;
  const {
    data: detailPaymentQr,
    isFetching: detailPaymentQrLoading,
    isError: detailPaymentQrError,
  } = trpc.payments.promptpayQr.useQuery(
    { amount: detailQrAmount },
    { enabled: detailNeedsPaymentQr }
  );
  const [detailPaymentQrImage, setDetailPaymentQrImage] = useState<{
    payload: string;
    url: string;
  } | null>(null);
  useEffect(() => {
    const payload = detailNeedsPaymentQr ? detailPaymentQr?.payload : null;
    if (!payload) return;
    let cancelled = false;
    void QRCode.toDataURL(payload, {
      width: 384,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then(url => {
        if (!cancelled) setDetailPaymentQrImage({ payload, url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detailNeedsPaymentQr, detailPaymentQr?.payload]);
  const detailPaymentQrUrl =
    detailPaymentQrImage &&
    detailPaymentQrImage.payload === detailPaymentQr?.payload
      ? detailPaymentQrImage.url
      : null;

  const invalidate = () => {
    utils.pos.salesHistory.invalidate();
    utils.pos.dashboard.invalidate();
    utils.catalog.listProducts.invalidate();
    utils.membership.listMembers.invalidate();
  };

  const voidMut = trpc.pos.voidSale.useMutation({
    onSuccess: () => {
      invalidate();
      setDetailId(null);
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const updateMut = trpc.pos.updateSale.useMutation({
    onSuccess: () => {
      invalidate();
      setEditSale(null);
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const deleteMut = trpc.pos.deleteSale.useMutation({
    onSuccess: () => {
      invalidate();
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-heading flex items-center gap-2">
          <Receipt className="w-6 h-6 text-primary" /> ประวัติการขาย
        </h1>
        {canManage && (
          <Button className="w-full sm:w-auto" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> เพิ่มบิล
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* ค้นหา / กรอง */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="ค้นหาเลขที่บิล / พนักงาน / ชื่อหรือเบอร์สมาชิก"
            value={qInput}
            onChange={e => setQInput(e.target.value)}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={v => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            <SelectItem value="completed">สำเร็จ</SelectItem>
            <SelectItem value="voided">ยกเลิก</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่บิล</TableHead>
                <TableHead>วันที่</TableHead>
                <TableHead>พนักงาน</TableHead>
                <TableHead>สมาชิก</TableHead>
                <TableHead>ชำระ</TableHead>
                <TableHead className="text-right">ยอดสุทธิ</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(salesList ?? []).map(s => (
                <TableRow
                  key={s.id}
                  className={s.status === "voided" ? "opacity-50" : ""}
                >
                  <TableCell className="font-mono text-xs">
                    <div>{s.receiptNo}</div>
                    {s.transactionType === "return" && s.originalReceiptNo && (
                      <div className="mt-0.5 font-sans text-[10px] text-muted-foreground">
                        อ้างอิง {s.originalReceiptNo}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fmtDateTime(s.createdAt)}
                  </TableCell>
                  <TableCell>{s.staffName || "-"}</TableCell>
                  <TableCell>{s.memberName ?? "-"}</TableCell>
                  <TableCell>{paymentLabel[s.paymentMethod]}</TableCell>
                  <TableCell className="text-right font-semibold">
                    ฿{fmtMoney(s.total)}
                  </TableCell>
                  <TableCell>
                    {s.status === "voided" ? (
                      <Badge variant="destructive">ยกเลิก</Badge>
                    ) : s.transactionType === "return" ? (
                      <Badge variant="outline">คืนสินค้า</Badge>
                    ) : s.returnStatus === "full" ? (
                      <Badge variant="secondary">คืนครบแล้ว</Badge>
                    ) : s.returnStatus === "partial" ? (
                      <Badge variant="secondary">คืนบางส่วน</Badge>
                    ) : (
                      <Badge variant="secondary">สำเร็จ</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setDetailId(s.id)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {canManage &&
                        s.status === "completed" &&
                        s.transactionType !== "return" &&
                        s.returnStatus !== "partial" &&
                        s.returnStatus !== "full" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setEditSale(s)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                      {canManage && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={deleteMut.isPending}
                          onClick={async () => {
                            if (
                              await confirmAction(
                                `ยืนยันลบบิล ${s.receiptNo} ถาวร? (คืนสต๊อกและแต้มอัตโนมัติ)`
                              )
                            ) {
                              deleteMut.mutate({ id: s.id });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (salesList ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground py-8"
                  >
                    ไม่พบรายการขาย
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* รายละเอียดบิล / ใบเสร็จ */}
      <Dialog
        open={detailId != null}
        onOpenChange={o => !o && setDetailId(null)}
      >
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Receipt className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Receipt
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  {detail?.sale.transactionType === "return"
                    ? `เอกสารคืนสินค้า ${detail.sale.receiptNo}`
                    : `ใบเสร็จ ${detail?.sale.receiptNo}`}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  {detail?.sale.transactionType === "return"
                    ? `อ้างอิงบิล ${detail.originalSale?.receiptNo ?? "-"}`
                    : "ตรวจสอบรายละเอียดใบเสร็จ พิมพ์ซ้ำ หรือคืนสินค้าในบิล"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {detail && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
                {detailNeedsPaymentQr && !detailPaymentQrUrl && (
                  <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                    {detailPaymentQrLoading
                      ? "กำลังสร้าง QR โอนจ่ายสำหรับพิมพ์ซ้ำ…"
                      : detailPaymentQrError || detailPaymentQr?.payload === null
                        ? "ไม่สามารถสร้าง QR ได้ กรุณาตรวจสอบการตั้งค่า QR รับเงินของสาขา"
                        : "กำลังเตรียม QR โอนจ่าย…"}
                  </div>
                )}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                  <div className="p-4 text-sm">
                    <div id="receipt-print">
                      <ReceiptDoc
                        sale={{
                          ...detail.sale,
                          memberName: detail.memberName,
                          customerName: detail.customerName,
                          originalReceiptNo: detail.originalSale?.receiptNo,
                        }}
                        items={detail.items}
                        settingMap={settingMap}
                        staffName={detail.sale.staffName}
                        logoUrl={logoUrl}
                        paymentQrUrl={detailPaymentQrUrl}
                      />
                    </div>
                  </div>
                </section>
              </div>
              <DialogFooter className="shrink-0 flex-wrap border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
                <Button
                  variant="outline"
                  disabled={detailNeedsPaymentQr && !detailPaymentQrUrl}
                  title={
                    detailNeedsPaymentQr && !detailPaymentQrUrl
                      ? "รอให้ระบบสร้าง QR โอนจ่ายก่อนพิมพ์"
                      : undefined
                  }
                  onClick={() => {
                    const el = document.getElementById("receipt-print");
                    if (el)
                      printReceiptElement(
                        el,
                        parseReceiptPaper(settingMap?.receipt_paper_size)
                      );
                  }}
                >
                  <Printer className="w-4 h-4 mr-2" /> พิมพ์
                </Button>
                {detail.sale.status === "completed" &&
                  detail.sale.transactionType !== "return" && (
                    <Button
                      variant="outline"
                      onClick={() => setTaxSaleId(detail.sale.id)}
                    >
                      <FileText className="w-4 h-4 mr-2" /> ใบกำกับภาษีเต็มรูป
                    </Button>
                  )}
                {detail.sale.status === "completed" &&
                  detail.sale.transactionType !== "return" &&
                  canManage &&
                  detail.returnStatus !== "full" &&
                  detail.items.some(item => item.qty > 0) && (
                    <Button
                      variant="outline"
                      onClick={() => setReturnSaleId(detail.sale.id)}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" /> คืนสินค้า
                    </Button>
                  )}
                {detail.sale.status === "completed" && isAdmin && (
                  <Button
                    variant="destructive"
                    disabled={voidMut.isPending}
                    onClick={async () => {
                      if (
                        await confirmAction(
                          detail.sale.transactionType === "return"
                            ? "ยืนยันยกเลิกเอกสารคืนสินค้านี้? (ระบบจะหักสต๊อกและย้อนแต้มกลับ)"
                            : "ยืนยันยกเลิกบิลนี้? (คืนสต๊อกและแต้มอัตโนมัติ)"
                        )
                      ) {
                        voidMut.mutate({ id: detail.sale.id });
                      }
                    }}
                  >
                    <Ban className="w-4 h-4 mr-2" /> ยกเลิกบิล
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* แก้ไขหัวบิล (admin/manager) */}
      {editSale && (
        <EditSaleDialog
          key={editSale.id}
          sale={editSale}
          promotionActive={
            activePromotion != null &&
            Math.abs(editSale.discount - activePromotion.discount) < 0.009
          }
          saving={updateMut.isPending}
          onClose={() => setEditSale(null)}
          onSave={v => updateMut.mutate({ id: editSale.id, ...v })}
        />
      )}

      {returnSaleId != null && (
        <ReturnSaleDialog
          saleId={returnSaleId}
          onClose={() => setReturnSaleId(null)}
          onReturned={returnReceiptId => {
            invalidate();
            setReturnSaleId(null);
            setDetailId(returnReceiptId);
          }}
        />
      )}

      {/* เพิ่มบิลย้อนหลัง (admin/manager) */}
      {addOpen && (
        <AddSaleDialog
          staffName={staff?.name ?? ""}
          promotion={activePromotion}
          payMethods={PAY_METHODS.filter(
            m => (settingMap?.[`pay_${m}_enabled`] ?? "1") !== "0"
          )}
          onClose={() => setAddOpen(false)}
          onCreated={invalidate}
        />
      )}

      {/* ใบกำกับภาษีเต็มรูป */}
      <TaxInvoiceDialog saleId={taxSaleId} onClose={() => setTaxSaleId(null)} />
    </div>
  );
}

// ============ คืนสินค้าบางรายการโดยอ้างอิงบิลเดิม ============
function ReturnSaleDialog({
  saleId,
  onClose,
  onReturned,
}: {
  saleId: number;
  onClose: () => void;
  onReturned: (returnReceiptId: number) => void;
}) {
  const utils = trpc.useUtils();
  const {
    data: detail,
    isLoading,
    isFetching,
    isError,
    error: detailError,
    refetch,
  } = trpc.pos.saleDetail.useQuery(
    { id: saleId },
    { refetchOnMount: "always" }
  );
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<PayMethod | null>(null);
  const [err, setErr] = useState("");

  const methodOptions = PAY_METHODS.filter(method => {
    if ((settingMap?.[`pay_${method}_enabled`] ?? "1") === "0") return false;
    if (method === "credit" && !detail?.sale.customerId) return false;
    return true;
  });

  const originalMethod = detail?.sale.paymentMethod as PayMethod | undefined;
  const effectiveRefundMethod =
    refundMethod ??
    (originalMethod && methodOptions.includes(originalMethod)
      ? originalMethod
      : (methodOptions[0] ?? null));

  const returnableItems = detail?.returnableItems ?? [];
  const selectedLines = returnableItems
    .filter(item => selected[item.id] && item.returnable)
    .map(item => ({ item, qty: Number(quantities[item.id] ?? "0") }))
    .filter(
      line => line.qty > 0 && line.qty <= line.item.returnableQty + 0.0001
    );
  const selectedGross = r2(
    selectedLines.reduce(
      (sum, line) => sum + (line.item.amount * line.qty) / line.item.qty,
      0
    )
  );
  const estimatedRefund = r2(
    detail && detail.sale.subtotal > 0
      ? (selectedGross * detail.sale.total) / detail.sale.subtotal
      : 0
  );
  const invalidSelectedQty = returnableItems.some(item => {
    if (!selected[item.id]) return false;
    const qty = Number(quantities[item.id] ?? "0");
    return !(qty > 0) || qty > item.returnableQty + 0.0001;
  });
  const canSubmit =
    selectedLines.length > 0 &&
    !invalidSelectedQty &&
    reason.trim().length >= 3 &&
    effectiveRefundMethod != null &&
    methodOptions.includes(effectiveRefundMethod);

  const returnMut = trpc.pos.returnSale.useMutation({
    onSuccess: result => {
      utils.pos.saleDetail.invalidate({ id: saleId });
      utils.pos.salesHistory.invalidate();
      utils.pos.dashboard.invalidate();
      utils.catalog.listProducts.invalidate();
      utils.membership.listMembers.invalidate();
      onReturned(result.sale.id);
    },
    onError: error => setErr(error.message),
  });

  const toggleItem = (id: number, checked: boolean, maxQty: number) => {
    setSelected(current => ({ ...current, [id]: checked }));
    setQuantities(current => ({
      ...current,
      [id]: checked ? (current[id] ?? String(maxQty)) : (current[id] ?? ""),
    }));
    setErr("");
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-2xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white">
        <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-amber-950 to-orange-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
          <div className="relative flex items-center gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
              <RotateCcw className="h-6 w-6" />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-200">
                Product return
              </div>
              <DialogTitle className="font-heading text-xl font-bold text-white">
                คืนสินค้าในบิล {detail?.sale.receiptNo ?? ""}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-orange-100/80 sm:text-sm">
                เลือกรายการและจำนวนที่ลูกค้านำมาคืน
                ระบบจะคืนสต๊อกและปรับแต้มให้อัตโนมัติ
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {isLoading || (isFetching && returnableItems.length === 0) ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              กำลังโหลดรายการสินค้าล่าสุด...
            </p>
          ) : isError ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-destructive">
                {detailError.message || "โหลดรายการสินค้าไม่สำเร็จ"}
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                โหลดใหม่
              </Button>
            </div>
          ) : returnableItems.length === 0 ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                ไม่พบรายการสินค้าในบิลนี้
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                โหลดรายการใหม่
              </Button>
            </div>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>สินค้า</TableHead>
                    <TableHead className="text-right">ซื้อ</TableHead>
                    <TableHead className="text-right">คืนแล้ว</TableHead>
                    <TableHead className="w-32 text-right">
                      คืนครั้งนี้
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returnableItems.map(item => (
                    <TableRow
                      key={item.id}
                      className={!item.returnable ? "opacity-55" : ""}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={`เลือกคืน ${item.name}`}
                          checked={Boolean(selected[item.id])}
                          disabled={!item.returnable}
                          onChange={event =>
                            toggleItem(
                              item.id,
                              event.target.checked,
                              item.returnableQty
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        {item.productCategory === "fuel" && (
                          <div className="text-[11px] text-muted-foreground">
                            ไม่รองรับการคืนน้ำมันเชื้อเพลิง
                          </div>
                        )}
                        {item.productCategory !== "fuel" &&
                          item.returnableQty <= 0 && (
                            <div className="text-[11px] text-muted-foreground">
                              คืนครบแล้ว
                            </div>
                          )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {fmtNum(item.qty)} {item.unit}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {fmtNum(item.returnedQty)} {item.unit}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={item.returnableQty}
                          step="any"
                          className="h-8 text-right"
                          disabled={!selected[item.id] || !item.returnable}
                          value={quantities[item.id] ?? ""}
                          onChange={event => {
                            setQuantities(current => ({
                              ...current,
                              [item.id]: event.target.value,
                            }));
                            setErr("");
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>วิธีคืนเงิน</Label>
              <Select
                value={effectiveRefundMethod ?? undefined}
                onValueChange={value => setRefundMethod(value as PayMethod)}
              >
                <SelectTrigger className="w-full bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {methodOptions.map(method => (
                    <SelectItem key={method} value={method}>
                      {paymentLabel[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>เหตุผลการคืนสินค้า</Label>
              <Input
                maxLength={500}
                placeholder="เช่น สินค้าชำรุด / ซื้อผิดรุ่น"
                className="bg-white"
                value={reason}
                onChange={event => {
                  setReason(event.target.value);
                  setErr("");
                }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-orange-900">ยอดคืนโดยประมาณ</span>
              <span className="text-xl font-bold text-orange-950">
                ฿{fmtMoney(estimatedRefund)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-orange-700">
              คำนวณตามสัดส่วนส่วนลดของบิลเดิม ยอดจริงจะยืนยันโดยระบบอีกครั้ง
            </p>
          </div>
          {invalidSelectedQty && (
            <p className="text-sm text-destructive">
              จำนวนคืนต้องมากกว่า 0 และไม่เกินจำนวนที่คืนได้
            </p>
          )}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 sm:px-5">
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            disabled={!canSubmit || returnMut.isPending}
            onClick={() => {
              if (!detail || !effectiveRefundMethod) return;
              setErr("");
              returnMut.mutate({
                saleId: detail.sale.id,
                items: selectedLines.map(line => ({
                  saleItemId: line.item.id,
                  qty: line.qty,
                })),
                reason: reason.trim(),
                refundMethod: effectiveRefundMethod,
              });
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {returnMut.isPending ? "กำลังคืนสินค้า..." : "ยืนยันคืนสินค้า"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ แก้ไขหัวบิล: พนักงานผู้ขาย / วิธีชำระ / ส่วนลด ============
function EditSaleDialog({
  sale,
  promotionActive,
  saving,
  onClose,
  onSave,
}: {
  sale: SaleRow;
  promotionActive: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (v: {
    staffName: string;
    paymentMethod: PayMethod;
    discount: number;
  }) => void;
}) {
  const [staffName, setStaffName] = useState(sale.staffName);
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>(
    sale.paymentMethod
  );
  const [discount, setDiscount] = useState(String(sale.discount));
  const discountNum = promotionActive ? sale.discount : Number(discount) || 0;
  const newTotal = r2(Math.max(0, sale.subtotal - discountNum));
  const valid =
    staffName.trim().length > 0 &&
    discountNum >= 0 &&
    discountNum <= sale.subtotal;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
        <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
          <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
          <div className="relative flex items-center gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
              <Pencil className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                  Edit sale
                </span>
              </div>
              <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                แก้ไขบิล {sale.receiptNo}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                แก้ไขพนักงานผู้ขาย วิธีชำระเงิน และส่วนลดของบิล
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">ข้อมูลบิล</h3>
                <p className="text-[11px] text-slate-500">
                  พนักงานผู้ขาย วิธีชำระเงิน และส่วนลด
                </p>
              </div>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">
                  พนักงานผู้ขาย
                </Label>
                <Input
                  className="bg-white"
                  value={staffName}
                  onChange={e => setStaffName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">
                  วิธีชำระเงิน
                </Label>
                <Select
                  value={paymentMethod}
                  onValueChange={v => setPaymentMethod(v as PayMethod)}
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAY_METHODS.map(k => (
                      <SelectItem key={k} value={k}>
                        {paymentLabel[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {promotionActive ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800 sm:col-span-2">
                  ช่วงโปรโมชั่นไม่สามารถแก้ไขหรือเพิ่มส่วนลดอื่นได้
                </div>
              ) : (
                <div className="space-y-2 sm:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    ส่วนลด (บาท) — ยอดขาย ฿{fmtMoney(sale.subtotal)}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={sale.subtotal}
                    className="bg-white"
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                  />
                </div>
              )}
            </div>
          </section>
          <p className="text-sm text-muted-foreground">
            ยอดสุทธิใหม่{" "}
            <span className="font-semibold text-foreground">
              ฿{fmtMoney(newTotal)}
            </span>{" "}
            (คำนวณ VAT และแต้มสมาชิกใหม่อัตโนมัติ)
          </p>
          {discountNum > sale.subtotal && (
            <p className="text-sm text-destructive">ส่วนลดมากกว่ายอดขาย</p>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={() =>
              onSave({
                staffName: staffName.trim(),
                paymentMethod,
                discount: r2(discountNum),
              })
            }
          >
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ เพิ่มบิลย้อนหลัง ============
type Line = {
  productId: number;
  name: string;
  unit: string;
  price: number;
  qty: number;
  category: "fuel" | "lubricant" | "other";
};

function AddSaleDialog({
  staffName,
  promotion,
  payMethods,
  onClose,
  onCreated,
}: {
  staffName: string;
  promotion: ActiveBillThresholdPromotion | null;
  payMethods: PayMethod[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>(
    payMethods[0] ?? "cash"
  );
  const [received, setReceived] = useState("");
  const [phone, setPhone] = useState("");
  const [member, setMember] = useState<{ id: number; name: string } | null>(
    null
  );
  const [err, setErr] = useState("");

  const { data: memberMatches } = trpc.membership.findByPhone.useQuery(
    { phone: phone.trim() },
    { enabled: phone.trim().length >= 3 && !member }
  );

  const createMut = trpc.pos.createSale.useMutation({
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: e => setErr(e.message),
  });

  const activeProducts = (products ?? []).filter(p => p.active);
  const subtotal = r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const discountNum = Number(discount) || 0;
  const promotionDiscount = appliedBillThresholdPromotionDiscount(
    promotion,
    r2(
      lines.reduce(
        (sum, line) =>
          line.category === "fuel" ? sum + r2(line.price * line.qty) : sum,
        0
      )
    ),
    subtotal
  );
  const promotionQualified = promotionDiscount > 0;
  const effectiveDiscount = promotionQualified
    ? promotionDiscount
    : discountNum;
  const total = r2(Math.max(0, subtotal - effectiveDiscount));

  const addLine = () => {
    const p = activeProducts.find(x => x.id === Number(productId));
    const q = Number(qty);
    if (!p || !(q > 0)) return;
    setLines(prev => {
      const existing = prev.find(l => l.productId === p.id);
      if (existing) {
        return prev.map(l =>
          l.productId === p.id ? { ...l, qty: r2(l.qty + q) } : l
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit,
          price: p.price,
          qty: q,
          category: p.category,
        },
      ];
    });
    setProductId("");
    setQty("1");
    setErr("");
  };

  const submit = () => {
    if (lines.length === 0) {
      setErr("กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ");
      return;
    }
    if (!promotionQualified && discountNum > subtotal) {
      setErr("ส่วนลดมากกว่ายอดขาย");
      return;
    }
    createMut.mutate({
      staffName,
      memberId: member?.id,
      items: lines.map(l => ({ productId: l.productId, qty: l.qty })),
      discount: r2(effectiveDiscount),
      paymentMethod,
      received: paymentMethod === "cash" ? Number(received) || total : 0,
    });
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
        <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
          <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
          <div className="relative flex items-center gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
              <Plus className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                  Backdated bill
                </span>
              </div>
              <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                เพิ่มบิลย้อนหลัง
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                บันทึกรายการขายย้อนหลังพร้อมรายการสินค้า ส่วนลด และการชำระเงิน
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
          {/* เลือกสินค้า */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <ShoppingCart className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  รายการสินค้า
                </h3>
                <p className="text-[11px] text-slate-500">
                  เลือกสินค้าและจำนวนที่ต้องการเพิ่มลงในบิล
                </p>
              </div>
            </div>
            <div className="space-y-4 p-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    สินค้า
                  </Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="เลือกสินค้า" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeProducts.map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} — ฿{fmtMoney(p.price)}/{p.unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-24 space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    จำนวน
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="bg-white"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addLine}
                  disabled={!productId}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* รายการในบิล */}
              {lines.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สินค้า</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead className="text-right">รวม</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map(l => (
                      <TableRow key={l.productId}>
                        <TableCell>{l.name}</TableCell>
                        <TableCell className="text-right">
                          {l.qty} {l.unit}
                        </TableCell>
                        <TableCell className="text-right">
                          ฿{fmtMoney(r2(l.price * l.qty))}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() =>
                              setLines(prev =>
                                prev.filter(x => x.productId !== l.productId)
                              )
                            }
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </section>

          {/* สมาชิก (ไม่บังคับ) */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                <UserRound className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">สมาชิก</h3>
                <p className="text-[11px] text-slate-500">
                  {promotionQualified
                    ? "บันทึกสมาชิกได้ แต่ช่วงโปรโมชั่นจะไม่ได้รับแต้ม"
                    : "ค้นหาสมาชิกด้วยเบอร์โทร (ไม่บังคับ)"}
                </p>
              </div>
            </div>
            <div className="space-y-2 p-4">
              <Label className="text-xs font-semibold text-slate-700">
                สมาชิก (ไม่บังคับ) — ค้นด้วยเบอร์โทร
              </Label>
              {member ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{member.name}</Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setMember(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder="เบอร์โทรสมาชิก (อย่างน้อย 3 หลัก)"
                    className="bg-white"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                  />
                  {(memberMatches ?? []).length > 0 && (
                    <div className="border rounded-md divide-y">
                      {(memberMatches ?? []).map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                          onClick={() => {
                            setMember({ id: m.id, name: m.name });
                            setPhone("");
                          }}
                        >
                          {m.name} — {m.phone}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* การชำระเงิน */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <Banknote className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  การชำระเงิน
                </h3>
                <p className="text-[11px] text-slate-500">
                  ส่วนลด วิธีชำระเงิน และยอดรับเงิน
                </p>
              </div>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              {promotionQualified ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
                  {promotion?.name}: ใช้เฉพาะส่วนลดโปรโมชั่น ไม่สะสมแต้ม
                  และไม่ใช้ส่วนลดอื่นร่วม
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    ส่วนลด (บาท)
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    className="bg-white"
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">
                  วิธีชำระเงิน
                </Label>
                <Select
                  value={paymentMethod}
                  onValueChange={v => setPaymentMethod(v as PayMethod)}
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {payMethods.map(k => (
                      <SelectItem key={k} value={k}>
                        {paymentLabel[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {paymentMethod === "cash" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    รับเงิน (บาท) — เว้นว่าง = รับพอดี
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    className="bg-white"
                    value={received}
                    onChange={e => setReceived(e.target.value)}
                    placeholder={fmtMoney(total)}
                  />
                </div>
              )}
            </div>
            <div className="text-sm space-y-0.5 border-t border-slate-100 px-4 py-3">
              <p>
                ยอดขาย ฿{fmtMoney(subtotal)} — ส่วนลด ฿
                {fmtMoney(effectiveDiscount)}
              </p>
              <p className="font-semibold">ยอดสุทธิ ฿{fmtMoney(total)}</p>
            </div>
          </section>

          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            disabled={lines.length === 0 || createMut.isPending}
            onClick={submit}
          >
            บันทึกบิล
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
