import { useState, type CSSProperties, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Fuel,
  Package,
  PlusCircle,
  AlertTriangle,
  Pencil,
  Plus,
  Trash2,
  Gauge,
  BellRing,
  ShieldCheck,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { fmtMoney, fmtNum, fmtDateTime, categoryLabel } from "@/lib/format";
import type { Product } from "@db/schema";

function TankLevelVisual({
  percent,
  isLow,
}: {
  percent: number;
  isLow: boolean;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const tankColor = isLow
    ? "#ef4444"
    : safePercent < 50
      ? "#f59e0b"
      : "#6d5df4";
  const tankColorLight = isLow
    ? "#fb7185"
    : safePercent < 50
      ? "#fbbf24"
      : "#22d3ee";
  const style = {
    "--tank-level": `${safePercent}%`,
    "--tank-color": tankColor,
    "--tank-color-light": tankColorLight,
    "--tank-marker": `${18 + safePercent * 1.42}px`,
  } as CSSProperties;

  return (
    <div
      className="tank-visual"
      style={style}
      role="img"
      aria-label={`ระดับน้ำมัน ${safePercent}%`}
    >
      <div className="tank-cap" />
      <div className="tank-body">
        <div className="tank-liquid">
          <span className="tank-bubble tank-bubble-one" />
          <span className="tank-bubble tank-bubble-two" />
          <span className="tank-bubble tank-bubble-three" />
        </div>
        <div className="tank-gloss" />
        <div className="tank-bands" />
        <div className="tank-percent number-display">{safePercent}%</div>
      </div>
      <div className="tank-level-marker" />
      <div className="tank-leg tank-leg-left" />
      <div className="tank-leg tank-leg-right" />
    </div>
  );
}

function SortableTankItem({
  id,
  label,
  enabled,
  saving,
  children,
}: {
  id: number;
  label: string;
  enabled: boolean;
  saving: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !enabled || saving });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 30 : undefined,
      }}
      className={`relative ${isDragging ? "scale-[1.02] opacity-90 drop-shadow-2xl" : ""}`}
    >
      {enabled && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          disabled={saving}
          className="absolute right-4 top-[18px] z-20 grid size-9 touch-none place-items-center rounded-xl border border-violet-100 bg-white/90 text-violet-500 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 active:cursor-grabbing disabled:cursor-wait disabled:opacity-50 md:cursor-grab"
          aria-label={`ลากเพื่อย้ายตำแหน่ง ${label}`}
          title="กดค้างแล้วลากเพื่อสลับตำแหน่ง"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      {children}
    </div>
  );
}

