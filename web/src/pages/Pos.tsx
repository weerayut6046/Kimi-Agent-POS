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
  Sparkles,
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
import { currentSupabaseAccessToken } from "@/lib/supabase";
import { useStaff } from "@/hooks/useStaff";
import { useDesktopSync } from "@/hooks/useDesktopSync";
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
import type {
  DesktopReceipt,
  DesktopSaleInput,
  DesktopSaleResult,
} from "@contracts/offline";

type CartLine = { product: Product; qty: number };

type ReceiptData = DesktopReceipt;

const paymentIcons = {
  cash: Banknote,
  qr: QrCode,
  card: CreditCard,
  credit: BookOpenCheck,
};

function productTone(code: string, category: string) {
  if (category !== "fuel") {
    return {
      bar: "bg-gradient-to-r from-slate-400 to-slate-600",
      icon: "bg-slate-100 text-slate-600",
      code: "bg-slate-100 text-slate-500",
      wash: "from-slate-100/80 via-white/80 to-white/70",
    };
  }
  const normalized = code.toUpperCase();
  if (normalized.includes("D") || normalized.includes("B7")) {
    return {
      bar: "bg-gradient-to-r from-blue-500 to-indigo-600",
      icon: "bg-blue-50 text-blue-700",
      code: "bg-blue-50 text-blue-700",
      wash: "from-blue-100/75 via-white/80 to-white/70",
    };
  }
  if (normalized.includes("91")) {
    return {
      bar: "bg-gradient-to-r from-emerald-400 to-teal-600",
      icon: "bg-emerald-50 text-emerald-700",
      code: "bg-emerald-50 text-emerald-700",
      wash: "from-emerald-100/70 via-white/80 to-white/70",
    };
  }
  if (normalized.includes("95")) {
    return {
      bar: "bg-gradient-to-r from-orange-400 to-rose-500",
      icon: "bg-orange-50 text-orange-700",
      code: "bg-orange-50 text-orange-700",
      wash: "from-orange-100/75 via-white/80 to-white/70",
    };
  }
  return {
    bar: "bg-gradient-to-r from-violet-500 to-fuchsia-500",
    icon: "bg-violet-50 text-violet-700",
    code: "bg-violet-50 text-violet-700",
    wash: "from-violet-100/75 via-white/80 to-white/70",
  };
}

