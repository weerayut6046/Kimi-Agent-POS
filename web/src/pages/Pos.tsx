import { useMemo, useState } from "react";
import {
  Fuel,
  Droplet,
  Minus,
  Plus,
  Trash2,
  UserPlus,
  X,
  Printer,
  BadgePercent,
  Star,
  FileText,
  Search,
  ShoppingBasket,
  Banknote,
  QrCode,
  CreditCard,
  BookOpenCheck,
  CircleAlert,
  Package,
  ArrowRight,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { useIsMobile } from "@/hooks/use-mobile";
import { TaxInvoiceDialog } from "@/components/TaxInvoiceDialog";
import { ReceiptDoc } from "@/components/ReceiptDoc";
import {
  printReceiptElement,
  parseReceiptPaper,
  printReceiptSilent,
} from "@/lib/printDoc";
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
  items: {
    name: string;
    qty: number;
    unit: string;
    unitPrice: number;
    amount: number;
  }[];
};

const paymentIcons = {
  cash: Banknote,
  qr: QrCode,
  card: CreditCard,
  credit: BookOpenCheck,
};

function productTone(code: string, category: string) {
  if (category !== "fuel") {
    return {
      bar: "bg-slate-400",
      icon: "bg-slate-100 text-slate-600",
      code: "bg-slate-100 text-slate-500",
    };
  }
  const normalized = code.toUpperCase();
  if (normalized.includes("D") || normalized.includes("B7")) {
    return {
      bar: "bg-blue-600",
      icon: "bg-blue-50 text-blue-700",
      code: "bg-blue-50 text-blue-700",
    };
  }
  if (normalized.includes("91")) {
    return {
      bar: "bg-emerald-500",
      icon: "bg-emerald-50 text-emerald-700",
      code: "bg-emerald-50 text-emerald-700",
    };
  }
  if (normalized.includes("95")) {
    return {
      bar: "bg-orange-500",
      icon: "bg-orange-50 text-orange-700",
      code: "bg-orange-50 text-orange-700",
    };
  }
  return {
    bar: "bg-violet-500",
    icon: "bg-violet-50 text-violet-700",
    code: "bg-violet-50 text-violet-700",
  };
}