export default function Stock() {
  const utils = trpc.useUtils();
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const { data: tanks } = trpc.catalog.listTanks.useQuery();
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const { data: refills } = trpc.catalog.listRefills.useQuery();
  const orderedTanks = tanks;
  const tankSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const [refillTank, setRefillTank] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [liters, setLiters] = useState("");
  const [cost, setCost] = useState("");
  const [adjustP, setAdjustP] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [editTank, setEditTank] = useState<{
    id: number;
    name: string;
    productId: number;
    currentLiters: number;
    capacityLiters: number;
    lowAlertAt: number;
  } | null>(null);
  const [addTank, setAddTank] = useState<{
    name: string;
    productId: string;
    capacityLiters: string;
    currentLiters: string;
    lowAlertAt: string;
  } | null>(null);
  const [err, setErr] = useState("");

  const reorderTanksMut = trpc.catalog.reorderTanks.useMutation();

  const createTankMut = trpc.catalog.createTank.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      setAddTank(null);
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const deleteTankMut = trpc.catalog.deleteTank.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      utils.catalog.listRefills.invalidate();
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const updateTankMut = trpc.catalog.updateTank.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      setEditTank(null);
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const refillMut = trpc.catalog.refillTank.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      utils.catalog.listRefills.invalidate();
      setRefillTank(null);
      setLiters("");
      setCost("");
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const adjustMut = trpc.catalog.adjustStock.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      setAdjustP(null);
      setAdjustQty("");
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const handleTankDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!isAdmin || !over || active.id === over.id || !orderedTanks) return;
    const oldIndex = orderedTanks.findIndex(tank => tank.id === active.id);
    const newIndex = orderedTanks.findIndex(tank => tank.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = orderedTanks;
    const next = arrayMove(orderedTanks, oldIndex, newIndex);
    utils.catalog.listTanks.setData(undefined, next);
    setErr("");
    try {
      await reorderTanksMut.mutateAsync({
        tankIds: next.map(tank => tank.id),
      });
      await utils.catalog.listTanks.invalidate();
    } catch (error) {
      utils.catalog.listTanks.setData(undefined, previous);
      setErr(
        error instanceof Error
          ? error.message
          : "บันทึกลำดับถังไม่สำเร็จ กรุณาลองใหม่"
      );
    }
  };

  const goods = (products ?? []).filter(p => p.category !== "fuel");
  const fuelProducts = (products ?? []).filter(
    p => p.category === "fuel" && p.active
  );

  const addTankValid =
    !!addTank &&
    addTank.name.trim() !== "" &&
    addTank.productId !== "" &&
    Number(addTank.capacityLiters) > 0 &&
    Number(addTank.currentLiters) >= 0 &&
    Number(addTank.currentLiters) <= Number(addTank.capacityLiters);

  return (
    <div className="space-y-5">
      <h1 className="page-heading">สต๊อก & ถังน้ำมัน</h1>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* ถังน้ำมัน */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
          <Fuel className="w-5 h-5 text-primary" /> ถังน้ำมัน
        </h2>
        {isAdmin && (
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={() =>
              setAddTank({
                name: "",
                productId: "",
                capacityLiters: "",
                currentLiters: "0",
                lowAlertAt: "",
              })
            }
          >
            <Plus className="w-4 h-4 mr-1" /> เพิ่มถังน้ำมัน
          </Button>
        )}
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs font-medium text-violet-700">
          <GripVertical className="size-4" />
          {reorderTanksMut.isPending
            ? "กำลังบันทึกลำดับถัง..."
            : "กดค้างที่ปุ่มจับบนการ์ด แล้วลากเพื่อสลับตำแหน่ง"}
        </div>
      )}
      <DndContext
        sensors={tankSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleTankDragEnd}
      >
        <SortableContext
          items={(orderedTanks ?? []).map(tank => tank.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(orderedTanks ?? []).map(t => {
              const statusLabel = t.isLow
                ? "ระดับต่ำ"
                : t.percent >= 80
                  ? "เกือบเต็ม"
                  : "พร้อมใช้งาน";

              return (
                <SortableTankItem
                  key={t.id}
                  id={t.id}
                  label={t.name}
                  enabled={isAdmin}
                  saving={reorderTanksMut.isPending}
                >
                  <Card
                    className={`interactive-card spotlight-card group gap-0 overflow-hidden py-0 ${
                      t.isLow
                        ? "border-red-200/90 ring-red-100"
                        : "border-white/90"
                    }`}
                  >
                    <div
                      className={`h-1.5 bg-gradient-to-r ${
                        t.isLow
                          ? "from-red-500 via-rose-400 to-orange-400"
                          : "from-violet-600 via-indigo-500 to-cyan-400"
                      }`}
                    />
                    <CardHeader
                      className={`flex-row items-center justify-between gap-3 border-b border-slate-100/80 px-5 py-4 ${
                        isAdmin ? "pr-16" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={`grid size-10 shrink-0 place-items-center rounded-2xl shadow-inner ring-1 ring-white ${
                            t.isLow
                              ? "bg-red-50 text-red-600"
                              : "bg-gradient-to-br from-violet-100 to-cyan-50 text-violet-700"
                          }`}
                        >
                          <Fuel className="size-[18px]" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="truncate font-heading text-base font-bold text-slate-900">
                            {t.name}
                          </CardTitle>
                          <div className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">
                            ถัง #{t.id} ·{" "}
                            {t.product?.name ?? "ไม่ระบุชนิดน้ำมัน"}
                          </div>
                        </div>
                      </div>
                      <div
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          t.isLow
                            ? "bg-red-50 text-red-700 ring-1 ring-red-100"
                            : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                        }`}
                      >
                        {t.isLow ? (
                          <AlertTriangle className="size-3" />
                        ) : (
                          <ShieldCheck className="size-3" />
                        )}
                        {statusLabel}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 bg-gradient-to-br from-white/80 via-white/70 to-violet-50/35 p-5">
                      <div className="flex items-center gap-5 rounded-[20px] border border-white bg-white/55 p-4 shadow-inner ring-1 ring-slate-200/60">
                        <TankLevelVisual percent={t.percent} isLow={t.isLow} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                            น้ำมันคงเหลือ
                          </div>
                          <div
                            className={`mt-1 font-heading text-2xl font-extrabold number-display ${
                              t.isLow ? "text-red-600" : "text-slate-950"
                            }`}
                          >
                            {fmtNum(t.currentLiters)}
                            <span className="ml-1 text-xs font-semibold text-slate-400">
                              ลิตร
                            </span>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-slate-50/90 p-2.5 ring-1 ring-slate-100">
                              <Gauge className="size-3.5 text-violet-500" />
                              <div className="mt-1 text-[9px] text-slate-400">
                                ความจุ
                              </div>
                              <div className="text-xs font-bold text-slate-700 number-display">
                                {fmtNum(t.capacityLiters)} ล.
                              </div>
                            </div>
                            <div className="rounded-xl bg-slate-50/90 p-2.5 ring-1 ring-slate-100">
                              <BellRing className="size-3.5 text-orange-500" />
                              <div className="mt-1 text-[9px] text-slate-400">
                                แจ้งเตือน
                              </div>
                              <div className="text-xs font-bold text-slate-700 number-display">
                                {fmtNum(t.lowAlertAt)} ล.
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div
                        className={`grid gap-2 ${
                          isAdmin
                            ? "grid-cols-[minmax(0,1fr)_auto_auto]"
                            : "grid-cols-1"
                        }`}
                      >
                        <Button
                          size="sm"
                          className="shine-button h-10 min-w-0 rounded-xl"
                          onClick={() =>
                            setRefillTank({ id: t.id, name: t.name })
                          }
                        >
                          <PlusCircle className="size-4" />
                          <span className="truncate">รับน้ำมันเข้าถัง</span>
                        </Button>
                        {isAdmin && (
                          <>
                            <Button
                              size="icon-sm"
                              variant="outline"
                              title="แก้ไขถัง"
                              aria-label={`แก้ไข ${t.name}`}
                              className="rounded-xl text-violet-700"
                              onClick={() =>
                                setEditTank({
                                  id: t.id,
                                  name: t.name,
                                  productId: t.productId,
                                  currentLiters: t.currentLiters,
                                  capacityLiters: t.capacityLiters,
                                  lowAlertAt: t.lowAlertAt,
                                })
                              }
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="outline"
                              title="ลบถัง"
                              aria-label={`ลบ ${t.name}`}
                              className="rounded-xl text-destructive hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                              disabled={deleteTankMut.isPending}
                              onClick={() => {
                                if (
                                  confirm(
                                    `ยืนยันลบ "${t.name}"? ประวัติรับน้ำมันเข้าถังนี้จะถูกลบไปด้วย`
                                  )
                                ) {
                                  deleteTankMut.mutate({ id: t.id });
                                }
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </SortableTankItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* สต๊อกสินค้า */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Package className="w-4 h-4" /> สต๊อกสินค้า (2T / น้ำมันเครื่อง /
            อื่นๆ)
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
              {goods.map(p => {
                const low = p.stockQty <= p.lowStockAt;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">
                      {p.code}
                    </TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-xs">
                      {categoryLabel[p.category]}
                    </TableCell>
                    <TableCell className="text-right">
                      ฿{fmtMoney(p.price)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${low ? "text-destructive" : ""}`}
                    >
                      {fmtNum(p.stockQty)} {p.unit}
                    </TableCell>
                    <TableCell>
                      {low ? (
                        <Badge variant="destructive">ใกล้หมด</Badge>
                      ) : (
                        <Badge variant="secondary">ปกติ</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAdjustP(p);
                          setAdjustQty("");
                        }}
                      >
                        ปรับสต๊อก
                      </Button>
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
          <CardTitle className="font-heading text-base">
            ประวัติรับน้ำมันเข้าถัง
          </CardTitle>
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
              {(refills ?? []).map(r => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDateTime(r.createdAt)}</TableCell>
                  <TableCell>{r.tank?.name ?? "-"}</TableCell>
                  <TableCell className="text-right">
                    {fmtNum(r.liters)}
                  </TableCell>
                  <TableCell className="text-right">
                    ฿{fmtMoney(r.costPerLiter)}
                  </TableCell>
                  <TableCell className="text-right">
                    ฿{fmtMoney(r.liters * r.costPerLiter)}
                  </TableCell>
                </TableRow>
              ))}
              {(refills ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-6"
                  >
                    ยังไม่มีประวัติ
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog รับน้ำมัน */}
      <Dialog open={!!refillTank} onOpenChange={o => !o && setRefillTank(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">
              รับน้ำมันเข้า{refillTank?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>จำนวนลิตรที่รับเข้า</Label>
              <Input
                type="number"
                min={0}
                value={liters}
                onChange={e => setLiters(e.target.value)}
                placeholder="เช่น 10000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>ต้นทุนต่อลิตร (บาท)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={e => setCost(e.target.value)}
                placeholder="เช่น 39.20"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!Number(liters) || refillMut.isPending}
              onClick={() =>
                refillMut.mutate({
                  tankId: refillTank!.id,
                  liters: Number(liters),
                  costPerLiter: Number(cost) || 0,
                })
              }
            >
              บันทึกรับเข้า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขถัง (admin) */}
      <Dialog open={!!editTank} onOpenChange={o => !o && setEditTank(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">แก้ไขถังน้ำมัน</DialogTitle>
          </DialogHeader>
          {editTank && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อถัง</Label>
                <Input
                  value={editTank.name}
                  onChange={e =>
                    setEditTank({ ...editTank, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>ชนิดน้ำมัน (สินค้า)</Label>
                <Select
                  value={String(editTank.productId)}
                  onValueChange={v =>
                    setEditTank({ ...editTank, productId: Number(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกชนิดน้ำมัน" />
                  </SelectTrigger>
                  <SelectContent>
                    {fuelProducts.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} ({p.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  ถ้าถังยังผูกกับหัวจ่ายอยู่ ต้องเปลี่ยนถังของหัวจ่ายก่อน
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>ระดับน้ำมันปัจจุบัน (ลิตร)</Label>
                <Input
                  type="number"
                  min={0}
                  value={editTank.currentLiters}
                  onChange={e =>
                    setEditTank({
                      ...editTank,
                      currentLiters: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>ความจุถัง (ลิตร)</Label>
                <Input
                  type="number"
                  min={1}
                  value={editTank.capacityLiters}
                  onChange={e =>
                    setEditTank({
                      ...editTank,
                      capacityLiters: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>แจ้งเตือนเมื่อต่ำกว่า (ลิตร)</Label>
                <Input
                  type="number"
                  min={0}
                  value={editTank.lowAlertAt}
                  onChange={e =>
                    setEditTank({
                      ...editTank,
                      lowAlertAt: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <p className="text-xs text-amber-600">
                ⚠️ ใช้สำหรับแก้ค่าคลาดเคลื่อนหรือหลังสอบเทียบถังเท่านั้น —
                การรับน้ำมันปกติให้ใช้ปุ่ม "รับน้ำมันเข้าถัง"
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={updateTankMut.isPending || !editTank?.name.trim()}
              onClick={() =>
                editTank &&
                updateTankMut.mutate({
                  id: editTank.id,
                  name: editTank.name.trim(),
                  productId: editTank.productId,
                  currentLiters: editTank.currentLiters,
                  capacityLiters: editTank.capacityLiters,
                  lowAlertAt: editTank.lowAlertAt,
                })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog เพิ่มถังน้ำมัน (admin) */}
      <Dialog open={!!addTank} onOpenChange={o => !o && setAddTank(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">เพิ่มถังน้ำมัน</DialogTitle>
          </DialogHeader>
          {addTank && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อถัง</Label>
                <Input
                  value={addTank.name}
                  placeholder="เช่น ถัง GSH95"
                  onChange={e =>
                    setAddTank({ ...addTank, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>ชนิดน้ำมัน (สินค้า)</Label>
                <Select
                  value={addTank.productId}
                  onValueChange={v => setAddTank({ ...addTank, productId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกชนิดน้ำมัน" />
                  </SelectTrigger>
                  <SelectContent>
                    {fuelProducts.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>ความจุถัง (ลิตร)</Label>
                <Input
                  type="number"
                  min={1}
                  value={addTank.capacityLiters}
                  placeholder="เช่น 20000"
                  onChange={e =>
                    setAddTank({ ...addTank, capacityLiters: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>ระดับน้ำมันเริ่มต้น (ลิตร)</Label>
                <Input
                  type="number"
                  min={0}
                  value={addTank.currentLiters}
                  onChange={e =>
                    setAddTank({ ...addTank, currentLiters: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>แจ้งเตือนเมื่อต่ำกว่า (ลิตร)</Label>
                <Input
                  type="number"
                  min={0}
                  value={addTank.lowAlertAt}
                  placeholder="เช่น 4000"
                  onChange={e =>
                    setAddTank({ ...addTank, lowAlertAt: e.target.value })
                  }
                />
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
      <Dialog open={!!adjustP} onOpenChange={o => !o && setAdjustP(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">
              ปรับสต๊อก: {adjustP?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            คงเหลือปัจจุบัน: {fmtNum(adjustP?.stockQty ?? 0)} {adjustP?.unit}
          </p>
          <div className="space-y-1.5">
            <Label>จำนวนที่เพิ่ม (+) หรือลด (-)</Label>
            <Input
              type="number"
              value={adjustQty}
              onChange={e => setAdjustQty(e.target.value)}
              placeholder="เช่น 24 หรือ -2"
            />
          </div>
          {adjustQty && (
            <p className="text-sm">
              หลังปรับ:{" "}
              <b>
                {fmtNum((adjustP?.stockQty ?? 0) + Number(adjustQty))}{" "}
                {adjustP?.unit}
              </b>
            </p>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!adjustQty || adjustMut.isPending}
              onClick={() =>
                adjustMut.mutate({
                  productId: adjustP!.id,
                  qty: Number(adjustQty),
                  mode: "add",
                })
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
