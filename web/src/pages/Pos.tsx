import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
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
  Wallet,
  ScanBarcode,
  CloudDownload,
  Loader2,
  Globe2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ThungngernQrDialog,
  type ThungngernSession,
} from "@/components/ThungngernQrDialog";
import {
  printReceiptElement,
  parseReceiptPaper,
  printReceiptSilent,
} from "@/lib/printDoc";
import { fmtDateTH, fmtMoney, fmtNum, paymentLabel } from "@/lib/format";
import type { Product, Member, Customer } from "@db/schema";
import type {
  DesktopReceipt,
  DesktopSaleInput,
  DesktopSaleResult,
} from "@contracts/offline";
import {
  isScannableMemberCode,
  normalizeMemberCode,
} from "@contracts/memberCode";
import { isMemberCardExpired } from "@contracts/memberExpiry";
import {
  DEFAULT_SETTINGS,
  DEFAULT_POINT_EARN_PER_BAHT,
  DEFAULT_POINT_REDEEM_VALUE,
  positiveSettingNumber,
} from "@contracts/settings";
import {
  activeReceiptPromotion,
  appliedPromotionDiscount,
  type AppliedReceiptPromotion,
} from "@contracts/promotion";

type CartLine = { product: Product; qty: number };

type ReceiptData = DesktopReceipt;

type ExternalProductCandidate = {
  provider: "open_facts";
  providerLabel:
    | "Open Food Facts"
    | "Open Beauty Facts"
    | "Open Pet Food Facts"
    | "Open Products Facts";
  barcode: string;
  name: string;
  brand: string;
  quantity: string;
  productType: "food" | "beauty" | "petfood" | "product" | "unknown";
  imageUrl: string | null;
  sourceUrl: string;
};

type ExternalLookup = {
  barcode: string;
  product: ExternalProductCandidate | null;
};

type ExternalProductDraft = {
  name: string;
  category: "lubricant" | "other";
  unit: string;
  price: string;
  cost: string;
  stockQty: string;
  lowStockAt: string;
};

