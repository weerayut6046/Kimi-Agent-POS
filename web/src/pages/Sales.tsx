import { useEffect, useState } from "react";
import {
  Eye, Ban, Printer, Receipt, FileText, Search, Plus, Pencil, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { TaxInvoiceDialog } from "@/components/TaxInvoiceDialog";
import { ReceiptDoc } from "@/components/ReceiptDoc";
import { printReceiptElement, parseReceiptPaper } from "@/lib/printDoc";
import { fmtMoney, fmtDateTime, paymentLabel } from "@/lib/format";

const r2 = (n: number) => Math.round(n * 100) / 100;

type PayMethod = "cash" | "qr" | "card" | "credit";

type SaleRow = {
  id: number;
  receiptNo: string;
  staffName: string;
  paymentMethod: PayMethod;
  subtotal: number;
  discount: number;
  total: number;
  status: "completed" | "voided";
};

export default function Sales() {
  const utils = trpc.useUtils();
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const canManage = isAdmin || staff?.role === "manager";

  // ค้นหา (debounce 300ms) + กรองสถานะ
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "voided">("all");
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
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [taxSaleId, setTaxSaleId] = useState<number | null>(null);
  const [editSale, setEditSale] = useState<SaleRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [err, setErr] = useState("");

  const { data: detail } = trpc.pos.saleDetail.useQuery({ id: detailId! }, { enabled: detailId != null });

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
    onError: (e) => setErr(e.message),
  });

  const updateMut = trpc.pos.updateSale.useMutation({
    onSuccess: () => {
      invalidate();
      setEditSale(null);
      setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  const deleteMut = trpc.pos.deleteSale.useMutation({
    onSuccess: () => {
      invalidate();
      setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-2xl font-semibold flex items-center gap-2">
          <Receipt className="w-6 h-6 text-primary" /> ประวัติการขาย
        </h1>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> เพิ่มบิล
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* ค้นหา / กรอง */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="ค้นหาเลขที่บิล / พนักงาน / ชื่อหรือเบอร์สมาชิก"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[150px]">
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
              {(salesList ?? []).map((s) => (
                <TableRow key={s.id} className={s.status === "voided" ? "opacity-50" : ""}>
                  <TableCell className="font-mono text-xs">{s.receiptNo}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(s.createdAt)}</TableCell>
                  <TableCell>{s.staffName || "-"}</TableCell>
                  <TableCell>{s.memberName ?? "-"}</TableCell>
                  <TableCell>{paymentLabel[s.paymentMethod]}</TableCell>
                  <TableCell className="text-right font-semibold">฿{fmtMoney(s.total)}</TableCell>
                  <TableCell>
                    {s.status === "voided" ? <Badge variant="destructive">ยกเลิก</Badge> : <Badge variant="secondary">สำเร็จ</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDetailId(s.id)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {canManage && s.status === "completed" && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditSale(s)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {canManage && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (confirm(`ยืนยันลบบิล ${s.receiptNo} ถาวร? (คืนสต๊อกและแต้มอัตโนมัติ)`)) {
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
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">ไม่พบรายการขาย</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* รายละเอียดบิล / ใบเสร็จ */}
      <Dialog open={detailId != null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">ใบเสร็จ {detail?.sale.receiptNo}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="text-sm space-y-2">
              <div id="receipt-print">
                <ReceiptDoc
                  sale={{ ...detail.sale, memberName: detail.memberName, customerName: detail.customerName }}
                  items={detail.items}
                  settingMap={settingMap}
                  staffName={detail.sale.staffName}
                  logoUrl={logoUrl}
                />
              </div>
              <DialogFooter className="gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const el = document.getElementById("receipt-print");
                    if (el) printReceiptElement(el, parseReceiptPaper(settingMap?.receipt_paper_size));
                  }}
                >
                  <Printer className="w-4 h-4 mr-2" /> พิมพ์
                </Button>
                {detail.sale.status === "completed" && (
                  <Button variant="outline" onClick={() => setTaxSaleId(detail.sale.id)}>
                    <FileText className="w-4 h-4 mr-2" /> ใบกำกับภาษีเต็มรูป
                  </Button>
                )}
                {detail.sale.status === "completed" && isAdmin && (
                  <Button
                    variant="destructive"
                    disabled={voidMut.isPending}
                    onClick={() => {
                      if (confirm("ยืนยันยกเลิกบิลนี้? (คืนสต๊อกและแต้มอัตโนมัติ)")) {
                        voidMut.mutate({ id: detail.sale.id });
                      }
                    }}
                  >
                    <Ban className="w-4 h-4 mr-2" /> ยกเลิกบิล
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* แก้ไขหัวบิล (admin/manager) */}
      {editSale && (
        <EditSaleDialog
          key={editSale.id}
          sale={editSale}
          saving={updateMut.isPending}
          onClose={() => setEditSale(null)}
          onSave={(v) => updateMut.mutate({ id: editSale.id, ...v })}
        />
      )}

      {/* เพิ่มบิลย้อนหลัง (admin/manager) */}
      {addOpen && (
        <AddSaleDialog
          staffName={staff?.name ?? ""}
          onClose={() => setAddOpen(false)}
          onCreated={invalidate}
        />
      )}

      {/* ใบกำกับภาษีเต็มรูป */}
      <TaxInvoiceDialog saleId={taxSaleId} onClose={() => setTaxSaleId(null)} />
    </div>
  );
}

// ============ แก้ไขหัวบิล: พนักงานผู้ขาย / วิธีชำระ / ส่วนลด ============
function EditSaleDialog({
  sale,
  saving,
  onClose,
  onSave,
}: {
  sale: SaleRow;
  saving: boolean;
  onClose: () => void;
  onSave: (v: { staffName: string; paymentMethod: PayMethod; discount: number }) => void;
}) {
  const [staffName, setStaffName] = useState(sale.staffName);
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>(sale.paymentMethod);
  const [discount, setDiscount] = useState(String(sale.discount));
  const discountNum = Number(discount) || 0;
  const newTotal = r2(Math.max(0, sale.subtotal - discountNum));
  const valid = staffName.trim().length > 0 && discountNum >= 0 && discountNum <= sale.subtotal;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">แก้ไขบิล {sale.receiptNo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>พนักงานผู้ขาย</Label>
            <Input value={staffName} onChange={(e) => setStaffName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>วิธีชำระเงิน</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PayMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(paymentLabel) as PayMethod[]).map((k) => (
                  <SelectItem key={k} value={k}>{paymentLabel[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>ส่วนลด (บาท) — ยอดขาย ฿{fmtMoney(sale.subtotal)}</Label>
            <Input
              type="number"
              min={0}
              max={sale.subtotal}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            ยอดสุทธิใหม่ <span className="font-semibold text-foreground">฿{fmtMoney(newTotal)}</span> (คำนวณ VAT และแต้มสมาชิกใหม่อัตโนมัติ)
          </p>
          {discountNum > sale.subtotal && (
            <p className="text-sm text-destructive">ส่วนลดมากกว่ายอดขาย</p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button disabled={!valid || saving} onClick={() => onSave({ staffName: staffName.trim(), paymentMethod, discount: r2(discountNum) })}>
              บันทึก
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ เพิ่มบิลย้อนหลัง ============
type Line = { productId: number; name: string; unit: string; price: number; qty: number };

function AddSaleDialog({
  staffName,
  onClose,
  onCreated,
}: {
  staffName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>("cash");
  const [received, setReceived] = useState("");
  const [phone, setPhone] = useState("");
  const [member, setMember] = useState<{ id: number; name: string } | null>(null);
  const [err, setErr] = useState("");

  const { data: memberMatches } = trpc.membership.findByPhone.useQuery(
    { phone: phone.trim() },
    { enabled: phone.trim().length >= 3 && !member },
  );

  const createMut = trpc.pos.createSale.useMutation({
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  const activeProducts = (products ?? []).filter((p) => p.active);
  const subtotal = r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const discountNum = Number(discount) || 0;
  const total = r2(Math.max(0, subtotal - discountNum));

  const addLine = () => {
    const p = activeProducts.find((x) => x.id === Number(productId));
    const q = Number(qty);
    if (!p || !(q > 0)) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) => (l.productId === p.id ? { ...l, qty: r2(l.qty + q) } : l));
      }
      return [...prev, { productId: p.id, name: p.name, unit: p.unit, price: p.price, qty: q }];
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
    if (discountNum > subtotal) {
      setErr("ส่วนลดมากกว่ายอดขาย");
      return;
    }
    createMut.mutate({
      staffName,
      memberId: member?.id,
      items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      discount: r2(discountNum),
      paymentMethod,
      received: paymentMethod === "cash" ? Number(received) || total : 0,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">เพิ่มบิลย้อนหลัง</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* เลือกสินค้า */}
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label>สินค้า</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="เลือกสินค้า" /></SelectTrigger>
                <SelectContent>
                  {activeProducts.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} — ฿{fmtMoney(p.price)}/{p.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-24 space-y-1">
              <Label>จำนวน</Label>
              <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <Button type="button" variant="outline" onClick={addLine} disabled={!productId}>
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
                {lines.map((l) => (
                  <TableRow key={l.productId}>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="text-right">{l.qty} {l.unit}</TableCell>
                    <TableCell className="text-right">฿{fmtMoney(r2(l.price * l.qty))}</TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* สมาชิก (ไม่บังคับ) */}
          <div className="space-y-1">
            <Label>สมาชิก (ไม่บังคับ) — ค้นด้วยเบอร์โทร</Label>
            {member ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{member.name}</Badge>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMember(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <Input
                  placeholder="เบอร์โทรสมาชิก (อย่างน้อย 3 หลัก)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {(memberMatches ?? []).length > 0 && (
                  <div className="border rounded-md divide-y">
                    {(memberMatches ?? []).map((m) => (
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

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>ส่วนลด (บาท)</Label>
              <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>วิธีชำระเงิน</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PayMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(paymentLabel) as PayMethod[]).map((k) => (
                    <SelectItem key={k} value={k}>{paymentLabel[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {paymentMethod === "cash" && (
            <div className="space-y-1">
              <Label>รับเงิน (บาท) — เว้นว่าง = รับพอดี</Label>
              <Input type="number" min={0} value={received} onChange={(e) => setReceived(e.target.value)} placeholder={fmtMoney(total)} />
            </div>
          )}

          <div className="text-sm space-y-0.5 border-t pt-2">
            <p>ยอดขาย ฿{fmtMoney(subtotal)} — ส่วนลด ฿{fmtMoney(discountNum)}</p>
            <p className="font-semibold">ยอดสุทธิ ฿{fmtMoney(total)}</p>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button disabled={lines.length === 0 || createMut.isPending} onClick={submit}>
              บันทึกบิล
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
