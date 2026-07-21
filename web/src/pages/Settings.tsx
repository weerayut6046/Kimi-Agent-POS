import { useRef, useState, type ChangeEvent } from "react";
import {
  Settings as SettingsIcon,
  Store,
  Fuel,
  UserCog,
  Plus,
  Pencil,
  Gift,
  Trash2,
  Gauge,
  FileText,
  ImagePlus,
  Database,
  History,
  Save,
  Printer,
  Network,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import {
  fmtMoney,
  fmtNum,
  fmtDateTime,
  categoryLabel,
  roleLabel,
} from "@/lib/format";
import { createInitialSettingsForm } from "./settingsForm";
import type { Product } from "@db/schema";

const emptyProduct = {
  code: "",
  name: "",
  category: "other" as "fuel" | "lubricant" | "other",
  unit: "ชิ้น",
  price: 0,
  cost: 0,
  stockQty: 0,
  lowStockAt: 0,
};

export default function Settings() {
  const { staff } = useStaff();
  const utils = trpc.useUtils();
  const isAdmin = staff?.role === "admin";
  const isDesktop = typeof window !== "undefined" && !!window.posDesktop;
  const settingsSaveInFlight = useRef(false);

  // โพลทุก 5 วิ — ค่าที่แสดงสดใกล้ realtime: แก้จากเครื่องอื่น (multi-station) หรือที่อื่นแล้วหน้านี้อัปเดตเอง
  // หยุดโพลระหว่างบันทึก ป้องกัน request เก่าตอบกลับมาทับค่าที่เพิ่งบันทึก
  const {
    data: settingMap,
    isPending: settingsPending,
    isError: settingsError,
    error: settingsQueryError,
    refetch: refetchSettings,
  } = trpc.catalog.getSettings.useQuery(undefined, {
    refetchInterval: () => (settingsSaveInFlight.current ? false : 5000),
  });
  const { data: shopLogo } = trpc.catalog.getShopLogo.useQuery();
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const { data: staffList } = trpc.auth.listStaff.useQuery();
  const { data: rewards } = trpc.membership.listRewards.useQuery();
  const { data: pumps } = trpc.catalog.listPumps.useQuery();
  const { data: tanks } = trpc.catalog.listTanks.useQuery();
  const { data: lanInfo } = trpc.catalog.lanInfo.useQuery();

  // Layout เรียก getSettings ไว้ก่อนแล้วบ่อยครั้ง query จึงมีข้อมูลใน cache ตั้งแต่ render แรก
  // ต้องนำ cache มาเป็นค่าเริ่มต้นทันที ไม่เช่นนั้น prevSettingMap จะเท่ากันและฟอร์มจะค้างเป็น {}
  const [form, setForm] = useState<Record<string, string>>(() =>
    createInitialSettingsForm(settingMap)
  );
  const [logoData, setLogoData] = useState<string | null>(null); // null=ไม่เปลี่ยน, ""=ลบโลโก้, อื่นๆ=data URL ใหม่
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [editP, setEditP] = useState<
    (Partial<Product> & typeof emptyProduct) | null
  >(null);
  const [histP, setHistP] = useState<Product | null>(null); // สินค้าที่กำลังดูประวัติเปลี่ยนราคา
  const { data: priceHist } = trpc.catalog.priceHistory.useQuery(
    { productId: histP?.id ?? 0 },
    { enabled: histP != null }
  );
  const [showStaff, setShowStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({
    username: "",
    pin: "",
    name: "",
    role: "cashier" as "admin" | "manager" | "cashier",
  });
  const [editS, setEditS] = useState<{
    id: number;
    username: string;
    name: string;
    role: "admin" | "manager" | "cashier";
    pin: string;
  } | null>(null);
  const [editN, setEditN] = useState<{
    id: number;
    label: string;
    productId: number;
    tankId: number | null;
    meter: number;
    money: number;
  } | null>(null);
  const [editR, setEditR] = useState<{
    id?: number;
    name: string;
    pointsRequired: number;
    stock: number;
  } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // sync ฟอร์มจาก settingMap ด้วย pattern adjust-state-during-render (แทน useEffect เพื่อเลี่ยง cascading render)
  // merge แบบเก็บ keys ที่แก้ค้างไว้ (ค่าต่างจาก snapshot รอบก่อนและยังไม่ตรง server รอบใหม่)
  // — กัน refetch (TanStack refetch ตอน window focus) ล้างค่าที่ยังไม่บันทึก
  const [prevSettingMap, setPrevSettingMap] = useState(settingMap);
  if (settingMap !== prevSettingMap) {
    setPrevSettingMap(settingMap);
    if (settingMap) {
      setForm(f => {
        const merged = { ...settingMap };
        for (const k of Object.keys(f)) {
          // ยังไม่เคยโหลด settingMap — ทุก key ในฟอร์มคือการแก้ของผู้ใช้ เก็บไว้ทั้งหมด
          if (!prevSettingMap) {
            merged[k] = f[k];
            continue;
          }
          if (
            f[k] !== (prevSettingMap[k] ?? "") &&
            f[k] !== (settingMap[k] ?? "")
          )
            merged[k] = f[k];
        }
        return merged;
      });
    }
  }

  const ok = (m: string) => {
    setMsg(m);
    setErr("");
    setTimeout(() => setMsg(""), 3000);
  };
  const fail = (m: string) => {
    setErr(m);
    setMsg("");
  };

  const saveSettings = trpc.catalog.updateSettings.useMutation({
    onMutate: async () => {
      // request polling อาจเริ่มก่อนกดบันทึกและถือค่าเก่าอยู่ ต้องยกเลิกก่อนเขียนค่าใหม่
      settingsSaveInFlight.current = true;
      await utils.catalog.getSettings.cancel();
    },
    onSuccess: result => {
      // ใช้ค่าที่ API อ่านกลับจาก PostgreSQL เป็น source of truth และไม่ invalidate ซ้ำทันที
      // เพราะ invalidate อาจไปรอ request เก่าที่กำลังวิ่งอยู่แล้วนำค่าเก่ากลับมาทับหน้าจอ
      setPrevSettingMap(result.settings);
      setForm(result.settings);
      utils.catalog.getSettings.setData(undefined, result.settings);
      void utils.catalog.getShopLogo.invalidate();
      void utils.catalog.lanInfo.invalidate();
      setLogoData(null);
      ok("บันทึกการตั้งค่าลงฐานข้อมูลแล้ว");
    },
    onError: e => fail(e.message),
    onSettled: () => {
      settingsSaveInFlight.current = false;
    },
  });
  const saveProduct = trpc.catalog.updateProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      setEditP(null);
      ok("บันทึกสินค้าแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createProduct = trpc.catalog.createProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      setEditP(null);
      ok("เพิ่มสินค้าแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createStaff = trpc.auth.createStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      setShowStaff(false);
      setNewStaff({ username: "", pin: "", name: "", role: "cashier" });
      ok("เพิ่มพนักงานแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateStaff = trpc.auth.updateStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      setEditS(null);
      ok("แก้ไขพนักงานแล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteStaff = trpc.auth.deleteStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      ok("ลบพนักงานแล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteProduct = trpc.catalog.deleteProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      ok("ลบสินค้าแล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteReward = trpc.membership.deleteReward.useMutation({
    onSuccess: () => {
      utils.membership.listRewards.invalidate();
      ok("ลบของรางวัลแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateNozzle = trpc.catalog.updateNozzleMeter.useMutation({
    onSuccess: () => {
      utils.catalog.listPumps.invalidate();
      setEditN(null);
      ok("แก้ไขหัวจ่ายแล้ว");
    },
    onError: e => fail(e.message),
  });
  const saveReward = trpc.membership.upsertReward.useMutation({
    onSuccess: () => {
      utils.membership.listRewards.invalidate();
      setEditR(null);
      ok("บันทึกของรางวัลแล้ว");
    },
    onError: e => fail(e.message),
  });

  // ---------- ฐานข้อมูลบน Supabase ----------
  const { data: dbInfo } = trpc.dbadmin.dbInfo.useQuery(undefined, {
    enabled: isAdmin,
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // เลขถัดไปของเอกสาร: ส่งเฉพาะเมื่อแก้จากค่าที่โหลดมาจริงๆ
  // กันตัวนับถอยหลังกรณีมีการออกเอกสารระหว่างที่เปิดหน้านี้ค้างไว้
  const COUNTER_KEYS = ["receipt_next_no", "tax_invoice_next_no"];
  const saveAll = () => {
    const entries = Object.entries(form)
      .filter(
        ([k, v]) => !COUNTER_KEYS.includes(k) || v !== (settingMap?.[k] ?? "")
      )
      .map(([key, value]) => ({ key, value }));
    if (logoData !== null) entries.push({ key: "shop_logo", value: logoData });
    saveSettings.mutate({ entries });
  };

  const onLogoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      fail("ไฟล์โลโก้ใหญ่เกิน 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // ย่อให้กว้างไม่เกิน 480px ก่อนเก็บเป็น base64 ลด payload
        const scale = Math.min(1, 480 / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas
          .getContext("2d")
          ?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setLogoData(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const nextPreview = (
    prefix: string | undefined,
    next: string | undefined,
    fallback: string
  ) =>
    `${prefix || fallback}${String(Math.max(1, Number(next ?? "1") || 1)).padStart(5, "0")}`;

  const logoShown = logoData !== null ? logoData : (shopLogo ?? "");

  // ระหว่างโหลด/โหลดพลาด อย่าแสดงฟอร์มค่า default — ผู้ใช้จะเข้าใจผิดว่าค่าที่ตั้งไว้หาย (เคยเกิดเหตุนี้จริง)
  if (settingsPending && !settingMap) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลดการตั้งค่า…
      </div>
    );
  }
  if (settingsError && !settingMap) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-sm text-destructive">
          โหลดการตั้งค่าไม่สำเร็จ — เช็กว่าเซิร์ฟเวอร์ทำงานอยู่ แล้วลองใหม่
        </p>
        <Button variant="outline" onClick={() => refetchSettings()}>
          ลองใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="page-heading flex items-center gap-2">
        <SettingsIcon className="w-6 h-6 text-primary" /> ตั้งค่าระบบ
      </h1>
      {settingsError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-2">
          <span>
            เชื่อมต่อฐานข้อมูลล่าสุดไม่สำเร็จ กำลังแสดงค่าที่โหลดไว้ก่อนหน้า:{" "}
            {settingsQueryError?.message}
          </span>
          <Button size="sm" variant="outline" onClick={() => refetchSettings()}>
            ลองใหม่
          </Button>
        </div>
      )}
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* ข้อมูลร้าน */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Store className="w-4 h-4" /> ข้อมูลร้าน (แสดงบนใบเสร็จ/ใบกำกับภาษี)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>ชื่อร้าน</Label>
            <Input
              value={form.shop_name ?? ""}
              onChange={e => set("shop_name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>สาขา</Label>
            <Input
              value={form.shop_branch ?? ""}
              onChange={e => set("shop_branch", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ที่อยู่</Label>
            <Textarea
              rows={2}
              value={form.shop_address ?? ""}
              onChange={e => set("shop_address", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>เลขประจำตัวผู้เสียภาษี</Label>
            <Input
              value={form.tax_id ?? ""}
              onChange={e => set("tax_id", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>โทรศัพท์</Label>
            <Input
              value={form.shop_phone ?? ""}
              onChange={e => set("shop_phone", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>อัตรา VAT (%)</Label>
            <Input
              type="number"
              value={form.vat_rate ?? "7"}
              onChange={e => set("vat_rate", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>สะสมแต้ม (กี่บาท = 1 แต้ม)</Label>
            <Input
              type="number"
              value={form.point_earn_per_baht ?? "25"}
              onChange={e => set("point_earn_per_baht", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>มูลค่าแต้มตอนใช้ (1 แต้ม = กี่บาท)</Label>
            <Input
              type="number"
              value={form.point_redeem_value ?? "1"}
              onChange={e => set("point_redeem_value", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={!isAdmin || saveSettings.isPending}
              onClick={saveAll}
            >
              บันทึกการตั้งค่า {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* เลขที่เอกสาร & โลโก้ร้าน */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <FileText className="w-4 h-4" /> เลขที่เอกสาร & โลโก้ร้าน
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>คำนำหน้าเลขใบเสร็จอย่างย่อ</Label>
            <Input
              maxLength={10}
              value={form.receipt_prefix ?? "R"}
              onChange={e => set("receipt_prefix", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              เอกสารถัดไป:{" "}
              {nextPreview(form.receipt_prefix, form.receipt_next_no, "R")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>เลขถัดไปใบเสร็จอย่างย่อ</Label>
            <Input
              type="number"
              min={1}
              value={form.receipt_next_no ?? "1"}
              onChange={e => set("receipt_next_no", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>คำนำหน้าเลขใบกำกับภาษี</Label>
            <Input
              maxLength={10}
              value={form.tax_invoice_prefix ?? "T"}
              onChange={e => set("tax_invoice_prefix", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              เอกสารถัดไป:{" "}
              {nextPreview(
                form.tax_invoice_prefix,
                form.tax_invoice_next_no,
                "T"
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>เลขถัดไปใบกำกับภาษี</Label>
            <Input
              type="number"
              min={1}
              value={form.tax_invoice_next_no ?? "1"}
              onChange={e => set("tax_invoice_next_no", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>โลโก้ร้าน (แสดงบนใบเสร็จ/ใบกำกับภาษี)</Label>
            <div className="flex items-center gap-3 flex-wrap">
              {logoShown ? (
                <img
                  src={logoShown}
                  alt="โลโก้ร้าน"
                  className="h-14 w-auto object-contain border rounded p-1 bg-white"
                />
              ) : (
                <div className="h-14 w-28 border border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">
                  ยังไม่มีโลโก้
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isAdmin}
                  onClick={() => logoInputRef.current?.click()}
                >
                  <ImagePlus className="w-4 h-4 mr-1" /> เลือกรูป
                </Button>
                {logoShown && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!isAdmin}
                    onClick={() => setLogoData("")}
                  >
                    ลบโลโก้
                  </Button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onLogoFile}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              รองรับไฟล์รูปไม่เกิน 2MB (ระบบย่อขนาดให้อัตโนมัติ) ·
              กดบันทึกเพื่อยืนยัน
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={!isAdmin || saveSettings.isPending}
              onClick={saveAll}
            >
              บันทึกการตั้งค่า {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* การพิมพ์เอกสาร (ผ่านเบราว์เซอร์) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Printer className="w-4 h-4" /> การพิมพ์เอกสาร
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 max-w-sm">
            <Label>ขนาดกระดาษใบเสร็จ (พิมพ์ผ่านเบราว์เซอร์)</Label>
            <Select
              value={form.receipt_paper_size ?? "80"}
              onValueChange={v => set("receipt_paper_size", v)}
              disabled={!isAdmin}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="80">ม้วนความร้อน 80 มม.</SelectItem>
                <SelectItem value="58">ม้วนความร้อน 58 มม.</SelectItem>
                <SelectItem value="a5">A5</SelectItem>
                <SelectItem value="a4">A4</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              ใช้กับปุ่ม &quot;พิมพ์&quot; ธรรมดาบนใบเสร็จ —
              ถ้าพิมพ์แล้วตัวอักษรใหญ่/ล้นขอบกระดาษ
              ให้เลือกขนาดตรงนี้ให้ตรงกระดาษจริง
            </p>
          </div>
          <div className="space-y-1.5 max-w-sm">
            <Label>ขนาดกระดาษใบกำกับภาษีเต็มรูป</Label>
            <Select
              value={form.tax_invoice_paper_size ?? "a4"}
              onValueChange={v => set("tax_invoice_paper_size", v)}
              disabled={!isAdmin}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a4">A4</SelectItem>
                <SelectItem value="a5">A5</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              ใช้กับใบเสร็จรับเงิน/ใบกำกับภาษีเต็มรูป
              ทั้งหน้าพรีวิวและหน้าต่างพิมพ์
            </p>
          </div>
          {isDesktop && (
            <div className="flex items-center justify-between rounded-md border p-3 max-w-sm">
              <div className="pr-3">
                <Label
                  htmlFor="receipt_silent_print"
                  className="cursor-pointer"
                >
                  พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  พิมพ์เงียบเข้าเครื่องพิมพ์ default ของ Windows ทันทีโดยไม่เด้ง
                  dialog (เฉพาะ desktop app — ต้องตั้งเครื่องพิมพ์ที่ใช้เป็น
                  default ไว้ก่อน)
                </p>
              </div>
              <Switch
                id="receipt_silent_print"
                disabled={!isAdmin}
                checked={form.receipt_silent_print === "1"}
                onCheckedChange={v =>
                  set("receipt_silent_print", v ? "1" : "0")
                }
              />
            </div>
          )}
          <div>
            <Button
              disabled={!isAdmin || saveSettings.isPending}
              onClick={saveAll}
            >
              <Save className="w-4 h-4 mr-2" /> บันทึกการตั้งค่า{" "}
              {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* เครือข่าย LAN (ขายหลายเครื่องพร้อมกัน) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Network className="w-4 h-4" /> เครือข่าย LAN
            (ขายหลายเครื่องพร้อมกัน)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3 max-w-xl">
            <Label htmlFor="lan_enabled" className="cursor-pointer">
              เปิดให้เครื่องอื่นใน LAN เชื่อมต่อ
            </Label>
            <Switch
              id="lan_enabled"
              disabled={!isAdmin}
              checked={form.lan_enabled === "1"}
              onCheckedChange={v => set("lan_enabled", v ? "1" : "0")}
            />
          </div>
          {form.lan_enabled === "1" && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-amber-600">
                มีผลหลังกดบันทึกแล้วรีสตาร์ทแอป (Docker: restart container)
              </p>
              {lanInfo && lanInfo.urls.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    เครื่องลูกเปิดเบราว์เซอร์ไปที่:
                  </p>
                  {lanInfo.urls.map(u => (
                    <div key={u} className="flex items-center gap-2">
                      <code className="rounded bg-muted px-2 py-1 text-xs">
                        {u}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          void navigator.clipboard?.writeText(u);
                          ok("คัดลอก URL แล้ว");
                        }}
                      >
                        <Copy className="w-3 h-3 mr-1" /> คัดลอก
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ไม่พบ IP ของเครื่องนี้ในเครือข่าย — ตรวจสอบการเชื่อมต่อ LAN
                </p>
              )}
              <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                <li>
                  เครื่องลูกล็อกอินด้วย PIN ของพนักงานแต่ละคน และขายภายใต้
                  <span className="font-medium text-foreground">
                    กะรวมกะเดียวกัน
                  </span>{" "}
                  (เปิด/ปิดกะจากเครื่องใดเครื่องหนึ่ง)
                </li>
                <li>
                  ใบเสร็จพิมพ์ผ่านเบราว์เซอร์ของแต่ละเครื่อง
                  (เลือกเครื่องพิมพ์ของเครื่องนั้นตอนกดพิมพ์)
                </li>
                <li>
                  ครั้งแรก Windows อาจถามอนุญาต Firewall ให้กด Allow —
                  ถ้าเชื่อมไม่ได้ให้รัน CMD แบบ Administrator:{" "}
                  <code className="rounded bg-muted px-1">
                    netsh advfirewall firewall add rule name=&quot;POS
                    Pump&quot; dir=in action=allow protocol=TCP localport=
                    {lanInfo?.port ?? 3210}
                  </code>
                </li>
                <li>
                  ใช้เฉพาะใน LAN ที่เชื่อถือได้เท่านั้น — เครื่องใน LAN
                  ทุกเครื่องเข้าถึงระบบได้ผ่านหน้าล็อกอิน
                </li>
              </ul>
            </div>
          )}
          <div>
            <Button
              disabled={!isAdmin || saveSettings.isPending}
              onClick={saveAll}
            >
              <Save className="w-4 h-4 mr-2" /> บันทึกการตั้งค่า{" "}
              {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* สินค้าและราคา */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Fuel className="w-4 h-4" /> สินค้า & ราคา
          </CardTitle>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditP({ ...emptyProduct })}
            >
              <Plus className="w-4 h-4 mr-1" /> เพิ่มสินค้า
            </Button>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>รหัส</TableHead>
                <TableHead>สินค้า</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead className="text-right">ทุน</TableHead>
                <TableHead className="text-right">ราคาขาย</TableHead>
                <TableHead className="text-right">สต๊อก</TableHead>
                <TableHead>สถานะ</TableHead>
                {isAdmin && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products ?? []).map(p => (
                <TableRow key={p.id} className={!p.active ? "opacity-50" : ""}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell>
                    {p.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({p.unit})
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {categoryLabel[p.category]}
                  </TableCell>
                  <TableCell className="text-right">
                    ฿{fmtMoney(p.cost)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-primary">
                    ฿{fmtMoney(p.price)}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.category === "fuel" ? "-" : `${fmtNum(p.stockQty)}`}
                  </TableCell>
                  <TableCell>
                    {p.active ? (
                      <Badge variant="secondary">ขายอยู่</Badge>
                    ) : (
                      <Badge variant="destructive">ปิดขาย</Badge>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="ประวัติเปลี่ยนราคา"
                          onClick={() => setHistP(p)}
                        >
                          <History className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="แก้ไข"
                          onClick={() => setEditP(p)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={deleteProduct.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `ยืนยันลบสินค้า "${p.name}"? (ประวัติขายเก่ายังคงอยู่)`
                              )
                            ) {
                              deleteProduct.mutate({ id: p.id });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* พนักงาน */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <UserCog className="w-4 h-4" /> พนักงาน
            </CardTitle>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowStaff(true)}
              >
                <Plus className="w-4 h-4 mr-1" /> เพิ่ม
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {(staffList ?? []).map(s => (
              <div
                key={s.id}
                className="flex items-center justify-between border rounded-lg px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">
                    {s.name}{" "}
                    {!s.active && (
                      <span className="text-xs text-destructive">
                        (ปิดใช้งาน)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    @{s.username}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={s.role === "admin" ? "default" : "secondary"}>
                    {roleLabel[s.role] ?? s.role}
                  </Badge>
                  {isAdmin && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() =>
                          setEditS({
                            id: s.id,
                            username: s.username,
                            name: s.name,
                            role: s.role,
                            pin: "",
                          })
                        }
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        disabled={deleteStaff.isPending}
                        onClick={() => {
                          if (confirm(`ยืนยันลบพนักงาน "${s.name}"?`))
                            deleteStaff.mutate({ id: s.id });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ของรางวัล */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Gift className="w-4 h-4" /> ของรางวัล
            </CardTitle>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEditR({ name: "", pointsRequired: 100, stock: 10 })
                }
              >
                <Plus className="w-4 h-4 mr-1" /> เพิ่ม
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {(rewards ?? []).map(r => (
              <div
                key={r.id}
                className="flex items-center justify-between border rounded-lg px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.pointsRequired} แต้ม · คงเหลือ {r.stock}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() =>
                        setEditR({
                          id: r.id,
                          name: r.name,
                          pointsRequired: r.pointsRequired,
                          stock: r.stock,
                        })
                      }
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      disabled={deleteReward.isPending}
                      onClick={() => {
                        if (confirm(`ยืนยันลบของรางวัล "${r.name}"?`))
                          deleteReward.mutate({ id: r.id });
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ตู้จ่าย / หัวจ่าย (admin) */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Gauge className="w-4 h-4" /> ตู้จ่าย & หัวจ่าย —
              ตั้งค่าถังตัดสต๊อก/ชื่อ/มิเตอร์ (admin)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(pumps ?? []).map(p => (
              <div key={p.id}>
                <div className="text-sm font-semibold mb-1.5">{p.name}</div>
                <div className="space-y-1.5">
                  {p.nozzles.map(n => (
                    <div
                      key={n.id}
                      className="flex flex-wrap items-center justify-between gap-2 border rounded-lg px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-medium">{n.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {n.product?.name} · ถัง:{" "}
                          {n.tank?.name ?? "ยังไม่ผูกถัง"}
                          {" · "}P: ฿{fmtNum(n.currentMoney)} · L:{" "}
                          {fmtNum(n.currentMeter)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditN({
                            id: n.id,
                            label: n.label,
                            productId: n.productId,
                            tankId: n.tankId,
                            meter: n.currentMeter,
                            money: n.currentMoney,
                          })
                        }
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" /> แก้ไข
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ฐานข้อมูล Supabase (admin) */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Database className="w-4 h-4" /> ฐานข้อมูล Supabase (admin)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">ผู้ให้บริการ: {dbInfo?.dbPath ?? "Supabase PostgreSQL"}</p>
            <p className="text-xs text-muted-foreground">
              {dbInfo?.managedBackupMessage ??
                "การสำรองข้อมูลและกู้คืนทำจาก Supabase Dashboard"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Dialog สินค้า */}
      <Dialog open={!!editP} onOpenChange={o => !o && setEditP(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editP?.id ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}
            </DialogTitle>
          </DialogHeader>
          {editP && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>รหัสสินค้า</Label>
                <Input
                  value={editP.code}
                  disabled={!!editP.id}
                  onChange={e => setEditP({ ...editP, code: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ชื่อสินค้า</Label>
                <Input
                  value={editP.name}
                  onChange={e => setEditP({ ...editP, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>หมวด</Label>
                <Select
                  value={editP.category}
                  onValueChange={v =>
                    setEditP({ ...editP, category: v as typeof editP.category })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fuel">น้ำมัน</SelectItem>
                    <SelectItem value="lubricant">2T/น้ำมันเครื่อง</SelectItem>
                    <SelectItem value="other">สินค้าอื่นๆ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>หน่วย</Label>
                <Input
                  value={editP.unit}
                  onChange={e => setEditP({ ...editP, unit: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ราคาขาย</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editP.price || ""}
                  onChange={e =>
                    setEditP({ ...editP, price: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>ต้นทุน</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editP.cost || ""}
                  onChange={e =>
                    setEditP({ ...editP, cost: Number(e.target.value) || 0 })
                  }
                />
              </div>
              {editP.category !== "fuel" && (
                <>
                  <div className="space-y-1.5">
                    <Label>สต๊อก</Label>
                    <Input
                      type="number"
                      value={editP.stockQty || ""}
                      onChange={e =>
                        setEditP({
                          ...editP,
                          stockQty: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>แจ้งเตือนเมื่อต่ำกว่า</Label>
                    <Input
                      type="number"
                      value={editP.lowStockAt || ""}
                      onChange={e =>
                        setEditP({
                          ...editP,
                          lowStockAt: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </>
              )}
              {editP.id && (
                <div className="col-span-2 flex items-center gap-2">
                  <Label>สถานะ:</Label>
                  <Button
                    size="sm"
                    variant={editP.active ? "outline" : "default"}
                    onClick={() =>
                      setEditP({ ...editP, active: !editP.active })
                    }
                  >
                    {editP.active ? "ปิดการขาย" : "เปิดการขาย"}
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !editP?.name ||
                !editP?.code ||
                saveProduct.isPending ||
                createProduct.isPending
              }
              onClick={() => {
                if (!editP) return;
                if (editP.id) {
                  saveProduct.mutate({
                    id: editP.id,
                    code: editP.code,
                    name: editP.name,
                    category: editP.category,
                    unit: editP.unit,
                    price: editP.price,
                    cost: editP.cost,
                    stockQty: editP.stockQty,
                    lowStockAt: editP.lowStockAt,
                    active: editP.active,
                  });
                } else {
                  createProduct.mutate({
                    code: editP.code,
                    name: editP.name,
                    category: editP.category,
                    unit: editP.unit,
                    price: editP.price,
                    cost: editP.cost,
                    stockQty: editP.stockQty,
                    lowStockAt: editP.lowStockAt,
                  });
                }
              }}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog ประวัติเปลี่ยนราคา */}
      <Dialog open={!!histP} onOpenChange={o => !o && setHistP(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">
              ประวัติเปลี่ยนราคา — {histP?.name}
            </DialogTitle>
          </DialogHeader>
          {(priceHist ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              ยังไม่มีการเปลี่ยนราคา
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่เวลา</TableHead>
                    <TableHead className="text-right">ราคาเดิม</TableHead>
                    <TableHead className="text-right">ราคาใหม่</TableHead>
                    <TableHead>ผู้เปลี่ยน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(priceHist ?? []).map(h => (
                    <TableRow key={h.id}>
                      <TableCell className="text-sm">
                        {fmtDateTime(h.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{fmtMoney(h.oldPrice)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-primary">
                        ฿{fmtMoney(h.newPrice)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {h.changedBy || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog พนักงาน */}
      <Dialog open={showStaff} onOpenChange={setShowStaff}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">เพิ่มพนักงาน</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>ชื่อ-นามสกุล</Label>
              <Input
                value={newStaff.name}
                onChange={e =>
                  setNewStaff({ ...newStaff, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>ชื่อผู้ใช้</Label>
              <Input
                value={newStaff.username}
                onChange={e =>
                  setNewStaff({ ...newStaff, username: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>รหัส PIN (อย่างน้อย 4 หลัก)</Label>
              <Input
                type="password"
                value={newStaff.pin}
                onChange={e =>
                  setNewStaff({ ...newStaff, pin: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>สิทธิ์</Label>
              <Select
                value={newStaff.role}
                onValueChange={v =>
                  setNewStaff({
                    ...newStaff,
                    role: v as "admin" | "manager" | "cashier",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">พนักงานขาย</SelectItem>
                  <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                  <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !newStaff.name ||
                newStaff.username.length < 3 ||
                newStaff.pin.length < 4 ||
                createStaff.isPending
              }
              onClick={() => createStaff.mutate(newStaff)}
            >
              เพิ่มพนักงาน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขพนักงาน */}
      <Dialog open={!!editS} onOpenChange={o => !o && setEditS(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">แก้ไขพนักงาน</DialogTitle>
          </DialogHeader>
          {editS && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อ-นามสกุล</Label>
                <Input
                  value={editS.name}
                  onChange={e => setEditS({ ...editS, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ชื่อผู้ใช้</Label>
                <Input
                  value={editS.username}
                  onChange={e =>
                    setEditS({ ...editS, username: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>รหัส PIN ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)</Label>
                <Input
                  type="password"
                  value={editS.pin}
                  onChange={e => setEditS({ ...editS, pin: e.target.value })}
                  placeholder="••••"
                />
              </div>
              <div className="space-y-1.5">
                <Label>สิทธิ์</Label>
                <Select
                  value={editS.role}
                  onValueChange={v =>
                    setEditS({
                      ...editS,
                      role: v as "admin" | "manager" | "cashier",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cashier">พนักงานขาย</SelectItem>
                    <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                    <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!editS?.name || updateStaff.isPending}
              onClick={() =>
                editS &&
                updateStaff.mutate({
                  id: editS.id,
                  name: editS.name,
                  username: editS.username,
                  role: editS.role,
                  ...(editS.pin ? { pin: editS.pin } : {}),
                })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขหัวจ่าย */}
      <Dialog open={!!editN} onOpenChange={o => !o && setEditN(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">แก้ไขหัวจ่าย</DialogTitle>
          </DialogHeader>
          {editN && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อหัวจ่าย</Label>
                <Input
                  value={editN.label}
                  onChange={e => setEditN({ ...editN, label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ชนิดน้ำมันที่จ่าย</Label>
                <Select
                  value={String(editN.productId)}
                  onValueChange={v => {
                    const productId = Number(v);
                    const firstTank = (tanks ?? []).find(
                      tank => tank.productId === productId
                    );
                    setEditN({
                      ...editN,
                      productId,
                      tankId: firstTank?.id ?? null,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(products ?? [])
                      .filter(p => p.category === "fuel" && p.active)
                      .map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} ({p.code})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>ถังน้ำมันที่ตัดสต๊อก</Label>
                <Select
                  value={
                    editN.tankId != null ? String(editN.tankId) : undefined
                  }
                  onValueChange={v => setEditN({ ...editN, tankId: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกถังน้ำมัน" />
                  </SelectTrigger>
                  <SelectContent>
                    {(tanks ?? [])
                      .filter(tank => tank.productId === editN.productId)
                      .map(tank => (
                        <SelectItem key={tank.id} value={String(tank.id)}>
                          {tank.name} (คงเหลือ {fmtNum(tank.currentLiters)}{" "}
                          ลิตร)
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {(tanks ?? []).filter(
                  tank => tank.productId === editN.productId
                ).length === 0 && (
                  <p className="text-xs text-destructive">
                    ยังไม่มีถังสำหรับน้ำมันชนิดนี้ กรุณาเพิ่มถังในหน้า “สต๊อก”
                    ก่อน
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>มิเตอร์ P ปัจจุบัน (บาทสะสม)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editN.money}
                  onChange={e =>
                    setEditN({ ...editN, money: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>มิเตอร์ L ปัจจุบัน (ลิตรสะสม)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editN.meter}
                  onChange={e =>
                    setEditN({ ...editN, meter: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <p className="text-xs text-amber-600">
                ⚠️ แก้มิเตอร์เฉพาะกรณีค่าในระบบไม่ตรงกับหน้าตู้จ่ายจริง
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !editN?.label || editN.tankId == null || updateNozzle.isPending
              }
              onClick={() =>
                editN &&
                updateNozzle.mutate({
                  id: editN.id,
                  label: editN.label,
                  productId: editN.productId,
                  tankId: editN.tankId!,
                  meter: editN.meter,
                  money: editN.money,
                })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog ของรางวัล */}
      <Dialog open={!!editR} onOpenChange={o => !o && setEditR(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editR?.id ? "แก้ไขของรางวัล" : "เพิ่มของรางวัล"}
            </DialogTitle>
          </DialogHeader>
          {editR && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อของรางวัล</Label>
                <Input
                  value={editR.name}
                  onChange={e => setEditR({ ...editR, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>แต้มที่ใช้แลก</Label>
                <Input
                  type="number"
                  value={editR.pointsRequired || ""}
                  onChange={e =>
                    setEditR({
                      ...editR,
                      pointsRequired: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>จำนวนคงเหลือ</Label>
                <Input
                  type="number"
                  value={editR.stock || ""}
                  onChange={e =>
                    setEditR({ ...editR, stock: Number(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!editR?.name || saveReward.isPending}
              onClick={() =>
                editR && saveReward.mutate({ ...editR, active: true })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