const paymentIcons = {
  cash: Banknote,
  qr: QrCode,
  card: CreditCard,
  credit: BookOpenCheck,
  thungngern: Wallet,
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

function releasePageFocus() {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) activeElement.blur();
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
  const [loyaltyChoice, setLoyaltyChoice] = useState<"earn" | "redeem" | null>(
    null
  );
  const [selectedPayMethod, setPayMethod] = useState<
    "cash" | "qr" | "card" | "credit" | "thungngern"
  >("cash");
  const [received, setReceived] = useState("");
  const [creditCustomer, setCreditCustomer] = useState<Customer | null>(null);
  const [custQ, setCustQ] = useState("");
  const [fuelDialog, setFuelDialog] = useState<Product | null>(null);
  const [fuelMode, setFuelMode] = useState<"liters" | "baht">("baht");
  const [fuelValue, setFuelValue] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptPromotion, setReceiptPromotion] =
    useState<AppliedReceiptPromotion | null>(null);
  const [taxSaleId, setTaxSaleId] = useState<number | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [err, setErr] = useState("");
  const [desktopSalePending, setDesktopSalePending] = useState(false);
  const [thungngernSession, setThungngernSession] =
    useState<ThungngernSession | null>(null);
  const [barcode, setBarcode] = useState("");
  const [barcodeLookupPending, setBarcodeLookupPending] = useState(false);
  const [externalLookup, setExternalLookup] = useState<ExternalLookup | null>(
    null
  );
  const [externalDraft, setExternalDraft] =
    useState<ExternalProductDraft | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const externalProductNameInputRef = useRef<HTMLInputElement>(null);
  const externalDialogCloseButtonRef = useRef<HTMLButtonElement>(null);
  const fuelValueInputRef = useRef<HTMLInputElement>(null);
  const barcodeLookupHandlerRef = useRef<(code: string) => void>(() => {});

  const { data: thungngernStatus } = trpc.payments.thungngernStatus.useQuery();

  // ใช้ค่าที่เปิดใช้งานจริงทันที โดยไม่ต้องแก้ state ซ้ำจากใน effect
  const enabledPayMethods = useMemo(
    () =>
      (["cash", "qr", "card", "credit", "thungngern"] as const).filter(
        method =>
          method === "thungngern" ||
          (settingMap?.[`pay_${method}_enabled`] ?? "1") !== "0"
      ),
    [settingMap]
  );
  const payMethod = enabledPayMethods.includes(selectedPayMethod)
    ? selectedPayMethod
    : (enabledPayMethods[0] ?? "cash");

  const pointEarnPerBaht = positiveSettingNumber(
    settingMap?.point_earn_per_baht,
    DEFAULT_POINT_EARN_PER_BAHT
  );
  const pointValue = positiveSettingNumber(
    settingMap?.point_redeem_value,
    DEFAULT_POINT_REDEEM_VALUE
  );
  const activeProducts = useMemo(
    () => (products ?? []).filter(p => p.active && p.category === tab),
    [products, tab]
  );
  const productById = useMemo(
    () => new Map((products ?? []).map(product => [product.id, product])),
    [products]
  );
  const sellableProductCount = activeProducts.filter(
    product => product.category === "fuel" || product.stockQty > 0
  ).length;
  const cartStockIssue = useMemo(() => {
    if (!products) return null;
    for (const line of cart) {
      const current = productById.get(line.product.id);
      if (!current || !current.active) {
        return `${line.product.name} ไม่พร้อมขายแล้ว กรุณานำออกจากบิล`;
      }
      if (current.category === "fuel") continue;
      if (current.stockQty <= 0) {
        return `${current.name} หมดแล้ว ไม่สามารถขายได้`;
      }
      if (line.qty > current.stockQty) {
        return `สต๊อก ${current.name} ไม่พอ (เหลือ ${fmtNum(current.stockQty)} ${current.unit})`;
      }
    }
    return null;
  }, [cart, productById, products]);

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const promotionFuelLiters = cart.reduce(
    (sum, line) => (line.product.category === "fuel" ? sum + line.qty : sum),
    0
  );
  const activePromotion = settingMap
    ? activeReceiptPromotion({ ...DEFAULT_SETTINGS, ...settingMap })
    : null;
  const promotionDiscount = appliedPromotionDiscount(
    activePromotion,
    promotionFuelLiters,
    subtotal,
    discount
  );
  const billDiscount = Math.round((discount + promotionDiscount) * 100) / 100;
  const memberCardExpired = member
    ? isMemberCardExpired(member.cardExpiresAt)
    : false;
  const maxRedeemablePoints =
    member && !memberCardExpired
      ? Math.min(
          member.points,
          Math.floor(Math.max(0, subtotal - billDiscount) / pointValue)
        )
      : 0;
  const redeemPoints = Math.min(pointsToRedeem, maxRedeemablePoints);
  if (redeemPoints !== pointsToRedeem) {
    setPointsToRedeem(redeemPoints);
  }
  const redeemDiscount = redeemPoints * pointValue;
  const total = Math.max(0, subtotal - billDiscount - redeemDiscount);
  const receivedNum = Number(received) || 0;
  const change = payMethod === "cash" ? Math.max(0, receivedNum - total) : 0;

  // QR พร้อมเพย์ทั่วไป — payload ล็อกยอดตามบิล (ไม่ผ่าน session ถุงเงิน)
  const qrAmount = Math.round(total * 100) / 100;
  const { data: promptpayQr } = trpc.payments.promptpayQr.useQuery(
    { amount: qrAmount },
    { enabled: payMethod === "qr" && qrAmount > 0 }
  );
  const promptpayPayload = payMethod === "qr" ? promptpayQr?.payload : null;
  const [promptpayQrImage, setPromptpayQrImage] = useState<{
    payload: string;
    url: string;
  } | null>(null);
  useEffect(() => {
    const payload = promptpayPayload;
    if (!payload) return;
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then(url => {
        if (!cancelled) setPromptpayQrImage({ payload, url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [promptpayPayload]);
  const promptpayQrUrl =
    promptpayQrImage && promptpayQrImage.payload === promptpayPayload
      ? promptpayQrImage.url
      : null;

  const addToCart = (p: Product, qty: number) => {
    const existingQty = cart.find(line => line.product.id === p.id)?.qty ?? 0;
    if (p.category !== "fuel") {
      if (p.stockQty <= 0) {
        setErr(`${p.name} หมดแล้ว ไม่สามารถขายได้`);
        return;
      }
      if (existingQty + qty > p.stockQty) {
        setErr(`สต๊อก ${p.name} ไม่พอ (เหลือ ${fmtNum(p.stockQty)} ${p.unit})`);
        return;
      }
    }
    setErr("");
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

  const importExternalProduct = trpc.catalog.importExternalProduct.useMutation({
    onSuccess: product => {
      utils.catalog.listProducts.setData(undefined, current =>
        current ? [...current, product] : [product]
      );
      setTab(product.category);
      addToCart(product, 1);
      setExternalLookup(null);
      setExternalDraft(null);
      setBarcode("");
      void utils.catalog.listProducts.invalidate();
    },
  });

  const lookupBarcode = async (rawBarcode: string) => {
    const code = rawBarcode.trim();
    if (code.length < 3 || barcodeLookupPending || externalLookup) return;
    if (!products) {
      setErr("กำลังโหลดข้อมูลสินค้า กรุณาลองยิงบาร์โค้ดอีกครั้ง");
      return;
    }

    const localProduct = products.find(
      product =>
        product.code.toLocaleUpperCase("en-US") ===
        code.toLocaleUpperCase("en-US")
    );
    if (localProduct) {
      if (!localProduct.active) {
        setErr(
          `${localProduct.name} ถูกปิดการขาย กรุณาให้ผู้ดูแลเปิดใช้งานสินค้า`
        );
        return;
      }
      setTab(localProduct.category);
      setBarcode("");
      if (localProduct.category === "fuel") {
        releasePageFocus();
        setFuelDialog(localProduct);
        setFuelMode("baht");
        setFuelValue("");
      } else {
        addToCart(localProduct, 1);
        setTimeout(() => barcodeInputRef.current?.focus(), 0);
      }
      return;
    }

    if (syncStatus?.online === false) {
      setErr("ไม่พบสินค้าในเครื่อง และต้องออนไลน์เพื่อค้นหาจากฐานภายนอก");
      return;
    }
    if (!/^\d{8,14}$/.test(code)) {
      setErr("บาร์โค้ดสำหรับค้นหาออนไลน์ต้องเป็นตัวเลข 8–14 หลัก");
      return;
    }

    setErr("");
    setBarcodeLookupPending(true);
    try {
      const product = await utils.catalog.searchExternalProduct.fetch({
        barcode: code,
      });
      setExternalDraft(
        product
          ? {
              name: product.name,
              category: "other",
              unit: "ชิ้น",
              price: "",
              cost: "",
              stockQty: "1",
              lowStockAt: "0",
            }
          : null
      );
      importExternalProduct.reset();
      releasePageFocus();
      setExternalLookup({ barcode: code, product });
    } catch (error) {
      setErr(
        error instanceof Error
          ? error.message
          : "ค้นหาสินค้าจากฐานภายนอกไม่สำเร็จ"
      );
    } finally {
      setBarcodeLookupPending(false);
    }
  };

  useEffect(() => {
    barcodeLookupHandlerRef.current = code => {
      void lookupBarcode(code);
    };
  });

  // เครื่องยิงบาร์โค้ดทั่วไปส่งตัวอักษรต่อกันอย่างรวดเร็วแล้วปิดท้ายด้วย Enter
  // จับจากทั้งหน้าเพื่อให้ยิงต่อได้แม้เพิ่งแตะการ์ดสินค้า โดยไม่แย่ง input อื่น
  useEffect(() => {
    let buffer = "";
    let lastKeyAt = 0;
    const handleScannerKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      const now = Date.now();
      if (event.key === "Enter") {
        if (buffer.length >= 3 && now - lastKeyAt <= 180) {
          event.preventDefault();
          const scanned = buffer;
          buffer = "";
          barcodeLookupHandlerRef.current(scanned);
        } else {
          buffer = "";
        }
        return;
      }

      if (!/^[0-9A-Za-z._-]$/.test(event.key)) return;
      buffer = now - lastKeyAt <= 100 ? `${buffer}${event.key}` : event.key;
      lastKeyAt = now;
    };

    window.addEventListener("keydown", handleScannerKey);
    return () => window.removeEventListener("keydown", handleScannerKey);
  }, []);

  const setQty = (id: number, qty: number) => {
    const product = productById.get(id);
    let nextQty = qty;
    if (product && product.category !== "fuel" && qty > product.stockQty) {
      nextQty = product.stockQty;
      setErr(
        product.stockQty <= 0
          ? `${product.name} หมดแล้ว ไม่สามารถขายได้`
          : `สต๊อก ${product.name} ไม่พอ (เหลือ ${fmtNum(product.stockQty)} ${product.unit})`
      );
    }
    setCart(c =>
      c
        .map(l =>
          l.product.id === id
            ? { ...l, qty: Math.max(0, Math.round(nextQty * 100) / 100) }
            : l
        )
        .filter(l => l.qty > 0)
    );
  };

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
    const soldLines = cart;
    utils.catalog.listProducts.setData(undefined, current =>
      current?.map(product => {
        if (product.category === "fuel") return product;
        const soldQty = soldLines.find(
          line => line.product.id === product.id
        )?.qty;
        if (!soldQty) return product;
        return {
          ...product,
          stockQty:
            Math.round(Math.max(0, product.stockQty - soldQty) * 1000) / 1000,
        };
      })
    );
    setReceiptPromotion(
      activePromotion && promotionDiscount > 0
        ? {
            ...activePromotion,
            liters: promotionFuelLiters,
            discount: promotionDiscount,
          }
        : null
    );
    setReceipt(result);
    setCart([]);
    setMember(null);
    setDiscount(0);
    setPointsToRedeem(0);
    setLoyaltyChoice(null);
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
    if (syncStatus?.online !== false) {
      utils.catalog.listProducts.invalidate();
    }
    utils.credit.summary.invalidate();
    if (member) utils.membership.listMembers.invalidate();
  };

  const createSale = trpc.pos.createSale.useMutation({
    onSuccess: r =>
      finishSale({
        sale: r.sale as ReceiptData["sale"],
        items: r.items,
      }),
    onError: e => {
      setErr(e.message);
      utils.catalog.listProducts.invalidate();
    },
  });
  const startThungngern = trpc.payments.startThungngern.useMutation({
    onSuccess: r => {
      setThungngernSession({
        sessionId: r.sessionId,
        refCode: r.refCode,
        payload: r.payload,
        amount: r.amount,
        expiresAt: r.expiresAt,
      });
    },
    onError: e => {
      setErr(e.message);
      utils.catalog.listProducts.invalidate();
    },
  });
  const salePending =
    createSale.isPending || desktopSalePending || startThungngern.isPending;

  const memberSearchReady = phoneQ.trim().length >= 3;
  const memberSearch = trpc.membership.findByPhone.useQuery(
    { phone: phoneQ },
    { enabled: memberSearchReady }
  );

  useEffect(() => {
    const scannedCode = normalizeMemberCode(phoneQ);
    if (!isScannableMemberCode(scannedCode)) return;
    const exactMember = memberSearch.data?.find(
      candidate => normalizeMemberCode(candidate.memberCode) === scannedCode
    );
    if (!exactMember) return;
    // ผลค้นหามาจากระบบภายนอกและต้องนำมาเป็นสถานะบิลปัจจุบัน
    /* eslint-disable react-hooks/set-state-in-effect */
    setMember(exactMember);
    setPointsToRedeem(0);
    setLoyaltyChoice(null);
    setPhoneQ("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [memberSearch.data, phoneQ]);

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
    if (member && !loyaltyChoice) {
      setErr("กรุณาถามลูกค้าและเลือกว่าจะสะสมแต้ม หรือใช้แต้มเป็นส่วนลด");
      return;
    }
    if (member && loyaltyChoice === "redeem" && redeemPoints === 0) {
      setErr("กรุณาระบุจำนวนแต้มที่ต้องการใช้เป็นส่วนลด");
      return;
    }
    if (memberCardExpired) {
      setErr("บัตรสมาชิกหมดอายุแล้ว กรุณานำสมาชิกออกจากบิลก่อนชำระเงิน");
      return;
    }
    if (cartStockIssue) {
      setErr(cartStockIssue);
      return;
    }
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
    if (syncStatus?.online === false && redeemPoints > 0) {
      setErr("ขณะออฟไลน์ยังไม่รองรับการใช้แต้ม กรุณาตั้งค่าแต้มที่ใช้เป็น 0");
      return;
    }

    // QR ถุงเงิน (ออนไลน์) — สร้าง session ล็อกยอดแล้วเปิด dialog รอยืนยัน
    if (payMethod === "thungngern" && syncStatus?.online !== false) {
      setErr("");
      startThungngern.mutate({
        shiftId: currentShift?.id,
        staffName: staff?.name ?? "",
        memberId: member?.id,
        items: cart.map(l => ({ productId: l.product.id, qty: l.qty })),
        discount: billDiscount,
        pointsToRedeem: redeemPoints,
        loyaltyChoice: member ? (loyaltyChoice ?? undefined) : undefined,
      });
      return;
    }

    const input: DesktopSaleInput = {
      shiftId: currentShift?.id,
      staffName: staff?.name ?? "",
      memberId: member?.id,
      customerId: payMethod === "credit" ? creditCustomer?.id : undefined,
      items: cart.map(l => ({ productId: l.product.id, qty: l.qty })),
      discount: billDiscount,
      paymentMethod: payMethod,
      received: receivedNum,
      pointsToRedeem: redeemPoints,
      loyaltyChoice: member ? (loyaltyChoice ?? undefined) : undefined,
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
          pointEarnPerBaht,
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
                  {sellableProductCount} รายการ
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

        <form
          className="rounded-2xl border border-violet-100/80 bg-white/85 p-3 shadow-[0_12px_32px_rgba(49,39,118,0.08)] backdrop-blur-xl"
          onSubmit={event => {
            event.preventDefault();
            void lookupBarcode(barcode);
          }}
        >
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <ScanBarcode className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-violet-500" />
              <Input
                ref={barcodeInputRef}
                value={barcode}
                onChange={event => setBarcode(event.target.value)}
                autoFocus
                autoComplete="off"
                aria-label="ยิงบาร์โค้ดหรือกรอกรหัสสินค้า"
                placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัสสินค้าแล้วกด Enter"
                className="h-14 border-slate-200 bg-white pl-11 font-mono text-base shadow-inner focus-visible:ring-violet-500/25"
              />
            </div>
            <Button
              type="submit"
              className="h-14 shrink-0 rounded-xl px-4"
              disabled={
                !products || barcode.trim().length < 3 || barcodeLookupPending
              }
            >
              {barcodeLookupPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              <span className="hidden sm:inline">ค้นหา</span>
            </Button>
          </div>
          <p className="mt-2 px-1 text-[11px] text-slate-500">
            ถ้าไม่พบในสาขา ระบบจะค้นหาจาก Open Food Facts
            บนอินเทอร์เน็ตให้อัตโนมัติ
          </p>
        </form>

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
            const soldOut = p.category !== "fuel" && p.stockQty <= 0;
            return (
              <button
                key={p.id}
                type="button"
                disabled={soldOut}
                aria-label={soldOut ? `${p.name} หมดแล้ว` : p.name}
                onClick={() => {
                  if (p.category === "fuel") {
                    releasePageFocus();
                    setFuelDialog(p);
                    setFuelMode("baht");
                    setFuelValue("");
                  } else {
                    addToCart(p, 1);
                  }
                }}
                className={`spotlight-card group relative min-h-[142px] overflow-hidden rounded-[20px] border border-white/90 bg-white/80 p-3 text-left shadow-[0_10px_30px_rgba(39,33,88,0.07)] ring-1 ring-slate-200/60 backdrop-blur-md transition-all duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-500/20 sm:min-h-[156px] sm:p-4 ${soldOut ? "cursor-not-allowed grayscale opacity-60" : "hover:-translate-y-1.5 hover:scale-[1.015] hover:border-violet-200 hover:shadow-[0_20px_46px_rgba(75,57,170,0.16)] active:translate-y-0 active:scale-[0.99]"}`}
              >
                <span
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70 ${tone.wash}`}
                />
                <span
                  className={`absolute inset-x-0 top-0 h-1.5 ${tone.bar}`}
                />
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div
                    className={`relative grid size-10 place-items-center overflow-hidden rounded-xl shadow-inner ring-1 ring-white transition-all duration-300 group-hover:-rotate-6 group-hover:scale-110 ${tone.icon}`}
                  >
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="size-full bg-white object-contain"
                      />
                    ) : p.category === "fuel" ? (
                      <Fuel className="size-[18px]" />
                    ) : (
                      <Package className="size-[18px]" />
                    )}
                  </div>
                  {soldOut ? (
                    <span className="relative rounded-lg bg-red-100 px-2 py-1 text-[10px] font-bold text-red-700 ring-1 ring-red-200">
                      หมดแล้ว
                    </span>
                  ) : (
                    <span
                      className={`relative rounded-lg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide ring-1 ring-black/[0.03] ${tone.code}`}
                    >
                      {p.code}
                    </span>
                  )}
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
                    <span
                      className={`text-[10px] ${soldOut ? "font-bold text-red-600" : "text-slate-400"}`}
                    >
                      {soldOut ? "หมดแล้ว" : `เหลือ ${fmtNum(p.stockQty)}`}
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
          <Card className="h-fit shrink-0 gap-0 overflow-hidden border-white/90 py-0 shadow-[0_22px_58px_rgba(38,30,90,0.13)] lg:sticky lg:top-[108px] lg:col-span-2">
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
                <div
                  className={`flex items-center justify-between rounded-2xl border px-3 py-2.5 ${
                    memberCardExpired
                      ? "border-red-200 bg-red-50"
                      : "border-violet-200 bg-gradient-to-r from-violet-50 to-cyan-50"
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-sm">
                    <div className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 text-white shadow-md shadow-violet-500/20">
                      <Star className="size-4 fill-white/20" />
                    </div>
                    <div>
                      <div className="font-semibold text-violet-950">
                        {member.name}
                      </div>
                      {memberCardExpired ? (
                        <div className="text-xs font-semibold text-red-600">
                          บัตรหมดอายุ {fmtDateTH(member.cardExpiresAt)} · แต้ม 0
                        </div>
                      ) : (
                        <>
                          <div className="text-xs text-violet-700/70">
                            {member.points} แต้ม · ทุก ฿
                            {fmtMoney(pointEarnPerBaht)} ได้ 1 แต้ม
                          </div>
                          <div className="text-[11px] font-medium text-violet-600">
                            ใช้แต้มได้ทุกสาขา · หมดอายุ{" "}
                            {fmtDateTH(member.cardExpiresAt)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="ยกเลิกสมาชิก"
                    onClick={() => {
                      setMember(null);
                      setPointsToRedeem(0);
                      setLoyaltyChoice(null);
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
                      placeholder="เบอร์โทร หรือสแกนบัตรสมาชิก"
                      value={phoneQ}
                      onChange={e => setPhoneQ(e.target.value)}
                      autoComplete="off"
                      aria-label="ค้นหาสมาชิกด้วยเบอร์โทรหรือรหัสบนบัตร"
                      className="h-11 pl-9"
                    />
                  </div>
                  {memberSearchReady && (
                    <div className="max-h-32 overflow-y-auto rounded-lg border bg-white text-sm shadow-lg">
                      {(memberSearch.data ?? []).map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className="flex w-full justify-between border-b px-3 py-2.5 text-left last:border-0 hover:bg-blue-50"
                          onClick={() => {
                            setMember(m);
                            setPointsToRedeem(0);
                            setLoyaltyChoice(null);
                            setPhoneQ("");
                          }}
                        >
                          <span>{m.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {isMemberCardExpired(m.cardExpiresAt)
                              ? "บัตรหมดอายุ"
                              : `${m.points} แต้ม`}
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
                {cart.map(l => {
                  const currentProduct = productById.get(l.product.id);
                  const availableStock = currentProduct?.stockQty ?? 0;
                  const soldOut =
                    l.product.category !== "fuel" && availableStock <= 0;
                  const atStockLimit =
                    l.product.category !== "fuel" && l.qty >= availableStock;
                  return (
                    <div
                      key={l.product.id}
                      className="rounded-2xl border border-white bg-gradient-to-br from-white to-violet-50/35 p-3 text-sm shadow-sm ring-1 ring-slate-200/70 transition-all hover:border-violet-200 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-slate-800">
                            {l.product.name}
                            {soldOut && (
                              <Badge className="ml-2 bg-red-100 text-red-700 hover:bg-red-100">
                                หมดแล้ว
                              </Badge>
                            )}
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
                            disabled={atStockLimit}
                            className="grid size-8 place-items-center text-slate-500 hover:bg-white hover:text-violet-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
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
                  );
                })}
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
                {activePromotion && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                        <Sparkles className="size-3.5 shrink-0" />
                        <span className="truncate">{activePromotion.name}</span>
                      </span>
                      <span className="shrink-0 font-bold number-display">
                        {promotionDiscount > 0
                          ? `−฿${fmtMoney(promotionDiscount)}`
                          : `ลด ฿${fmtMoney(activePromotion.discountPerLiter)}/ลิตร`}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-emerald-700">
                      {promotionFuelLiters > 0
                        ? `ลด ฿${fmtMoney(activePromotion.discountPerLiter)}/ลิตร × ${fmtNum(promotionFuelLiters)} ลิตร และสรุปส่วนลดท้ายบิล`
                        : "ใช้กับสินค้าหมวดน้ำมัน และสรุปส่วนลดให้อัตโนมัติท้ายบิล"}
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-center gap-2">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <BadgePercent className="size-3.5" />
                    {activePromotion
                      ? "ส่วนลดเพิ่มเติม (บาท)"
                      : "ส่วนลดท้ายบิล (บาท)"}
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
                {member && !memberCardExpired && (
                  <div className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50/70 p-3">
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold text-violet-950">
                        <Star className="size-3.5" />
                        ถามลูกค้า: ต้องการสะสมแต้ม หรือใช้เป็นส่วนลด?
                      </div>
                      <div className="mt-0.5 text-[11px] text-violet-600">
                        กรุณาติ๊กเลือก 1 รายการก่อนชำระเงิน
                      </div>
                    </div>
                    <div
                      role="group"
                      aria-label="ตัวเลือกแต้มสมาชิก"
                      className="grid grid-cols-2 gap-2"
                    >
                      <label
                        className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 transition-colors ${
                          loyaltyChoice === "earn"
                            ? "border-violet-500 bg-white text-violet-900 shadow-sm"
                            : "border-violet-100 bg-white/60 text-slate-600 hover:border-violet-300"
                        }`}
                      >
                        <Checkbox
                          checked={loyaltyChoice === "earn"}
                          onCheckedChange={checked => {
                            setLoyaltyChoice(checked === true ? "earn" : null);
                            setPointsToRedeem(0);
                            setErr("");
                          }}
                          aria-label="สะสมแต้ม"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-semibold">สะสมแต้ม</span>
                          <span className="block text-[11px] text-slate-400">
                            รับ{" "}
                            {Math.floor(
                              Math.max(0, subtotal - billDiscount) /
                                pointEarnPerBaht
                            )}{" "}
                            แต้มจากบิลนี้
                          </span>
                        </span>
                      </label>
                      <label
                        className={`flex items-start gap-2 rounded-xl border p-2.5 transition-colors ${
                          syncStatus?.online === false ||
                          maxRedeemablePoints === 0
                            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                            : loyaltyChoice === "redeem"
                              ? "cursor-pointer border-emerald-500 bg-white text-emerald-900 shadow-sm"
                              : "cursor-pointer border-violet-100 bg-white/60 text-slate-600 hover:border-emerald-300"
                        }`}
                      >
                        <Checkbox
                          checked={loyaltyChoice === "redeem"}
                          disabled={
                            syncStatus?.online === false ||
                            maxRedeemablePoints === 0
                          }
                          onCheckedChange={checked => {
                            const redeemSelected = checked === true;
                            setLoyaltyChoice(redeemSelected ? "redeem" : null);
                            setPointsToRedeem(
                              redeemSelected ? maxRedeemablePoints : 0
                            );
                            setErr("");
                          }}
                          aria-label="ใช้แต้มเป็นส่วนลด"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-semibold">
                            ใช้เป็นส่วนลด
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            มี {member.points} แต้ม · 1 แต้ม = ฿
                            {fmtMoney(pointValue)}
                          </span>
                        </span>
                      </label>
                    </div>
                    {loyaltyChoice === "redeem" && (
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-emerald-100">
                        <span className="text-xs text-emerald-800">
                          จำนวนแต้มที่ใช้
                          {redeemPoints > 0 &&
                            ` · ลด ฿${fmtMoney(redeemDiscount)}`}
                        </span>
                        <Input
                          type="number"
                          min={1}
                          max={maxRedeemablePoints}
                          value={redeemPoints || ""}
                          placeholder="0"
                          onChange={e =>
                            setPointsToRedeem(
                              Math.min(
                                maxRedeemablePoints,
                                Math.max(
                                  0,
                                  Math.floor(Number(e.target.value) || 0)
                                )
                              )
                            )
                          }
                          className="h-9 w-24 text-right"
                        />
                      </div>
                    )}
                    {!loyaltyChoice && (
                      <div className="text-[11px] font-medium text-amber-700">
                        ยังไม่ได้เลือกวิธีใช้สิทธิ์สมาชิก
                      </div>
                    )}
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
                <div className="grid grid-cols-5 gap-2">
                  {enabledPayMethods.map(m => {
                    const PaymentIcon = paymentIcons[m];
                    const disabled =
                      (m === "credit" && syncStatus?.online === false) ||
                      (m === "thungngern" && !thungngernStatus?.enabled);
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={disabled}
                        onClick={() => setPayMethod(m)}
                        title={
                          m === "credit" && syncStatus?.online === false
                            ? "ขายเชื่อต้องเชื่อมต่ออินเทอร์เน็ต"
                            : m === "thungngern" && !thungngernStatus?.enabled
                              ? "ให้ผู้ดูแลเปิดใช้งานและตั้งค่า PromptPay ID ที่ ตั้งค่าระบบ > การชำระเงิน"
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
                {payMethod === "thungngern" && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                    {syncStatus?.online === false
                      ? "ขณะออฟไลน์: ระบบจะบันทึกเป็นบิล QR ถุงเงินรอยืนยันการชำระ และซิงก์ขึ้นคลาวด์เมื่ออินเทอร์เน็ตกลับมา"
                      : "กดยืนยันการชำระเงินเพื่อสร้าง QR ล็อกยอด — ลูกค้าสแกนด้วยแอปธนาคารใดก็ได้ ระบบเช็กยอดเข้าถุงเงินและปิดบิลให้อัตโนมัติ"}
                  </div>
                )}
                {payMethod === "qr" && (
                  <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
                    {promptpayQrUrl ? (
                      <img
                        src={promptpayQrUrl}
                        alt="QR พร้อมเพย์"
                        className="size-28 shrink-0 rounded-lg border border-sky-100 bg-white p-1"
                      />
                    ) : (
                      <div className="flex size-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-sky-300 bg-white p-1 text-center text-[10px] text-sky-500">
                        {promptpayQr?.payload === null
                          ? "ไม่มี QR"
                          : "กำลังสร้าง QR…"}
                      </div>
                    )}
                    <div className="min-w-0 text-xs text-sky-900">
                      <div className="font-bold">
                        QR พร้อมเพย์ ฿{fmtMoney(qrAmount)}
                      </div>
                      <div className="mt-0.5 leading-relaxed text-sky-700">
                        {promptpayQr?.payload === null
                          ? "ยังไม่ได้ตั้งค่า PromptPay ID — ให้ผู้ดูแลตั้งค่าที่ ตั้งค่าระบบ > การชำระเงิน"
                          : "ให้ลูกค้าสแกนด้วยแอปธนาคารใดก็ได้ แล้วกดชำระเงินเพื่อบันทึกบิล"}
                      </div>
                    </div>
                  </div>
                )}
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

              {cartStockIssue && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  {cartStockIssue}
                </div>
              )}
              {err && err !== cartStockIssue && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" /> {err}
                </div>
              )}
              <Button
                className="shine-button h-14 w-full justify-between rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 px-5 text-base font-heading shadow-[0_16px_34px_rgba(88,70,220,0.28)] hover:from-violet-500 hover:via-indigo-600 hover:to-cyan-500"
                disabled={
                  cart.length === 0 ||
                  salePending ||
                  Boolean(cartStockIssue) ||
                  memberCardExpired
                }
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
                className="max-h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] gap-0 overflow-y-auto overscroll-contain rounded-t-2xl border-0 bg-transparent p-0 pb-[env(safe-area-inset-bottom)]"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>รายการขายและชำระเงิน</SheetTitle>
                </SheetHeader>
                {cartPanel}
              </SheetContent>
            </Sheet>
            {cart.length > 0 &&
              !mobileCartOpen &&
              createPortal(
                <Button
                  type="button"
                  onClick={() => setMobileCartOpen(true)}
                  className="mobile-pos-cart-trigger fixed bottom-[calc(86px+env(safe-area-inset-bottom))] left-3 right-3 z-20 h-14 justify-between rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 px-4 text-white shadow-[0_18px_42px_rgba(65,49,175,0.35)] hover:from-violet-500 hover:via-indigo-600 hover:to-cyan-500 lg:hidden"
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
                </Button>,
                document.body
              )}
          </>
        );
      })()}

      {/* ผลค้นหาสินค้าจากฐานข้อมูลภายนอก */}
      <Dialog
        open={!!externalLookup}
        onOpenChange={open => {
          if (!open) {
            setExternalLookup(null);
            setExternalDraft(null);
            importExternalProduct.reset();
          }
        }}
      >
        <DialogContent
          className="max-w-lg gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
          onOpenAutoFocus={event => {
            event.preventDefault();
            (
              externalProductNameInputRef.current ??
              externalDialogCloseButtonRef.current
            )?.focus();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            barcodeInputRef.current?.focus();
          }}
        >
          <DialogHeader className="bg-gradient-to-br from-[#17143a] via-[#282263] to-[#15505d] px-6 py-5 text-left text-white">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                <Globe2 className="size-5 text-cyan-200" />
              </div>
              <div>
                <DialogTitle className="font-heading text-lg text-white">
                  ผลค้นหาจากอินเทอร์เน็ต
                </DialogTitle>
                <p className="mt-0.5 font-mono text-xs text-white/55">
                  บาร์โค้ด {externalLookup?.barcode}
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto bg-slate-50 p-5">
            {externalLookup?.product && externalDraft ? (
              <>
                <div className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  {externalLookup.product.imageUrl ? (
                    <img
                      src={externalLookup.product.imageUrl}
                      alt={externalLookup.product.name}
                      className="size-20 shrink-0 rounded-xl bg-white object-contain ring-1 ring-slate-200"
                    />
                  ) : (
                    <div className="grid size-20 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400 ring-1 ring-slate-200">
                      <Package className="size-7" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-snug text-slate-900">
                      {externalLookup.product.name}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                      {externalLookup.product.brand && (
                        <span>{externalLookup.product.brand}</span>
                      )}
                      {externalLookup.product.quantity && (
                        <span>· {externalLookup.product.quantity}</span>
                      )}
                    </div>
                    <a
                      href={externalLookup.product.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline"
                    >
                      ข้อมูลจาก {externalLookup.product.providerLabel}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                </div>

                <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label
                      htmlFor="external-product-name"
                      className="text-xs font-semibold text-slate-600"
                    >
                      ชื่อสินค้า
                    </label>
                    <Input
                      ref={externalProductNameInputRef}
                      id="external-product-name"
                      value={externalDraft.name}
                      onChange={event =>
                        setExternalDraft({
                          ...externalDraft,
                          name: event.target.value,
                        })
                      }
                      className="h-11 bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">
                      หมวดสินค้า
                    </label>
                    <Select
                      value={externalDraft.category}
                      onValueChange={value =>
                        setExternalDraft({
                          ...externalDraft,
                          category: value as "lubricant" | "other",
                        })
                      }
                    >
                      <SelectTrigger className="h-11 w-full bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="other">สินค้าอื่น</SelectItem>
                        <SelectItem value="lubricant">
                          2T / น้ำมันเครื่อง
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="external-product-unit"
                      className="text-xs font-semibold text-slate-600"
                    >
                      หน่วยนับ
                    </label>
                    <Input
                      id="external-product-unit"
                      value={externalDraft.unit}
                      onChange={event =>
                        setExternalDraft({
                          ...externalDraft,
                          unit: event.target.value,
                        })
                      }
                      className="h-11 bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="external-product-price"
                      className="text-xs font-semibold text-slate-600"
                    >
                      ราคาขาย
                    </label>
                    <Input
                      id="external-product-price"
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={externalDraft.price}
                      onChange={event =>
                        setExternalDraft({
                          ...externalDraft,
                          price: event.target.value,
                        })
                      }
                      placeholder="0.00"
                      className="h-11 bg-white text-right number-display"
                    />
                  </div>

                  {staff?.role !== "cashier" && (
                    <div className="space-y-1.5">
                      <label
                        htmlFor="external-product-cost"
                        className="text-xs font-semibold text-slate-600"
                      >
                        ต้นทุน
                      </label>
                      <Input
                        id="external-product-cost"
                        type="number"
                        min={0}
                        step="0.01"
                        value={externalDraft.cost}
                        onChange={event =>
                          setExternalDraft({
                            ...externalDraft,
                            cost: event.target.value,
                          })
                        }
                        placeholder="0.00"
                        className="h-11 bg-white text-right number-display"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label
                      htmlFor="external-product-stock"
                      className="text-xs font-semibold text-slate-600"
                    >
                      สต๊อกเริ่มต้น
                    </label>
                    <Input
                      id="external-product-stock"
                      type="number"
                      min={1}
                      step="1"
                      value={externalDraft.stockQty}
                      onChange={event =>
                        setExternalDraft({
                          ...externalDraft,
                          stockQty: event.target.value,
                        })
                      }
                      className="h-11 bg-white text-right number-display"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="external-product-low-stock"
                      className="text-xs font-semibold text-slate-600"
                    >
                      แจ้งเตือนเมื่อต่ำกว่า
                    </label>
                    <Input
                      id="external-product-low-stock"
                      type="number"
                      min={0}
                      step="1"
                      value={externalDraft.lowStockAt}
                      onChange={event =>
                        setExternalDraft({
                          ...externalDraft,
                          lowStockAt: event.target.value,
                        })
                      }
                      className="h-11 bg-white text-right number-display"
                    />
                  </div>
                </div>

                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                  ข้อมูลภายนอกอาจจัดทำโดยผู้ใช้ กรุณาตรวจสอบชื่อและขนาดสินค้า
                  ก่อนบันทึก ข้อมูล Open Food Facts ใช้ภายใต้ ODbL
                  และรูปภาพใช้ภายใต้ CC BY-SA
                </p>

                <Button
                  type="button"
                  className="h-12 w-full rounded-xl"
                  disabled={
                    importExternalProduct.isPending ||
                    !externalDraft.name.trim() ||
                    !externalDraft.unit.trim() ||
                    Number(externalDraft.price) < 0.01 ||
                    Number(externalDraft.cost || 0) < 0 ||
                    Number(externalDraft.stockQty) < 1 ||
                    Number(externalDraft.lowStockAt || 0) < 0
                  }
                  onClick={() =>
                    importExternalProduct.mutate({
                      barcode: externalLookup.barcode,
                      name: externalDraft.name,
                      category: externalDraft.category,
                      unit: externalDraft.unit,
                      price: Number(externalDraft.price),
                      cost:
                        staff?.role === "cashier"
                          ? 0
                          : Number(externalDraft.cost) || 0,
                      stockQty: Number(externalDraft.stockQty),
                      lowStockAt: Number(externalDraft.lowStockAt) || 0,
                      imageUrl: externalLookup.product?.imageUrl ?? null,
                    })
                  }
                >
                  {importExternalProduct.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CloudDownload className="size-4" />
                  )}
                  เพิ่มเข้าร้านและใส่ตะกร้า
                </Button>
              </>
            ) : (
              <div className="py-8 text-center">
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-200 text-slate-500">
                  <Package className="size-6" />
                </div>
                <h3 className="mt-4 font-semibold text-slate-800">
                  ไม่พบสินค้านี้ใน Open Food Facts
                </h3>
                <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-slate-500">
                  กรุณาตรวจสอบบาร์โค้ด
                  หรือให้ผู้ดูแลเพิ่มสินค้าใหม่จากหน้าตั้งค่า
                </p>
              </div>
            )}

            {importExternalProduct.error && (
              <div
                role="alert"
                className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {importExternalProduct.error.message}
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white p-4">
            <Button
              ref={externalDialogCloseButtonRef}
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setExternalLookup(null);
                setExternalDraft(null);
                importExternalProduct.reset();
              }}
              disabled={importExternalProduct.isPending}
            >
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog เติมน้ำมัน */}
      <Dialog open={!!fuelDialog} onOpenChange={o => !o && setFuelDialog(null)}>
        <DialogContent
          className="max-w-md gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
          onOpenAutoFocus={event => {
            event.preventDefault();
            fuelValueInputRef.current?.focus();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            barcodeInputRef.current?.focus();
          }}
        >
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
                ref={fuelValueInputRef}
                id="fuel-value"
                type="number"
                min={0}
                step="0.01"
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
      <Dialog
        open={!!receipt}
        onOpenChange={open => {
          if (!open) {
            setReceipt(null);
            setReceiptPromotion(null);
          }
        }}
      >
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogTitle className="sr-only">ใบเสร็จ</DialogTitle>
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
                  promotion={receiptPromotion ?? undefined}
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
            <Button
              onClick={() => {
                setReceipt(null);
                setReceiptPromotion(null);
              }}
            >
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ใบกำกับภาษีเต็มรูป */}
      <TaxInvoiceDialog saleId={taxSaleId} onClose={() => setTaxSaleId(null)} />

      {/* QR ถุงเงิน — รอยืนยันยอดเข้าและปิดบิลอัตโนมัติ */}
      <ThungngernQrDialog
        session={thungngernSession}
        onConfirmed={receipt => {
          setThungngernSession(null);
          finishSale(receipt as ReceiptData);
        }}
        onClosed={() => setThungngernSession(null)}
      />
    </div>
  );
}
