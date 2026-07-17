import { useState } from "react";
import { Fuel, Package, PlusCircle, AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { fmtMoney, fmtNum, fmtDateTime, categoryLabel } from "@/lib/format";
import type { Product } from "@db/schema";

export default function Stock() {
  const utils = trpc.useUtils();
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const { data: tanks } = trpc.catalog.listTanks.useQuery();
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const { data: refills } = trpc.catalog.listRefills.useQuery();

  const [refillTank, setRefillTank] = useState<{ id: number; name: string } | null>(null);
  const [liters, setLiters] = useState("");
  const [cost, setCost] = useState("");
  const [adjustP, setAdjustP] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [editTank, setEditTank] = useState<{ id: number; name: string; currentLiters: number; capacityLiters: number; lowAlertAt: number } | null>(null);
  const [addTank, setAddTank] = useState<{ name: string; productId: string; capacityLiters: string; currentLiters: string; lowAlertAt: string } | null>(null);
  const [err, setErr] = useState("");

  const createTankMut = trpc.catalog.createTank.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      setAddTank(null); setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  const deleteTankMut = trpc.catalog.deleteTank.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      utils.catalog.listRefills.invalidate();
      setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  const updateTankMut = trpc.catalog.updateTank.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      setEditTank(null); setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  const refillMut = trpc.catalog.refillTank.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      utils.catalog.listRefills.invalidate();
      setRefillTank(null); setLiters(""); setCost(""); setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  const adjustMut = trpc.catalog.adjustStock.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      setAdjustP(null); setAdjustQty(""); setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  const goods = (products ?? []).filter((p) => p.category !== "fuel");
  const fuelProducts = (products ?? []).filter((p) => p.category === "fuel" && p.active);

  const addTankValid =
    !!addTank &&
    addTank.name.trim() !== "" &&
    addTank.productId !== "" &&
    Number(addTank.capacityLiters) > 0 &&
    Number(addTank.currentLiters) >= 0 &&
    Number(addTank.currentLiters) <= Number(addTank.capacityLiters);

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold">สต๊อก & ถังน้ำมัน</h1>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* ถังน้ำมัน */}
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
          <Fuel className="w-5 h-5 text-primary" /> ถังน้ำมัน
        </h2>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() => setAddTank({ name: "", productId: "", capacityLiters: "", currentLiters: "0", lowAlertAt: "" })}
          >
            <Plus className="w-4 h-4 mr-1" /> เพิ่มถังน้ำมัน
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(tanks ?? []).map((t) => (
          <Card key={t.id} className={t.isLow ? "border-destructive" : ""}>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <Fuel className="w-4 h-4 text-primary" /> {t.name}
              </CardTitle>
              {t.isLow && (
                <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> ต่ำกว่าเกณฑ์</Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-center">
                <div className={`font-heading text-3xl font-bold ${t.isLow ? "text-destructive" : "text-primary"}`}>
                  {t.percent}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtNum(t.currentLiters)} / {fmtNum(t.capacityLiters)} ลิตร
                </div>
              </div>
              <Progress value={t.percent} className={t.isLow ? "[&>div]:bg-destructive" : ""} />
              <Button size="sm" variant="outline" className="w-full" onClick={() => setRefillTank({ id: t.id, name: t.name })}>
                <PlusCircle className="w-4 h-4 mr-1" /> รับน้ำมันเข้าถัง
              </Button>
              {isAdmin && (
                <div className="flex gap-2">
                  <Button
                    size="sm" variant="secondary" className="flex-1"
                    onClick={() => setEditTank({ id: t.id, name: t.name, currentLiters: t.currentLiters, capacityLiters: t.capacityLiters, lowAlertAt: t.lowAlertAt })}
                  >
                    <Pencil className="w-4 h-4 mr-1" /> แก้ไขถัง
                  </Button>
                  <Button
                    size="sm" variant="outline" className="text-destructive"
                    disabled={deleteTankMut.isPending}
                    onClick={() => {
                      if (confirm(`ยืนยันลบ "${t.name}"? ประวัติรับน้ำมันเข้าถังนี้จะถูกลบไปด้วย`)) {
                        deleteTankMut.mutate({ id: t.id });
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* สต๊อกสินค้า */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Package className="w-4 h-4" /> สต๊อกสินค้า (2T / น้ำมันเครื่อง / อื่นๆ)
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>รหัส</TableHead>
                <TableHead>สินค้า</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead className="text-right">ราคาขาย</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {goods.map((p) => {
                const low = p.stockQty <= p.lowStockAt;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-xs">{categoryLabel[p.category]}</TableCell>
                    <TableCell className="text-right">฿{fmtMoney(p.price)}</TableCell>
                    <TableCell className={`text-right font-semibold ${low ? "text-destructive" : ""}`}>
                      {fmtNum(p.stockQty)} {p.unit}
                    </TableCell>
                    <TableCell>{low ? <Badge variant="destructive">ใกล้หมด</Badge> : <Badge variant="secondary">ปกติ</Badge>}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => { setAdjustP(p); setAdjustQty(""); }}>ปรับสต๊อก</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ประวัติรับน้ำมัน */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">ประวัติรับน้ำมันเข้าถัง</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันที่</TableHead>
                <TableHead>ถัง</TableHead>
                <TableHead className="text-right">ลิตร</TableHead>
                <TableHead className="text-right">ต้นทุน/ลิตร</TableHead>
                <TableHead className="text-right">รวมต้นทุน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(refills ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDateTime(r.createdAt)}</TableCell>
                  <TableCell>{r.tank?.name ?? "-"}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.liters)}</TableCell>
                  <TableCell className="text-right">฿{fmtMoney(r.costPerLiter)}</TableCell>
                  <TableCell className="text-right">฿{fmtMoney(r.liters * r.costPerLiter)}</TableCell>
                </TableRow>
              ))}
              {(refills ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">ยังไม่มีประวัติ</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog รับน้ำมัน */}
      <Dialog open={!!refillTank} onOpenChange={(o) => !o && setRefillTank(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">รับน้ำมันเข้า{refillTank?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>จำนวนลิตรที่รับเข้า</Label>
              <Input type="number" min={0} value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="เช่น 10000" />
            </div>
            <div className="space-y-1.5">
              <Label>ต้นทุนต่อลิตร (บาท)</Label>
              <Input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="เช่น 39.20" />
            </div>
          </div>
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!Number(liters) || refillMut.isPending}
              onClick={() => refillMut.mutate({ tankId: refillTank!.id, liters: Number(liters), costPerLiter: Number(cost) || 0 })}
            >
              บันทึกรับเข้า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขถัง (admin) */}
      <Dialog open={!!editTank} onOpenChange={(o) => !o && setEditTank(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">แก้ไขถังน้ำมัน</DialogTitle>
          </DialogHeader>
          {editTank && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อถัง</Label>
                <Input value={editTank.name}
                  onChange={(e) => setEditTank({ ...editTank, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>ระดับน้ำมันปัจจุบัน (ลิตร)</Label>
                <Input type="number" min={0} value={editTank.currentLiters}
                  onChange={(e) => setEditTank({ ...editTank, currentLiters: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>ความจุถัง (ลิตร)</Label>
                <Input type="number" min={1} value={editTank.capacityLiters}
                  onChange={(e) => setEditTank({ ...editTank, capacityLiters: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>แจ้งเตือนเมื่อต่ำกว่า (ลิตร)</Label>
                <Input type="number" min={0} value={editTank.lowAlertAt}
                  onChange={(e) => setEditTank({ ...editTank, lowAlertAt: Number(e.target.value) || 0 })} />
              </div>
              <p className="text-xs text-amber-600">⚠️ ใช้สำหรับแก้ค่าคลาดเคลื่อนหรือหลังสอบเทียบถังเท่านั้น — การรับน้ำมันปกติให้ใช้ปุ่ม "รับน้ำมันเข้าถัง"</p>
            </div>
          )}
          <DialogFooter>
            <Button className="w-full" disabled={updateTankMut.isPending || !editTank?.name.trim()}
              onClick={() =>
                editTank &&
                updateTankMut.mutate({
                  id: editTank.id,
                  name: editTank.name.trim(),
                  currentLiters: editTank.currentLiters,
                  capacityLiters: editTank.capacityLiters,
                  lowAlertAt: editTank.lowAlertAt,
                })
              }>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog เพิ่มถังน้ำมัน (admin) */}
      <Dialog open={!!addTank} onOpenChange={(o) => !o && setAddTank(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">เพิ่มถังน้ำมัน</DialogTitle>
          </DialogHeader>
          {addTank && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อถัง</Label>
                <Input value={addTank.name} placeholder="เช่น ถัง GSH95"
                  onChange={(e) => setAddTank({ ...addTank, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>ชนิดน้ำมัน (สินค้า)</Label>
                <Select value={addTank.productId} onValueChange={(v) => setAddTank({ ...addTank, productId: v })}>
                  <SelectTrigger><SelectValue placeholder="เลือกชนิดน้ำมัน" /></SelectTrigger>
                  <SelectContent>
                    {fuelProducts.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>ความจุถัง (ลิตร)</Label>
                <Input type="number" min={1} value={addTank.capacityLiters} placeholder="เช่น 20000"
                  onChange={(e) => setAddTank({ ...addTank, capacityLiters: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>ระดับน้ำมันเริ่มต้น (ลิตร)</Label>
                <Input type="number" min={0} value={addTank.currentLiters}
                  onChange={(e) => setAddTank({ ...addTank, currentLiters: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>แจ้งเตือนเมื่อต่ำกว่า (ลิตร)</Label>
                <Input type="number" min={0} value={addTank.lowAlertAt} placeholder="เช่น 4000"
                  onChange={(e) => setAddTank({ ...addTank, lowAlertAt: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!addTankValid || createTankMut.isPending}
              onClick={() =>
                addTank &&
                createTankMut.mutate({
                  name: addTank.name.trim(),
                  productId: Number(addTank.productId),
                  capacityLiters: Number(addTank.capacityLiters),
                  currentLiters: Number(addTank.currentLiters) || 0,
                  lowAlertAt: Number(addTank.lowAlertAt) || 0,
                })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog ปรับสต๊อก */}
      <Dialog open={!!adjustP} onOpenChange={(o) => !o && setAdjustP(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">ปรับสต๊อก: {adjustP?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">คงเหลือปัจจุบัน: {fmtNum(adjustP?.stockQty ?? 0)} {adjustP?.unit}</p>
          <div className="space-y-1.5">
            <Label>จำนวนที่เพิ่ม (+) หรือลด (-)</Label>
            <Input type="number" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} placeholder="เช่น 24 หรือ -2" />
          </div>
          {adjustQty && (
            <p className="text-sm">
              หลังปรับ: <b>{fmtNum((adjustP?.stockQty ?? 0) + Number(adjustQty))} {adjustP?.unit}</b>
            </p>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!adjustQty || adjustMut.isPending}
              onClick={() => adjustMut.mutate({ productId: adjustP!.id, qty: Number(adjustQty), mode: "add" })}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
