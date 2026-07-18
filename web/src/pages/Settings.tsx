import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Settings as SettingsIcon, Store, Fuel, UserCog, Plus, Pencil, Gift, Trash2, Gauge, FileText, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { fmtMoney, fmtNum, categoryLabel, roleLabel } from "@/lib/format";
import type { Product } from "@db/schema";

const emptyProduct = {
  code: "", name: "", category: "other" as "fuel" | "lubricant" | "other",
  unit: "ชิ้น", price: 0, cost: 0, stockQty: 0, lowStockAt: 0,
};

export default function Settings() {
  const { staff } = useStaff();
  const utils = trpc.useUtils();
  const isAdmin = staff?.role === "admin";

  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: shopLogo } = trpc.catalog.getShopLogo.useQuery();
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const { data: staffList } = trpc.auth.listStaff.useQuery();
  const { data: rewards } = trpc.membership.listRewards.useQuery();
  const { data: pumps } = trpc.catalog.listPumps.useQuery();

  const [form, setForm] = useState<Record<string, string>>({});
  const [logoData, setLogoData] = useState<string | null>(null); // null=ไม่เปลี่ยน, ""=ลบโลโก้, อื่นๆ=data URL ใหม่
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [editP, setEditP] = useState<(Partial<Product> & typeof emptyProduct) | null>(null);
  const [showStaff, setShowStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ username: "", pin: "", name: "", role: "cashier" as "admin" | "manager" | "cashier" });
  const [editS, setEditS] = useState<{ id: number; username: string; name: string; role: "admin" | "manager" | "cashier"; pin: string } | null>(null);
  const [editN, setEditN] = useState<{ id: number; label: string; productId: number; meter: number; money: number } | null>(null);
  const [editR, setEditR] = useState<{ id?: number; name: string; pointsRequired: number; stock: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (settingMap) setForm(settingMap);
  }, [settingMap]);

  const ok = (m: string) => { setMsg(m); setErr(""); setTimeout(() => setMsg(""), 3000); };
  const fail = (m: string) => { setErr(m); setMsg(""); };

  const saveSettings = trpc.catalog.updateSettings.useMutation({
    onSuccess: () => {
      utils.catalog.getSettings.invalidate();
      utils.catalog.getShopLogo.invalidate();
      setLogoData(null);
      ok("บันทึกการตั้งค่าแล้ว");
    },
    onError: (e) => fail(e.message),
  });
  const saveProduct = trpc.catalog.updateProduct.useMutation({
    onSuccess: () => { utils.catalog.listProducts.invalidate(); setEditP(null); ok("บันทึกสินค้าแล้ว"); },
    onError: (e) => fail(e.message),
  });
  const createProduct = trpc.catalog.createProduct.useMutation({
    onSuccess: () => { utils.catalog.listProducts.invalidate(); setEditP(null); ok("เพิ่มสินค้าแล้ว"); },
    onError: (e) => fail(e.message),
  });
  const createStaff = trpc.auth.createStaff.useMutation({
    onSuccess: () => { utils.auth.listStaff.invalidate(); setShowStaff(false); setNewStaff({ username: "", pin: "", name: "", role: "cashier" }); ok("เพิ่มพนักงานแล้ว"); },
    onError: (e) => fail(e.message),
  });
  const updateStaff = trpc.auth.updateStaff.useMutation({
    onSuccess: () => { utils.auth.listStaff.invalidate(); setEditS(null); ok("แก้ไขพนักงานแล้ว"); },
    onError: (e) => fail(e.message),
  });
  const deleteStaff = trpc.auth.deleteStaff.useMutation({
    onSuccess: () => { utils.auth.listStaff.invalidate(); ok("ลบพนักงานแล้ว"); },
    onError: (e) => fail(e.message),
  });
  const deleteProduct = trpc.catalog.deleteProduct.useMutation({
    onSuccess: () => { utils.catalog.listProducts.invalidate(); ok("ลบสินค้าแล้ว"); },
    onError: (e) => fail(e.message),
  });
  const deleteReward = trpc.membership.deleteReward.useMutation({
    onSuccess: () => { utils.membership.listRewards.invalidate(); ok("ลบของรางวัลแล้ว"); },
    onError: (e) => fail(e.message),
  });
  const updateNozzle = trpc.catalog.updateNozzleMeter.useMutation({
    onSuccess: () => { utils.catalog.listPumps.invalidate(); setEditN(null); ok("แก้ไขหัวจ่ายแล้ว"); },
    onError: (e) => fail(e.message),
  });
  const saveReward = trpc.membership.upsertReward.useMutation({
    onSuccess: () => { utils.membership.listRewards.invalidate(); setEditR(null); ok("บันทึกของรางวัลแล้ว"); },
    onError: (e) => fail(e.message),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // เลขถัดไปของเอกสาร: ส่งเฉพาะเมื่อแก้จากค่าที่โหลดมาจริงๆ
  // กันตัวนับถอยหลังกรณีมีการออกเอกสารระหว่างที่เปิดหน้านี้ค้างไว้
  const COUNTER_KEYS = ["receipt_next_no", "tax_invoice_next_no"];
  const saveAll = () => {
    const entries = Object.entries(form)
      .filter(([k, v]) => !COUNTER_KEYS.includes(k) || v !== (settingMap?.[k] ?? ""))
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
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setLogoData(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const nextPreview = (prefix: string | undefined, next: string | undefined, fallback: string) =>
    `${prefix || fallback}${String(Math.max(1, Number(next ?? "1") || 1)).padStart(5, "0")}`;

  const logoShown = logoData !== null ? logoData : (shopLogo ?? "");

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold flex items-center gap-2">
        <SettingsIcon className="w-6 h-6 text-primary" /> ตั้งค่าระบบ
      </h1>
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* ข้อมูลร้าน */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2"><Store className="w-4 h-4" /> ข้อมูลร้าน (แสดงบนใบเสร็จ/ใบกำกับภาษี)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>ชื่อร้าน</Label>
            <Input value={form.shop_name ?? ""} onChange={(e) => set("shop_name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>สาขา</Label>
            <Input value={form.shop_branch ?? ""} onChange={(e) => set("shop_branch", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ที่อยู่</Label>
            <Textarea rows={2} value={form.shop_address ?? ""} onChange={(e) => set("shop_address", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>เลขประจำตัวผู้เสียภาษี</Label>
            <Input value={form.tax_id ?? ""} onChange={(e) => set("tax_id", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>โทรศัพท์</Label>
            <Input value={form.shop_phone ?? ""} onChange={(e) => set("shop_phone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>อัตรา VAT (%)</Label>
            <Input type="number" value={form.vat_rate ?? "7"} onChange={(e) => set("vat_rate", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>สะสมแต้ม (กี่บาท = 1 แต้ม)</Label>
            <Input type="number" value={form.point_earn_per_baht ?? "25"} onChange={(e) => set("point_earn_per_baht", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>มูลค่าแต้มตอนใช้ (1 แต้ม = กี่บาท)</Label>
            <Input type="number" value={form.point_redeem_value ?? "1"} onChange={(e) => set("point_redeem_value", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Button disabled={!isAdmin || saveSettings.isPending} onClick={saveAll}>
              บันทึกการตั้งค่า {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* เลขที่เอกสาร & โลโก้ร้าน */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2"><FileText className="w-4 h-4" /> เลขที่เอกสาร & โลโก้ร้าน</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>คำนำหน้าเลขใบเสร็จอย่างย่อ</Label>
            <Input maxLength={10} value={form.receipt_prefix ?? "R"} onChange={(e) => set("receipt_prefix", e.target.value)} />
            <p className="text-xs text-muted-foreground">เอกสารถัดไป: {nextPreview(form.receipt_prefix, form.receipt_next_no, "R")}</p>
          </div>
          <div className="space-y-1.5">
            <Label>เลขถัดไปใบเสร็จอย่างย่อ</Label>
            <Input type="number" min={1} value={form.receipt_next_no ?? "1"} onChange={(e) => set("receipt_next_no", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>คำนำหน้าเลขใบกำกับภาษี</Label>
            <Input maxLength={10} value={form.tax_invoice_prefix ?? "T"} onChange={(e) => set("tax_invoice_prefix", e.target.value)} />
            <p className="text-xs text-muted-foreground">เอกสารถัดไป: {nextPreview(form.tax_invoice_prefix, form.tax_invoice_next_no, "T")}</p>
          </div>
          <div className="space-y-1.5">
            <Label>เลขถัดไปใบกำกับภาษี</Label>
            <Input type="number" min={1} value={form.tax_invoice_next_no ?? "1"} onChange={(e) => set("tax_invoice_next_no", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>โลโก้ร้าน (แสดงบนใบเสร็จ/ใบกำกับภาษี)</Label>
            <div className="flex items-center gap-3 flex-wrap">
              {logoShown ? (
                <img src={logoShown} alt="โลโก้ร้าน" className="h-14 w-auto object-contain border rounded p-1 bg-white" />
              ) : (
                <div className="h-14 w-28 border border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">
                  ยังไม่มีโลโก้
                </div>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={!isAdmin} onClick={() => logoInputRef.current?.click()}>
                  <ImagePlus className="w-4 h-4 mr-1" /> เลือกรูป
                </Button>
                {logoShown && (
                  <Button type="button" variant="ghost" size="sm" disabled={!isAdmin} onClick={() => setLogoData("")}>
                    ลบโลโก้
                  </Button>
                )}
              </div>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={onLogoFile} />
            </div>
            <p className="text-xs text-muted-foreground">รองรับไฟล์รูปไม่เกิน 2MB (ระบบย่อขนาดให้อัตโนมัติ) · กดบันทึกเพื่อยืนยัน</p>
          </div>
          <div className="sm:col-span-2">
            <Button disabled={!isAdmin || saveSettings.isPending} onClick={saveAll}>
              บันทึกการตั้งค่า {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* สินค้าและราคา */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="font-heading text-base flex items-center gap-2"><Fuel className="w-4 h-4" /> สินค้า & ราคา</CardTitle>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setEditP({ ...emptyProduct })}>
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
              {(products ?? []).map((p) => (
                <TableRow key={p.id} className={!p.active ? "opacity-50" : ""}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell>{p.name} <span className="text-xs text-muted-foreground">({p.unit})</span></TableCell>
                  <TableCell className="text-xs">{categoryLabel[p.category]}</TableCell>
                  <TableCell className="text-right">฿{fmtMoney(p.cost)}</TableCell>
                  <TableCell className="text-right font-semibold text-primary">฿{fmtMoney(p.price)}</TableCell>
                  <TableCell className="text-right">{p.category === "fuel" ? "-" : `${fmtNum(p.stockQty)}`}</TableCell>
                  <TableCell>{p.active ? <Badge variant="secondary">ขายอยู่</Badge> : <Badge variant="destructive">ปิดขาย</Badge>}</TableCell>
                  {isAdmin && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditP(p)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                          disabled={deleteProduct.isPending}
                          onClick={() => {
                            if (confirm(`ยืนยันลบสินค้า "${p.name}"? (ประวัติขายเก่ายังคงอยู่)`)) {
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
            <CardTitle className="font-heading text-base flex items-center gap-2"><UserCog className="w-4 h-4" /> พนักงาน</CardTitle>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setShowStaff(true)}>
                <Plus className="w-4 h-4 mr-1" /> เพิ่ม
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {(staffList ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{s.name} {!s.active && <span className="text-xs text-destructive">(ปิดใช้งาน)</span>}</div>
                  <div className="text-xs text-muted-foreground">@{s.username}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={s.role === "admin" ? "default" : "secondary"}>
                    {roleLabel[s.role] ?? s.role}
                  </Badge>
                  {isAdmin && (
                    <>
                      <Button size="icon" variant="ghost" className="h-8 w-8"
                        onClick={() => setEditS({ id: s.id, username: s.username, name: s.name, role: s.role, pin: "" })}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                        disabled={deleteStaff.isPending}
                        onClick={() => {
                          if (confirm(`ยืนยันลบพนักงาน "${s.name}"?`)) deleteStaff.mutate({ id: s.id });
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
            <CardTitle className="font-heading text-base flex items-center gap-2"><Gift className="w-4 h-4" /> ของรางวัล</CardTitle>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setEditR({ name: "", pointsRequired: 100, stock: 10 })}>
                <Plus className="w-4 h-4 mr-1" /> เพิ่ม
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {(rewards ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.pointsRequired} แต้ม · คงเหลือ {r.stock}</div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8"
                      onClick={() => setEditR({ id: r.id, name: r.name, pointsRequired: r.pointsRequired, stock: r.stock })}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                      disabled={deleteReward.isPending}
                      onClick={() => {
                        if (confirm(`ยืนยันลบของรางวัล "${r.name}"?`)) deleteReward.mutate({ id: r.id });
                      }}>
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
              <Gauge className="w-4 h-4" /> ตู้จ่าย & หัวจ่าย — แก้ไขชื่อ/มิเตอร์ (admin)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(pumps ?? []).map((p) => (
              <div key={p.id}>
                <div className="text-sm font-semibold mb-1.5">{p.name}</div>
                <div className="space-y-1.5">
                  {p.nozzles.map((n) => (
                    <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">{n.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {n.product?.name} · P: ฿{fmtNum(n.currentMoney)} · L: {fmtNum(n.currentMeter)}
                        </div>
                      </div>
                      <Button size="sm" variant="outline"
                        onClick={() => setEditN({ id: n.id, label: n.label, productId: n.productId, meter: n.currentMeter, money: n.currentMoney })}>
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

      {/* Dialog สินค้า */}
      <Dialog open={!!editP} onOpenChange={(o) => !o && setEditP(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">{editP?.id ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</DialogTitle>
          </DialogHeader>
          {editP && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>รหัสสินค้า</Label>
                <Input value={editP.code} disabled={!!editP.id} onChange={(e) => setEditP({ ...editP, code: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>ชื่อสินค้า</Label>
                <Input value={editP.name} onChange={(e) => setEditP({ ...editP, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>หมวด</Label>
                <Select value={editP.category} onValueChange={(v) => setEditP({ ...editP, category: v as typeof editP.category })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fuel">น้ำมัน</SelectItem>
                    <SelectItem value="lubricant">2T/น้ำมันเครื่อง</SelectItem>
                    <SelectItem value="other">สินค้าอื่นๆ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>หน่วย</Label>
                <Input value={editP.unit} onChange={(e) => setEditP({ ...editP, unit: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>ราคาขาย</Label>
                <Input type="number" step="0.01" value={editP.price || ""} onChange={(e) => setEditP({ ...editP, price: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>ต้นทุน</Label>
                <Input type="number" step="0.01" value={editP.cost || ""} onChange={(e) => setEditP({ ...editP, cost: Number(e.target.value) || 0 })} />
              </div>
              {editP.category !== "fuel" && (
                <>
                  <div className="space-y-1.5">
                    <Label>สต๊อก</Label>
                    <Input type="number" value={editP.stockQty || ""} onChange={(e) => setEditP({ ...editP, stockQty: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>แจ้งเตือนเมื่อต่ำกว่า</Label>
                    <Input type="number" value={editP.lowStockAt || ""} onChange={(e) => setEditP({ ...editP, lowStockAt: Number(e.target.value) || 0 })} />
                  </div>
                </>
              )}
              {editP.id && (
                <div className="col-span-2 flex items-center gap-2">
                  <Label>สถานะ:</Label>
                  <Button
                    size="sm" variant={editP.active ? "outline" : "default"}
                    onClick={() => setEditP({ ...editP, active: !editP.active })}
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
              disabled={!editP?.name || !editP?.code || saveProduct.isPending || createProduct.isPending}
              onClick={() => {
                if (!editP) return;
                if (editP.id) {
                  saveProduct.mutate({
                    id: editP.id, code: editP.code, name: editP.name, category: editP.category,
                    unit: editP.unit, price: editP.price, cost: editP.cost,
                    stockQty: editP.stockQty, lowStockAt: editP.lowStockAt, active: editP.active,
                  });
                } else {
                  createProduct.mutate({
                    code: editP.code, name: editP.name, category: editP.category,
                    unit: editP.unit, price: editP.price, cost: editP.cost,
                    stockQty: editP.stockQty, lowStockAt: editP.lowStockAt,
                  });
                }
              }}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog พนักงาน */}
      <Dialog open={showStaff} onOpenChange={setShowStaff}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">เพิ่มพนักงาน</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>ชื่อ-นามสกุล</Label>
              <Input value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>ชื่อผู้ใช้</Label>
              <Input value={newStaff.username} onChange={(e) => setNewStaff({ ...newStaff, username: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>รหัส PIN (อย่างน้อย 4 หลัก)</Label>
              <Input type="password" value={newStaff.pin} onChange={(e) => setNewStaff({ ...newStaff, pin: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>สิทธิ์</Label>
              <Select value={newStaff.role} onValueChange={(v) => setNewStaff({ ...newStaff, role: v as "admin" | "manager" | "cashier" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">พนักงานขาย</SelectItem>
                  <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                  <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full"
              disabled={!newStaff.name || newStaff.username.length < 3 || newStaff.pin.length < 4 || createStaff.isPending}
              onClick={() => createStaff.mutate(newStaff)}>
              เพิ่มพนักงาน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขพนักงาน */}
      <Dialog open={!!editS} onOpenChange={(o) => !o && setEditS(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">แก้ไขพนักงาน</DialogTitle></DialogHeader>
          {editS && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อ-นามสกุล</Label>
                <Input value={editS.name} onChange={(e) => setEditS({ ...editS, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>ชื่อผู้ใช้</Label>
                <Input value={editS.username} onChange={(e) => setEditS({ ...editS, username: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>รหัส PIN ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)</Label>
                <Input type="password" value={editS.pin} onChange={(e) => setEditS({ ...editS, pin: e.target.value })} placeholder="••••" />
              </div>
              <div className="space-y-1.5">
                <Label>สิทธิ์</Label>
                <Select value={editS.role} onValueChange={(v) => setEditS({ ...editS, role: v as "admin" | "manager" | "cashier" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
            <Button className="w-full" disabled={!editS?.name || updateStaff.isPending}
              onClick={() =>
                editS &&
                updateStaff.mutate({
                  id: editS.id,
                  name: editS.name,
                  username: editS.username,
                  role: editS.role,
                  ...(editS.pin ? { pin: editS.pin } : {}),
                })
              }>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขหัวจ่าย */}
      <Dialog open={!!editN} onOpenChange={(o) => !o && setEditN(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">แก้ไขหัวจ่าย</DialogTitle></DialogHeader>
          {editN && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อหัวจ่าย</Label>
                <Input value={editN.label} onChange={(e) => setEditN({ ...editN, label: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>สินค้าที่จ่าย (ผูกกับราคา/ถัง/มิเตอร์)</Label>
                <Select value={String(editN.productId)} onValueChange={(v) => setEditN({ ...editN, productId: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(products ?? []).map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} ({p.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>มิเตอร์ P ปัจจุบัน (บาทสะสม)</Label>
                <Input type="number" step="0.01" value={editN.money} onChange={(e) => setEditN({ ...editN, money: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>มิเตอร์ L ปัจจุบัน (ลิตรสะสม)</Label>
                <Input type="number" step="0.01" value={editN.meter} onChange={(e) => setEditN({ ...editN, meter: Number(e.target.value) || 0 })} />
              </div>
              <p className="text-xs text-amber-600">⚠️ แก้มิเตอร์เฉพาะกรณีค่าในระบบไม่ตรงกับหน้าตู้จ่ายจริง</p>
            </div>
          )}
          <DialogFooter>
            <Button className="w-full" disabled={!editN?.label || updateNozzle.isPending}
              onClick={() =>
                editN && updateNozzle.mutate({ id: editN.id, label: editN.label, productId: editN.productId, meter: editN.meter, money: editN.money })
              }>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog ของรางวัล */}
      <Dialog open={!!editR} onOpenChange={(o) => !o && setEditR(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">{editR?.id ? "แก้ไขของรางวัล" : "เพิ่มของรางวัล"}</DialogTitle></DialogHeader>
          {editR && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อของรางวัล</Label>
                <Input value={editR.name} onChange={(e) => setEditR({ ...editR, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>แต้มที่ใช้แลก</Label>
                <Input type="number" value={editR.pointsRequired || ""} onChange={(e) => setEditR({ ...editR, pointsRequired: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>จำนวนคงเหลือ</Label>
                <Input type="number" value={editR.stock || ""} onChange={(e) => setEditR({ ...editR, stock: Number(e.target.value) || 0 })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button className="w-full" disabled={!editR?.name || saveReward.isPending}
              onClick={() => editR && saveReward.mutate({ ...editR, active: true })}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