export default function Pos() {
  const { staff } = useStaff();
  const { status: syncStatus } = useDesktopSync();
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
  const [desktopSalePending, setDesktopSalePending] = useState(false);

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

  const finishSale = (result: DesktopReceipt) => {
    setReceipt(result);
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
              e instanceof Error ? e.message : "พิมพ์ใบเสร็จอัตโนมัติไม่สำเร็จ"
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
  };

  const createSale = trpc.pos.createSale.useMutation({
    onSuccess: r =>
      finishSale({
        sale: r.sale as ReceiptData["sale"],
        items: r.items,
      }),
    onError: e => setErr(e.message),
  });
  const salePending = createSale.isPending || desktopSalePending;

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

  const checkout = async () => {
    if (cart.length === 0) return;
    if (payMethod === "cash" && receivedNum < total) {
      setErr("จำนวนเงินรับไม่พอ");
      return;
    }
    if (payMethod === "credit" && !creditCustomer) {
      setErr("ขายเชื่อต้องเลือกลูกค้าก่อนชำระ");
      return;
    }
    if (syncStatus?.online === false && payMethod === "credit") {
      setErr("ขณะออฟไลน์ยังไม่รองรับการขายเชื่อ กรุณาเลือกเงินสด QR หรือบัตร");
      return;
    }
    if (syncStatus?.online === false && pointsToRedeem > 0) {
      setErr("ขณะออฟไลน์ยังไม่รองรับการใช้แต้ม กรุณาตั้งค่าแต้มที่ใช้เป็น 0");
      return;
    }

    const input: DesktopSaleInput = {
      shiftId: currentShift?.id,
      staffName: staff?.name ?? "",
      memberId: member?.id,
      customerId: payMethod === "credit" ? creditCustomer?.id : undefined,
      items: cart.map(l => ({ productId: l.product.id, qty: l.qty })),
      discount,
      paymentMethod: payMethod,
      received: receivedNum,
      pointsToRedeem,
    };

    if (!window.posDesktop) {
      createSale.mutate(input);
      return;
    }

    setDesktopSalePending(true);
    setErr("");
    try {
      const result: DesktopSaleResult = await window.posDesktop.createSale({
        input,
        lines: cart.map(line => ({
          productId: line.product.id,
          name: line.product.name,
          unit: line.product.unit,
          unitPrice: line.product.price,
          category: line.product.category,
          qty: line.qty,
        })),
        context: {
          vatRate: Number(settingMap?.vat_rate ?? "7"),
          pointEarnPerBaht: Number(settingMap?.point_earn_per_baht ?? "25"),
          pointRedeemValue: pointValue,
          memberName: member?.name ?? null,
          customerName: creditCustomer?.name ?? null,
        },
        staffToken: (await currentSupabaseAccessToken()) ?? undefined,
      });
      finishSale(result);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "บันทึกการขายไม่สำเร็จ");
    } finally {
      setDesktopSalePending(false);
    }
  };

  return (
    <div
      className={`grid grid-cols-1 gap-5 lg:grid-cols-5 xl:gap-6 ${cart.length > 0 ? "pb-24 lg:pb-0" : ""}`}
    >
      {/* แผงเลือกสินค้า */}
      <section className="space-y-4 lg:col-span-3">
        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#151333] via-[#211d59] to-[#124254] p-5 text-white shadow-[0_22px_54px_rgba(31,25,84,0.22)] ring-1 ring-white/10 sm:p-6">
          <div className="surface-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="ambient-float pointer-events-none absolute -right-14 -top-20 size-56 rounded-full bg-violet-500/25 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/80 backdrop-blur-sm">
                <Sparkles className="size-3" /> New transaction
              </div>
              <h1 className="mt-3 font-heading text-2xl font-extrabold tracking-[-0.04em] sm:text-3xl">
                จุดขายอัจฉริยะ
              </h1>
              <p className="mt-1.5 text-sm text-white/50">
                แตะสินค้า ระบุจำนวน และชำระเงินได้ใน flow เดียว
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden rounded-2xl border border-white/10 bg-white/[0.065] px-4 py-2.5 text-right backdrop-blur-sm sm:block">
                <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">
                  พร้อมขาย
                </div>
                <div className="mt-0.5 text-sm font-bold text-cyan-200 number-display">
                  {activeProducts.length} รายการ
                </div>
              </div>
              {currentShift ? (
                <Badge className="h-10 gap-2 border border-cyan-300/20 bg-cyan-300/10 px-3 text-cyan-100 hover:bg-cyan-300/15">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-300 opacity-50" />
                    <span className="relative size-2 rounded-full bg-cyan-300" />
                  </span>
                  กะของ {currentShift.staffName}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="h-10 gap-2 border-orange-300/25 bg-orange-300/10 px-3 text-orange-100"
                >
                  <CircleAlert className="size-4" /> ยังไม่ได้เปิดกะ
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid h-14 w-full grid-cols-3 rounded-2xl bg-white/70 p-1.5 shadow-[0_12px_30px_rgba(41,34,98,0.08)] ring-1 ring-slate-200/60 backdrop-blur-xl">
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
                className="spotlight-card group relative min-h-[142px] overflow-hidden rounded-[20px] border border-white/90 bg-white/80 p-3 text-left shadow-[0_10px_30px_rgba(39,33,88,0.07)] ring-1 ring-slate-200/60 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.015] hover:border-violet-200 hover:shadow-[0_20px_46px_rgba(75,57,170,0.16)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-500/20 active:translate-y-0 active:scale-[0.99] sm:min-h-[156px] sm:p-4"
              >
                <span
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70 ${tone.wash}`}
                />
                <span
                  className={`absolute inset-x-0 top-0 h-1.5 ${tone.bar}`}
                />
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div
                    className={`relative grid size-10 place-items-center rounded-xl shadow-inner ring-1 ring-white transition-all duration-300 group-hover:-rotate-6 group-hover:scale-110 ${tone.icon}`}
                  >
                    {p.category === "fuel" ? (
                      <Fuel className="size-[18px]" />
                    ) : (
                      <Package className="size-[18px]" />
                    )}
                  </div>
                  <span
                    className={`relative rounded-lg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide ring-1 ring-black/[0.03] ${tone.code}`}
                  >
                    {p.code}
                  </span>
                </div>
                <div className="relative min-h-10 text-sm font-semibold leading-snug text-slate-800">
                  {p.name}
                </div>
                <div className="relative mt-2 flex items-end justify-between gap-2">
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
                  {p.category === "fuel" && (
                    <span className="grid size-7 place-items-center rounded-full bg-white/80 text-violet-500 opacity-0 shadow-sm ring-1 ring-violet-100 transition-all duration-300 group-hover:opacity-100">
                      <ArrowRight className="size-3.5" />
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
          <Card className="h-fit gap-0 overflow-hidden border-white/90 py-0 shadow-[0_22px_58px_rgba(38,30,90,0.13)] lg:sticky lg:top-[108px] lg:col-span-2">
            <CardHeader className="relative overflow-hidden border-b border-white/10 bg-gradient-to-br from-[#17143a] via-[#272162] to-[#154457] px-4 py-5 pr-14 text-white sm:px-5 lg:pr-5">
              <div className="surface-grid pointer-events-none absolute inset-0 opacity-50" />
              <div className="relative flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 text-white shadow-lg shadow-violet-950/25 ring-1 ring-white/20">
                    <ShoppingBasket className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="font-heading text-base text-white">
                      รายการขาย
                    </CardTitle>
                    <p className="mt-0.5 text-xs text-white/45">
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
                    className="text-xs font-medium text-white/45 transition-colors hover:text-rose-300"
                  >
                    ล้างรายการ
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 bg-white/60 px-4 py-4 sm:px-5">
              {/* สมาชิก */}
              {member ? (
                <div className="flex items-center justify-between rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-cyan-50 px-3 py-2.5">
                  <div className="flex items-center gap-2.5 text-sm">
                    <div className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 text-white shadow-md shadow-violet-500/20">
                      <Star className="size-4 fill-white/20" />
                    </div>
                    <div>
                      <div className="font-semibold text-violet-950">
                        {member.name}
                      </div>
                      <div className="text-xs text-violet-700/70">
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
                    className="grid size-8 place-items-center rounded-lg text-violet-500 hover:bg-violet-100"
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
                    className="rounded-2xl border border-white bg-gradient-to-br from-white to-violet-50/35 p-3 text-sm shadow-sm ring-1 ring-slate-200/70 transition-all hover:border-violet-200 hover:shadow-md"
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
                          className="grid size-8 place-items-center text-slate-500 hover:bg-white hover:text-violet-700"
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
                          className="grid size-8 place-items-center text-slate-500 hover:bg-white hover:text-violet-700"
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
                      disabled={syncStatus?.online === false}
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
                <div className="mt-3 flex items-end justify-between rounded-2xl bg-gradient-to-br from-[#181540] via-[#292269] to-[#145064] px-4 py-4 text-white shadow-[0_16px_34px_rgba(36,29,91,0.22)] ring-1 ring-white/10">
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
                    const disabled =
                      m === "credit" && syncStatus?.online === false;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={disabled}
                        onClick={() => setPayMethod(m)}
                        title={
                          disabled
                            ? "ขายเชื่อต้องเชื่อมต่ออินเทอร์เน็ต"
                            : undefined
                        }
                        className={`flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300 ${payMethod === m ? "-translate-y-0.5 border-violet-500 bg-gradient-to-br from-violet-500 to-indigo-700 text-white shadow-lg shadow-violet-500/25" : "border-slate-200 bg-white/80 text-slate-500 hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 hover:shadow-md"}`}
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
                className="shine-button h-14 w-full justify-between rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 px-5 text-base font-heading shadow-[0_16px_34px_rgba(88,70,220,0.28)] hover:from-violet-500 hover:via-indigo-600 hover:to-cyan-500"
                disabled={cart.length === 0 || salePending}
                onClick={() => void checkout()}
              >
                <span>
                  {salePending ? "กำลังบันทึก..." : "ยืนยันการชำระเงิน"}
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
                className="fixed bottom-[calc(86px+env(safe-area-inset-bottom))] left-3 right-3 z-20 h-14 justify-between rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 px-4 text-white shadow-[0_18px_42px_rgba(65,49,175,0.35)] hover:from-violet-500 hover:via-indigo-600 hover:to-cyan-500 lg:hidden"
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
            <div className="relative overflow-hidden border-b border-white/10 bg-gradient-to-br from-[#17143a] via-[#282263] to-[#15505d] px-6 py-5 text-white">
              <div className="surface-grid pointer-events-none absolute inset-0 opacity-50" />
              <div className="flex items-center gap-3">
                <div className="relative grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 text-white shadow-lg ring-1 ring-white/20">
                  <Fuel className="size-5" />
                </div>
                <div>
                  <DialogTitle className="relative font-heading text-lg text-white">
                    {fuelDialog?.name}
                  </DialogTitle>
                  <p className="relative mt-0.5 text-xs text-white/50">
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
                className={`h-11 rounded-xl text-sm font-semibold transition-all ${fuelMode === "baht" ? "bg-white text-violet-700 shadow-md" : "text-slate-500"}`}
                onClick={() => setFuelMode("baht")}
              >
                ระบุจำนวนเงิน
              </button>
              <button
                type="button"
                className={`h-11 rounded-xl text-sm font-semibold transition-all ${fuelMode === "liters" ? "bg-white text-violet-700 shadow-md" : "text-slate-500"}`}
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
            <div className="flex min-h-12 items-center justify-between rounded-2xl bg-gradient-to-r from-violet-50 to-cyan-50 px-4 py-3 text-sm ring-1 ring-violet-100/70">
              <span className="text-violet-700">คำนวณได้</span>
              <span className="font-heading text-lg font-bold text-violet-950 number-display">
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
            <>
              {receipt.sale.id < 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  บิลนี้เก็บไว้ในเครื่องและกำลังรอซิงก์ขึ้นคลาวด์
                </div>
              )}
              <div id="receipt-print">
                <ReceiptDoc
                  sale={receipt.sale}
                  items={receipt.items}
                  settingMap={settingMap}
                  staffName={staff?.name}
                  logoUrl={logoUrl}
                />
              </div>
            </>
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
              disabled={receipt?.sale.id == null || receipt.sale.id < 0}
              title={
                receipt?.sale.id != null && receipt.sale.id < 0
                  ? "ออกใบกำกับภาษีได้หลังจากบิลซิงก์แล้ว"
                  : undefined
              }
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
