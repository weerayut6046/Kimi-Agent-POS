import { useMemo, useState } from "react";
import {
  Fuel,
  Minus,
  Plus,
  Trash2,
  UserPlus,
  X,
  Printer,
  BadgePercent,
  Star,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { TaxInvoiceDialog } from "@/components/TaxInvoiceDialog";
import { ReceiptDoc } from "@/components/ReceiptDoc";
import { printReceiptElement, parseReceiptPaper } from "@/lib/printDoc";
import { fmtMoney, fmtNum, paymentLabel } from "@/lib/format";
import type { Product, Member, Customer } from "@db/schema";

type CartLine = { product: Product; qty: number };

type ReceiptData = {
  sale: {
    id: number;
    receiptNo: string;
    createdAt: Date;
    subtotal: number;
    discount: number;
    vatRate: number;
    vatAmount: number;
    total: number;
    paymentMethod: "cash" | "qr" | "card" | "credit";
    received: number;
    changeAmt: number;
    pointsEarned: number;
    pointsRedeemed: number;
    memberName: string | null;
    customerName: string | null;
  };
  items: { name: string; qty: number; unit: string; unitPrice: number; amount: number }[];
};

export default function Pos() {
  const { staff } = useStaff();
  const utils = trpc.useUtils();
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();
  const { data: currentShift } = trpc.pos.currentShift.useQuery();

  const [tab, setTab] = useState("fuel");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [phoneQ, setPhoneQ] = useState("");
  const [discount, setDiscount] = useState(0);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [payMethod, setPayMethod] = useState<"cash" | "qr" | "card" | "credit">("cash");
  const [received, setReceived] = useState("");
  const [creditCustomer, setCreditCustomer] = useState<Customer | null>(null);
  const [custQ, setCustQ] = useState("");
  const [fuelDialog, setFuelDialog] = useState<Product | null>(null);
  const [fuelMode, setFuelMode] = useState<"liters" | "baht">("baht");
  const [fuelValue, setFuelValue] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [taxSaleId, setTaxSaleId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const pointValue = Number(settingMap?.point_redeem_value ?? "1");
  const activeProducts = useMemo(
    () => (products ?? []).filter((p) => p.active && p.category === tab),
    [products, tab],
  );

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const redeemDiscount = pointsToRedeem * pointValue;
  const total = Math.max(0, subtotal - discount - redeemDiscount);
  const receivedNum = Number(received) || 0;
  const change = payMethod === "cash" ? Math.max(0, receivedNum - total) : 0;

  const addToCart = (p: Product, qty: number) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) {
        const next = [...c];
        next[i] = { ...next[i], qty: Math.round((next[i].qty + qty) * 10000) / 10000 };
        return next;
      }
      return [...c, { product: p, qty }];
    });
  };

  const setQty = (id: number, qty: number) =>
    setCart((c) => c.map((l) => (l.product.id === id ? { ...l, qty: Math.max(0, Math.round(qty * 100) / 100) } : l)).filter((l) => l.qty > 0));

  const addFuel = () => {
    if (!fuelDialog) return;
    const v = Number(fuelValue);
    if (!v || v <= 0) return;
    // โหมดเงิน: เก็บลิตรแบบไม่ปัด เพื่อให้ยอดเงินตรงกับที่กรอกพอดี (มิเตอร์หัวจ่ายจริงก็เที่ยงตรงที่ยอดเงิน)
    // โหมดลิตร: ผู้ใช้ระบุลิตรเอง ปัด 2 ตำแหน่งได้ ยอดเงินตามมาทีหลัง
    const liters = fuelMode === "liters" ? Math.round(v * 100) / 100 : v / fuelDialog.price;
    addToCart(fuelDialog, liters);
    setFuelDialog(null);
    setFuelValue("");
  };

  const createSale = trpc.pos.createSale.useMutation({
    onSuccess: (r) => {
      setReceipt({ sale: r.sale as ReceiptData["sale"], items: r.items });
      setCart([]);
      setMember(null);
      setDiscount(0);
      setPointsToRedeem(0);
      setReceived("");
      setCreditCustomer(null);
      setCustQ("");
      setErr("");
      utils.pos.dashboard.invalidate();
      utils.pos.salesHistory.invalidate();
      utils.catalog.listProducts.invalidate();
      utils.credit.summary.invalidate();
      if (member) utils.membership.listMembers.invalidate();
    },
    onError: (e) => setErr(e.message),
  });

  const memberSearch = trpc.membership.findByPhone.useQuery(
    { phone: phoneQ },
    { enabled: phoneQ.length >= 9 },
  );

  // ขายเชื่อ — ค้นหาลูกค้าเครดิต + ดึงยอดค้างของลูกค้าที่เลือก
  const { data: custResults } = trpc.customers.list.useQuery(
    { q: custQ, limit: 8 },
    { enabled: payMethod === "credit" && !creditCustomer && custQ.trim().length >= 2 },
  );
  const { data: creditDetail } = trpc.credit.detail.useQuery(
    { customerId: creditCustomer?.id ?? -1 },
    { enabled: payMethod === "credit" && creditCustomer != null },
  );

  const checkout = () => {
    if (cart.length === 0) return;
    if (payMethod === "cash" && receivedNum < total) {
      setErr("จำนวนเงินรับไม่พอ");
      return;
    }
    if (payMethod === "credit" && !creditCustomer) {
      setErr("ขายเชื่อต้องเลือกลูกค้าก่อนชำระ");
      return;
    }
    createSale.mutate({
      shiftId: currentShift?.id,
      staffName: staff?.name ?? "",
      memberId: member?.id,
      customerId: payMethod === "credit" ? creditCustomer?.id : undefined,
      items: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
      discount,
      paymentMethod: payMethod,
      received: receivedNum,
      pointsToRedeem,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* สินค้า */}
      <div className="lg:col-span-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-2xl font-semibold">ขายสินค้า</h1>
          {!currentShift && (
            <Badge variant="outline" className="border-amber-500 text-amber-600">ยังไม่ได้เปิดกะ</Badge>
          )}
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="fuel">น้ำมัน</TabsTrigger>
            <TabsTrigger value="lubricant">2T/น้ำมันเครื่อง</TabsTrigger>
            <TabsTrigger value="other">สินค้าอื่นๆ</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {activeProducts.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                if (p.category === "fuel") {
                  setFuelDialog(p);
                  setFuelMode("baht");
                  setFuelValue("");
                } else {
                  addToCart(p, 1);
                }
              }}
              className="bg-card border rounded-xl p-4 text-left hover:border-primary hover:shadow-md transition-all active:scale-95"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`rounded-lg p-1.5 ${p.category === "fuel" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                  <Fuel className="w-4 h-4" />
                </div>
                {p.category !== "fuel" && (
                  <span className="text-[10px] text-muted-foreground">คงเหลือ {fmtNum(p.stockQty)}</span>
                )}
              </div>
              <div className="font-medium text-sm leading-tight">{p.name}</div>
              <div className="font-heading font-semibold text-primary mt-1">
                ฿{fmtMoney(p.price)}<span className="text-xs font-normal text-muted-foreground">/{p.unit}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ตะกร้า */}
      <Card className="lg:col-span-2 h-fit sticky top-4">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base">รายการขาย</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* สมาชิก */}
          {member ? (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <div className="text-sm">
                <span className="font-medium">{member.name}</span>
                <span className="text-muted-foreground ml-2 text-xs">แต้ม {member.points}</span>
              </div>
              <button onClick={() => { setMember(null); setPointsToRedeem(0); }}>
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <Input
                  placeholder="ค้นหาสมาชิกด้วยเบอร์โทร"
                  value={phoneQ}
                  onChange={(e) => setPhoneQ(e.target.value)}
                  inputMode="tel"
                  className="h-9"
                />
              </div>
              {phoneQ.length >= 9 && (
                <div className="border rounded-lg divide-y text-sm max-h-32 overflow-y-auto">
                  {(memberSearch.data ?? []).map((m) => (
                    <button
                      key={m.id}
                      className="w-full text-left px-3 py-2 hover:bg-accent flex justify-between"
                      onClick={() => { setMember(m); setPhoneQ(""); }}
                    >
                      <span>{m.name}</span>
                      <span className="text-muted-foreground text-xs">{m.points} แต้ม</span>
                    </button>
                  ))}
                  {memberSearch.data?.length === 0 && (
                    <div className="px-3 py-2 text-muted-foreground flex items-center gap-1">
                      <UserPlus className="w-3.5 h-3.5" /> ไม่พบ — สมัครได้ที่หน้าสมาชิก
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* รายการ */}
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {cart.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">แตะสินค้าเพื่อเพิ่มลงรายการ</p>
            )}
            {cart.map((l) => (
              <div key={l.product.id} className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{l.product.name}</div>
                  <div className="text-xs text-muted-foreground">฿{fmtMoney(l.product.price)}/{l.product.unit}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(l.product.id, l.qty - (l.product.category === "fuel" ? 1 : 1))}>
                    <Minus className="w-3 h-3" />
                  </Button>
                  <span className="w-14 text-center text-xs font-medium">{fmtNum(l.qty)} {l.product.unit}</span>
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(l.product.id, l.qty + 1)}>
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
                <div className="w-20 text-right font-medium">฿{fmtMoney(l.qty * l.product.price)}</div>
                <button onClick={() => setCart((c) => c.filter((x) => x.product.id !== l.product.id))}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </button>
              </div>
            ))}
          </div>

          <Separator />

          {/* ส่วนลด/แต้ม */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">รวม</span>
              <span>฿{fmtMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between items-center gap-2">
              <span className="text-muted-foreground flex items-center gap-1"><BadgePercent className="w-3.5 h-3.5" />ส่วนลด (บาท)</span>
              <Input
                type="number" min={0} value={discount || ""} placeholder="0"
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                className="h-8 w-24 text-right"
              />
            </div>
            {member && member.points > 0 && (
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground flex items-center gap-1"><Star className="w-3.5 h-3.5" />ใช้แต้ม (มี {member.points})</span>
                <Input
                  type="number" min={0} max={member.points} value={pointsToRedeem || ""} placeholder="0"
                  onChange={(e) => setPointsToRedeem(Math.min(member.points, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
                  className="h-8 w-24 text-right"
                />
              </div>
            )}
            <div className="flex justify-between font-heading text-lg font-semibold text-primary">
              <span>ยอดชำระ</span>
              <span>฿{fmtMoney(total)}</span>
            </div>
          </div>

          {/* ชำระเงิน */}
          <div className="grid grid-cols-4 gap-2">
            {(["cash", "qr", "card", "credit"] as const).map((m) => (
              <Button
                key={m}
                variant={payMethod === m ? "default" : "outline"}
                size="sm"
                onClick={() => setPayMethod(m)}
              >
                {paymentLabel[m]}
              </Button>
            ))}
          </div>
          {payMethod === "credit" && (
            <div className="space-y-2 text-sm">
              {creditCustomer ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{creditCustomer.name}</span>
                    <button onClick={() => setCreditCustomer(null)}>
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ค้างชำระ ฿{fmtMoney(creditDetail?.outstanding ?? 0)}
                    {creditCustomer.creditLimit > 0 && ` / วงเงิน ฿${fmtMoney(creditCustomer.creditLimit)}`}
                  </div>
                  {creditCustomer.creditLimit > 0 &&
                    (creditDetail?.outstanding ?? 0) + total > creditCustomer.creditLimit && (
                      <div className="text-xs text-destructive">ยอดรวมบิลนี้จะเกินวงเงินเครดิต</div>
                    )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Input
                    placeholder="ค้นหาลูกค้าเครดิต (ชื่อ/โทร/เลขผู้เสียภาษี)"
                    value={custQ}
                    onChange={(e) => setCustQ(e.target.value)}
                    className="h-9"
                  />
                  {custQ.trim().length >= 2 && (
                    <div className="border rounded-lg divide-y text-sm max-h-32 overflow-y-auto">
                      {(custResults ?? []).map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-3 py-2 hover:bg-accent"
                          onClick={() => { setCreditCustomer(c); setCustQ(""); }}
                        >
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {[c.phone, c.vehiclePlate].filter(Boolean).join(" · ") || "-"}
                          </div>
                        </button>
                      ))}
                      {custResults?.length === 0 && (
                        <div className="px-3 py-2 text-muted-foreground">ไม่พบลูกค้า</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {payMethod === "cash" && (
            <>
              <div className="flex gap-2">
                {[100, 500, 1000].map((v) => (
                  <Button key={v} variant="secondary" size="sm" className="flex-1" onClick={() => setReceived(String(v))}>
                    ฿{v}
                  </Button>
                ))}
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setReceived(String(Math.ceil(total)))}>
                  พอดี
                </Button>
              </div>
              <div className="flex justify-between items-center gap-2 text-sm">
                <span className="text-muted-foreground">รับเงิน</span>
                <Input
                  type="number" min={0} value={received} placeholder="0.00"
                  onChange={(e) => setReceived(e.target.value)}
                  className="h-9 w-32 text-right"
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">เงินทอน</span>
                <span className="font-semibold text-green-600">฿{fmtMoney(change)}</span>
              </div>
            </>
          )}

          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button
            className="w-full h-12 text-lg font-heading"
            disabled={cart.length === 0 || createSale.isPending}
            onClick={checkout}
          >
            {createSale.isPending ? "กำลังบันทึก..." : `ชำระเงิน ฿${fmtMoney(total)}`}
          </Button>
        </CardContent>
      </Card>

      {/* Dialog เติมน้ำมัน */}
      <Dialog open={!!fuelDialog} onOpenChange={(o) => !o && setFuelDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">{fuelDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Button variant={fuelMode === "baht" ? "default" : "outline"} onClick={() => setFuelMode("baht")}>ตามจำนวนเงิน</Button>
            <Button variant={fuelMode === "liters" ? "default" : "outline"} onClick={() => setFuelMode("liters")}>ตามลิตร</Button>
          </div>
          {fuelMode === "baht" && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[100, 200, 300, 500].map((v) => (
                <Button key={v} variant="secondary" size="sm" onClick={() => setFuelValue(String(v))}>฿{v}</Button>
              ))}
            </div>
          )}
          <Input
            type="number" min={0} step="0.01" autoFocus
            placeholder={fuelMode === "baht" ? "จำนวนเงิน (บาท)" : "จำนวนลิตร"}
            value={fuelValue}
            onChange={(e) => setFuelValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFuel()}
            className="text-lg h-12"
          />
          {fuelDialog && Number(fuelValue) > 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              {fuelMode === "baht"
                ? `= ${fmtNum(Number(fuelValue) / fuelDialog.price)} ลิตร`
                : `= ฿${fmtMoney(Number(fuelValue) * fuelDialog.price)}`}
            </p>
          )}
          <DialogFooter>
            <Button className="w-full" onClick={addFuel} disabled={!Number(fuelValue)}>เพิ่มลงรายการ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ใบเสร็จ */}
      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-w-sm">
          {receipt && (
            <div id="receipt-print">
              <ReceiptDoc
                sale={receipt.sale}
                items={receipt.items}
                settingMap={settingMap}
                staffName={staff?.name}
                logoUrl={logoUrl}
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const el = document.getElementById("receipt-print");
                if (el) printReceiptElement(el, parseReceiptPaper(settingMap?.receipt_paper_size));
              }}
            >
              <Printer className="w-4 h-4 mr-2" /> พิมพ์
            </Button>
            <Button variant="outline" onClick={() => receipt && setTaxSaleId(receipt.sale.id)}>
              <FileText className="w-4 h-4 mr-2" /> ใบกำกับภาษีเต็มรูป
            </Button>
            <Button onClick={() => setReceipt(null)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ใบกำกับภาษีเต็มรูป */}
      <TaxInvoiceDialog saleId={taxSaleId} onClose={() => setTaxSaleId(null)} />
    </div>
  );
}