export default function Pos() {
  const { staff } = useStaff();
  const mobileCheckout = useIsMobile(1024);
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
  const [payMethod, setPayMethod] = useState<"cash" | "qr" | "card" | "credit">(
    "cash"
  );
  const [received, setReceived] = useState("");
  const [creditCustomer, setCreditCustomer] = useState<Customer | null>(null);
  const [custQ, setCustQ] = useState("");
  const [fuelDialog, setFuelDialog] = useState<Product | null>(null);
  const [fuelMode, setFuelMode] = useState<"liters" | "baht">("baht");
  const [fuelValue, setFuelValue] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [taxSaleId, setTaxSaleId] = useState<number | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [err, setErr] = useState("");

  const pointValue = Number(settingMap?.point_redeem_value ?? "1");
  const activeProducts = useMemo(
    () => (products ?? []).filter(p => p.active && p.category === tab),
    [products, tab]
  );

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const redeemDiscount = pointsToRedeem * pointValue;
  const total = Math.max(0, subtotal - discount - redeemDiscount);
  const receivedNum = Number(received) || 0;
  const change = payMethod === "cash" ? Math.max(0, receivedNum - total) : 0;

  const addToCart = (p: Product, qty: number) => {
    setCart(c => {
      const i = c.findIndex(l => l.product.id === p.id);
      if (i >= 0) {
        const next = [...c];
        next[i] = {
          ...next[i],
          qty: Math.round((next[i].qty + qty) * 10000) / 10000,
        };
        return next;
      }
      return [...c, { product: p, qty }];
    });
  };

  const setQty = (id: number, qty: number) =>
    setCart(c =>
      c
        .map(l =>
          l.product.id === id
            ? { ...l, qty: Math.max(0, Math.round(qty * 100) / 100) }
            : l
        )
        .filter(l => l.qty > 0)
    );

  const addFuel = () => {
    if (!fuelDialog) return;
    const v = Number(fuelValue);
    if (!v || v <= 0) return;
    // โหมดเงิน: เก็บลิตรแบบไม่ปัด เพื่อให้ยอดเงินตรงกับที่กรอกพอดี (มิเตอร์หัวจ่ายจริงก็เที่ยงตรงที่ยอดเงิน)
    // โหมดลิตร: ผู้ใช้ระบุลิตรเอง ปัด 2 ตำแหน่งได้ ยอดเงินตามมาทีหลัง
    const liters =
      fuelMode === "liters" ? Math.round(v * 100) / 100 : v / fuelDialog.price;
    addToCart(fuelDialog, liters);
    setFuelDialog(null);
    setFuelValue("");
  };

  const createSale = trpc.pos.createSale.useMutation({
    onSuccess: r => {
      setReceipt({ sale: r.sale as ReceiptData["sale"], items: r.items });
      setCart([]);
      setMember(null);
      setDiscount(0);
      setPointsToRedeem(0);
      setReceived("");
      setCreditCustomer(null);
      setCustQ("");
      setMobileCartOpen(false);
      setErr("");
      // พิมพ์ใบเสร็จเงียบอัตโนมัติหลังชำระเงิน (desktop เท่านั้น — เปิดในหน้า Settings) รอ dialog render ก่อนค่อยดึง element
      if (
        settingMap?.receipt_silent_print === "1" &&
        window.posDesktop?.printSilent
      ) {
        const paper = parseReceiptPaper(settingMap.receipt_paper_size);
        setTimeout(() => {
          const el = document.getElementById("receipt-print");
          if (el) {
            printReceiptSilent(el, paper).catch(e =>
              setErr(
                e instanceof Error
                  ? e.message
                  : "พิมพ์ใบเสร็จอัตโนมัติไม่สำเร็จ"
              )
            );
          }
        }, 300);
      }
      utils.pos.dashboard.invalidate();
      utils.pos.salesHistory.invalidate();
      utils.catalog.listProducts.invalidate();
      utils.credit.summary.invalidate();
      if (member) utils.membership.listMembers.invalidate();
    },
    onError: e => setErr(e.message),
  });

  const memberSearch = trpc.membership.findByPhone.useQuery(
    { phone: phoneQ },
    { enabled: phoneQ.length >= 9 }
  );

  // ขายเชื่อ — ค้นหาลูกค้าเครดิต + ดึงยอดค้างของลูกค้าที่เลือก
  const { data: custResults } = trpc.customers.list.useQuery(
    { q: custQ, limit: 8 },
    {
      enabled:
        payMethod === "credit" && !creditCustomer && custQ.trim().length >= 2,
    }
  );
  const { data: creditDetail } = trpc.credit.detail.useQuery(
    { customerId: creditCustomer?.id ?? -1 },
    { enabled: payMethod === "credit" && creditCustomer != null }
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
      items: cart.map(l => ({ productId: l.product.id, qty: l.qty })),
      discount,
      paymentMethod: payMethod,
      received: receivedNum,
      pointsToRedeem,
    });
  };

  return (
    <div
      className={`grid grid-cols-1 gap-5 lg:grid-cols-5 xl:gap-6 ${cart.length > 0 ? "pb-20 lg:pb-0" : ""}`}
    >
      {/* แผงเลือกสินค้า */}
      <section className="space-y-4 lg:col-span-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="page-kicker">รายการขายใหม่</div>
            <h1 className="page-heading mt-1">ขายหน้าลาน</h1>
            <p className="mt-1 text-sm text-slate-500">
              เลือกชนิดน้ำมันหรือสินค้าเพื่อเริ่มทำรายการ
            </p>
          </div>
          {currentShift ? (
            <Badge className="h-9 gap-2 border border-emerald-200 bg-emerald-50 px-3 text-emerald-700 hover:bg-emerald-50">
              <span className="size-2 rounded-full bg-emerald-500" /> กะของ{" "}
              {currentShift.staffName}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="h-9 gap-2 border-amber-300 bg-amber-50 px-3 text-amber-700"
            >
              <CircleAlert className="size-4" /> ยังไม่ได้เปิดกะ
            </Badge>
          )}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid h-12 w-full grid-cols-3 rounded-xl bg-slate-200/70 p-1">
            <TabsTrigger value="fuel" className="h-full gap-2">
              <Fuel className="size-4" /> น้ำมัน
            </TabsTrigger>
            <TabsTrigger
              value="lubricant"
              className="h-full min-w-0 gap-1 px-1 sm:gap-2 sm:px-2"
            >
              <Droplet className="size-4" />{" "}
              <span className="sm:hidden">น้ำมันเครื่อง</span>
              <span className="hidden sm:inline">2T / น้ำมันเครื่อง</span>
            </TabsTrigger>
            <TabsTrigger
              value="other"
              className="h-full min-w-0 gap-1 px-1 sm:gap-2 sm:px-2"
            >
              <Package className="size-4" /> สินค้าอื่น
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
          {activeProducts.map(p => {
            const tone = productTone(p.code, p.category);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (p.category === "fuel") {
                    setFuelDialog(p);
                    setFuelMode("baht");
                    setFuelValue("");
                  } else {
                    addToCart(p, 1);
                  }
                }}
                className="group relative min-h-[126px] overflow-hidden rounded-xl border border-slate-200 bg-white p-3 text-left shadow-[0_3px_14px_rgba(15,23,42,0.045)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_10px_26px_rgba(37,99,235,0.12)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 active:translate-y-0 sm:min-h-[142px] sm:p-4"
              >
                <span className={`absolute inset-x-0 top-0 h-1 ${tone.bar}`} />
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div
                    className={`grid size-9 place-items-center rounded-lg ${tone.icon}`}
                  >
                    {p.category === "fuel" ? (
                      <Fuel className="size-[18px]" />
                    ) : (
                      <Package className="size-[18px]" />
                    )}
                  </div>
                  <span
                    className={`rounded-md px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide ${tone.code}`}
                  >
                    {p.code}
                  </span>
                </div>
                <div className="min-h-10 text-sm font-semibold leading-snug text-slate-800">
                  {p.name}
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div className="font-heading text-lg font-bold text-slate-900 number-display">
                    ฿{fmtMoney(p.price)}
                    <span className="ml-0.5 text-[11px] font-normal text-slate-400">
                      /{p.unit}
                    </span>
                  </div>
                  {p.category !== "fuel" && (
                    <span className="text-[10px] text-slate-400">
                      เหลือ {fmtNum(p.stockQty)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {activeProducts.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white/60 py-14 text-center">
              <Package className="mx-auto size-8 text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-500">
                ยังไม่มีสินค้าในหมวดนี้
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ตะกร้า */}
      {(() => {
        const cartPanel = (
          <Card className="h-fit gap-0 overflow-hidden border-slate-200 py-0 lg:sticky lg:top-[92px] lg:col-span-2">
            <CardHeader className="border-b border-slate-200 bg-slate-50/80 px-4 py-4 pr-14 sm:px-5 lg:pr-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-[#0b2854] text-white">
                    <ShoppingBasket className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="font-heading text-base">
                      รายการขาย
                    </CardTitle>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {cart.length
                        ? `${cart.length} รายการในบิล`
                        : "รอเลือกสินค้า"}
                    </p>
                  </div>
                </div>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCart([]);
                      setMobileCartOpen(false);
                    }}
                    className="text-xs font-medium text-slate-400 hover:text-red-600"
                  >
                    ล้างรายการ
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-4 py-4 sm:px-5">
              {/* สมาชิก */}
              {member ? (
                <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
                  <div className="flex items-center gap-2.5 text-sm">
                    <div className="grid size-8 place-items-center rounded-lg bg-blue-600 text-white">
                      <Star className="size-4 fill-white/20" />
                    </div>
                    <div>
                      <div className="font-semibold text-blue-950">
                        {member.name}
                      </div>
                      <div className="text-xs text-blue-700/70">
                        สมาชิก · {member.points} แต้ม
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="ยกเลิกสมาชิก"
                    onClick={() => {
                      setMember(null);
                      setPointsToRedeem(0);
                    }}
                    className="grid size-8 place-items-center rounded-lg text-blue-500 hover:bg-blue-100"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="ค้นหาสมาชิกด้วยเบอร์โทร"
                      value={phoneQ}
                      onChange={e => setPhoneQ(e.target.value)}
                      inputMode="tel"
                      aria-label="ค้นหาสมาชิกด้วยเบอร์โทร"
                      className="h-11 pl-9"
                    />
                  </div>
                  {phoneQ.length >= 9 && (
                    <div className="max-h-32 overflow-y-auto rounded-lg border bg-white text-sm shadow-lg">
                      {(memberSearch.data ?? []).map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className="flex w-full justify-between border-b px-3 py-2.5 text-left last:border-0 hover:bg-blue-50"
                          onClick={() => {
                            setMember(m);
                            setPhoneQ("");
                          }}
                        >
                          <span>{m.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {m.points} แต้ม
                          </span>
                        </button>
                      ))}
                      {memberSearch.data?.length === 0 && (
                        <div className="px-3 py-2 text-muted-foreground flex items-center gap-1">
                          <UserPlus className="w-3.5 h-3.5" /> ไม่พบ —
                          สมัครได้ที่หน้าสมาชิก
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Separator className="bg-slate-200" />

              {/* รายการ */}
              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {cart.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 py-8 text-center">
                    <ShoppingBasket className="mx-auto size-8 text-slate-300" />
                    <p className="mt-2 text-sm font-medium text-slate-500">
                      ยังไม่มีสินค้าในบิล
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      แตะรายการทางซ้ายเพื่อเพิ่มสินค้า
                    </p>
                  </div>
                )}
                {cart.map(l => (
                  <div
                    key={l.product.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-800">
                          {l.product.name}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          ฿{fmtMoney(l.product.price)} / {l.product.unit}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`ลบ ${l.product.name}`}
                        onClick={() =>
                          setCart(c =>
                            c.filter(x => x.product.id !== l.product.id)
                          )
                        }
                        className="grid size-7 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                        <button
                          type="button"
                          aria-label="ลดจำนวน"
                          className="grid size-8 place-items-center text-slate-500 hover:bg-white hover:text-blue-700"
                          onClick={() => setQty(l.product.id, l.qty - 1)}
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="min-w-[74px] border-x border-slate-200 px-2 text-center text-xs font-semibold number-display">
                          {fmtNum(l.qty)} {l.product.unit}
                        </span>
                        <button
                          type="button"
                          aria-label="เพิ่มจำนวน"
                          className="grid size-8 place-items-center text-slate-500 hover:bg-white hover:text-blue-700"
                          onClick={() => setQty(l.product.id, l.qty + 1)}
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <div className="font-heading font-bold text-slate-900 number-display">
                        ฿{fmtMoney(l.qty * l.product.price)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Separator className="bg-slate-200" />

              {/* ส่วนลด/แต้ม */}
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">ยอดรวมสินค้า</span>
                  <span className="font-medium number-display">
                    ฿{fmtMoney(subtotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <BadgePercent className="size-3.5" />
                    ส่วนลด
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={discount || ""}
                    placeholder="0"
                    onChange={e =>
                      setDiscount(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="h-9 w-24 text-right"
                  />
                </div>
                {member && member.points > 0 && (
                  <div className="flex justify-between items-center gap-2">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Star className="size-3.5" />
                      ใช้แต้ม (มี {member.points})
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={member.points}
                      value={pointsToRedeem || ""}
                      placeholder="0"
                      onChange={e =>
                        setPointsToRedeem(
                          Math.min(
                            member.points,
                            Math.max(0, Math.floor(Number(e.target.value) || 0))
                          )
                        )
                      }
                      className="h-9 w-24 text-right"
                    />
                  </div>
                )}
                <div className="mt-3 flex items-end justify-between rounded-xl bg-[#0b2854] px-4 py-3.5 text-white shadow-lg shadow-blue-950/10">
                  <div>
                    <div className="text-xs font-medium text-blue-200">
                      ยอดสุทธิ
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/45">
                      รวมภาษีและส่วนลดแล้ว
                    </div>
                  </div>
                  <span className="font-heading text-2xl font-bold number-display">
                    ฿{fmtMoney(total)}
                  </span>
                </div>
              </div>

              {/* ชำระเงิน */}
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-500">
                  ช่องทางชำระเงิน
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(["cash", "qr", "card", "credit"] as const).map(m => {
                    const PaymentIcon = paymentIcons[m];
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPayMethod(m)}
                        className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl border text-xs font-semibold transition-all ${payMethod === m ? "border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-600/20" : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"}`}
                      >
                        <PaymentIcon className="size-[18px]" />
                        {paymentLabel[m]}
                      </button>
                    );
                  })}
                </div>
              </div>
              {payMethod === "credit" && (
                <div className="space-y-2 text-sm">
                  {creditCustomer ? (
                    <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-950">
                          {creditCustomer.name}
                        </span>
                        <button
                          type="button"
                          aria-label="ยกเลิกลูกค้าเครดิต"
                          onClick={() => setCreditCustomer(null)}
                          className="grid size-7 place-items-center rounded-md hover:bg-amber-100"
                        >
                          <X className="size-4 text-amber-700" />
                        </button>
                      </div>
                      <div className="text-xs text-amber-800/70">
                        ค้างชำระ ฿{fmtMoney(creditDetail?.outstanding ?? 0)}
                        {creditCustomer.creditLimit > 0 &&
                          ` / วงเงิน ฿${fmtMoney(creditCustomer.creditLimit)}`}
                      </div>
                      {creditCustomer.creditLimit > 0 &&
                        (creditDetail?.outstanding ?? 0) + total >
                          creditCustomer.creditLimit && (
                          <div className="text-xs text-destructive">
                            ยอดรวมบิลนี้จะเกินวงเงินเครดิต
                          </div>
                        )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          placeholder="ค้นหาชื่อ โทร หรือเลขผู้เสียภาษี"
                          value={custQ}
                          onChange={e => setCustQ(e.target.value)}
                          className="h-11 pl-9"
                        />
                      </div>
                      {custQ.trim().length >= 2 && (
                        <div className="max-h-32 overflow-y-auto rounded-lg border bg-white text-sm shadow-lg">
                          {(custResults ?? []).map(c => (
                            <button
                              key={c.id}
                              type="button"
                              className="w-full border-b px-3 py-2.5 text-left last:border-0 hover:bg-blue-50"
                              onClick={() => {
                                setCreditCustomer(c);
                                setCustQ("");
                              }}
                            >
                              <div className="font-medium">{c.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {[c.phone, c.vehiclePlate]
                                  .filter(Boolean)
                                  .join(" · ") || "-"}
                              </div>
                            </button>
                          ))}
                          {custResults?.length === 0 && (
                            <div className="px-3 py-2 text-muted-foreground">
                              ไม่พบลูกค้า
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {payMethod === "cash" && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="grid grid-cols-4 gap-2">
                    {[100, 500, 1000].map(v => (
                      <Button
                        key={v}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="bg-white px-2 number-display"
                        onClick={() => setReceived(String(v))}
                      >
                        ฿{v}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="bg-white px-2"
                      onClick={() => setReceived(String(Math.ceil(total)))}
                    >
                      พอดี
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <label
                      htmlFor="received-cash"
                      className="font-medium text-slate-600"
                    >
                      รับเงิน
                    </label>
                    <Input
                      id="received-cash"
                      type="number"
                      min={0}
                      value={received}
                      placeholder="0.00"
                      onChange={e => setReceived(e.target.value)}
                      className="h-11 w-36 bg-white text-right text-lg font-bold number-display"
                    />
                  </div>
                  <div className="flex items-end justify-between border-t border-slate-200 pt-2.5 text-sm">
                    <span className="text-slate-500">เงินทอน</span>
                    <span className="font-heading text-xl font-bold text-emerald-600 number-display">
                      ฿{fmtMoney(change)}
                    </span>
                  </div>
                </div>
              )}

              {err && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" /> {err}
                </div>
              )}
              <Button
                className="h-14 w-full justify-between rounded-xl bg-gradient-to-r from-blue-700 to-blue-600 px-5 text-base font-heading shadow-lg shadow-blue-600/20 hover:from-blue-800 hover:to-blue-700"
                disabled={cart.length === 0 || createSale.isPending}
                onClick={checkout}
              >
                <span>
                  {createSale.isPending
                    ? "กำลังบันทึก..."
                    : "ยืนยันการชำระเงิน"}
                </span>
                <span className="flex items-center gap-2 number-display">
                  ฿{fmtMoney(total)} <ArrowRight className="size-4" />
                </span>
              </Button>
            </CardContent>
          </Card>
        );

        if (!mobileCheckout) return cartPanel;

        return (
          <>
            <Sheet open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
              <SheetContent
                side="bottom"
                className="max-h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] gap-0 overflow-y-auto rounded-t-2xl border-0 bg-transparent p-0 pb-[env(safe-area-inset-bottom)]"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>รายการขายและชำระเงิน</SheetTitle>
                </SheetHeader>
                {cartPanel}
              </SheetContent>
            </Sheet>
            {cart.length > 0 && !mobileCartOpen && (
              <Button
                type="button"
                onClick={() => setMobileCartOpen(true)}
                className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-3 right-3 z-20 h-14 justify-between rounded-2xl bg-[#0b2854] px-4 text-white shadow-[0_14px_36px_rgba(11,40,84,0.32)] hover:bg-[#123867] lg:hidden"
                aria-label={`เปิดตะกร้า ${cart.length} รายการ ยอดรวม ${fmtMoney(total)} บาท`}
              >
                <span className="flex items-center gap-2">
                  <span className="relative grid size-9 place-items-center rounded-xl bg-white/10">
                    <ShoppingBasket className="size-5" />
                    <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-orange-500 px-1 text-[10px] leading-4 text-white">
                      {cart.length}
                    </span>
                  </span>
                  ดูรายการขาย
                </span>
                <span className="flex items-center gap-2 font-heading text-base number-display">
                  ฿{fmtMoney(total)} <ArrowRight className="size-4" />
                </span>
              </Button>
            )}
          </>
        );
      })()}

      {/* Dialog เติมน้ำมัน */}
      <Dialog open={!!fuelDialog} onOpenChange={o => !o && setFuelDialog(null)}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          <DialogHeader>
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-blue-600 text-white">
                  <Fuel className="size-5" />
                </div>
                <div>
                  <DialogTitle className="font-heading text-lg">
                    {fuelDialog?.name}
                  </DialogTitle>
                  <p className="mt-0.5 text-xs text-slate-500">
                    ราคา ฿{fmtMoney(fuelDialog?.price ?? 0)} ต่อลิตร
                  </p>
                </div>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                className={`h-11 rounded-lg text-sm font-semibold transition-all ${fuelMode === "baht" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
                onClick={() => setFuelMode("baht")}
              >
                ระบุจำนวนเงิน
              </button>
              <button
                type="button"
                className={`h-11 rounded-lg text-sm font-semibold transition-all ${fuelMode === "liters" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
                onClick={() => setFuelMode("liters")}
              >
                ระบุจำนวนลิตร
              </button>
            </div>
            {fuelMode === "baht" && (
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-500">
                  ยอดด่วน
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[100, 200, 300, 500].map(v => (
                    <Button
                      key={v}
                      type="button"
                      variant="outline"
                      className="h-11 bg-white number-display"
                      onClick={() => setFuelValue(String(v))}
                    >
                      ฿{v}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label
                htmlFor="fuel-value"
                className="mb-2 block text-xs font-semibold text-slate-500"
              >
                {fuelMode === "baht" ? "จำนวนเงิน (บาท)" : "ปริมาณ (ลิตร)"}
              </label>
              <Input
                id="fuel-value"
                type="number"
                min={0}
                step="0.01"
                autoFocus
                placeholder="0.00"
                value={fuelValue}
                onChange={e => setFuelValue(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addFuel()}
                className="h-16 text-right text-3xl font-bold number-display"
              />
            </div>
            <div className="flex min-h-12 items-center justify-between rounded-xl bg-blue-50 px-4 py-3 text-sm">
              <span className="text-blue-700">คำนวณได้</span>
              <span className="font-heading text-lg font-bold text-blue-900 number-display">
                {fuelDialog && Number(fuelValue) > 0
                  ? fuelMode === "baht"
                    ? `${fmtNum(Number(fuelValue) / fuelDialog.price)} ลิตร`
                    : `฿${fmtMoney(Number(fuelValue) * fuelDialog.price)}`
                  : "—"}
              </span>
            </div>
            <DialogFooter>
              <Button
                className="h-12 w-full rounded-xl"
                onClick={addFuel}
                disabled={!Number(fuelValue)}
              >
                เพิ่มลงรายการ <ArrowRight className="size-4" />
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ใบเสร็จ */}
      <Dialog open={!!receipt} onOpenChange={o => !o && setReceipt(null)}>
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
                if (el)
                  printReceiptElement(
                    el,
                    parseReceiptPaper(settingMap?.receipt_paper_size)
                  );
              }}
            >
              <Printer className="w-4 h-4 mr-2" /> พิมพ์
            </Button>
            <Button
              variant="outline"
              onClick={() => receipt && setTaxSaleId(receipt.sale.id)}
            >
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
