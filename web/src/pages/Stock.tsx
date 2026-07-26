import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
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
  Banknote,
  BellRing,
  ChartNoAxesCombined,
  ShieldCheck,
  GripVertical,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogDescription,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { fmtMoney, fmtNum, fmtDateTime, categoryLabel } from "@/lib/format";
import { getFuelLiquidTone } from "@/lib/fuelColors";
import { summarizeTankValues, tankSaleValue } from "@/lib/stockValue";
import type { Product } from "@db/schema";

function TankLevelVisual({
  percent,
  productName,
  productCode,
  tankName,
}: {
  percent: number;
  productName?: string | null;
  productCode?: string | null;
  tankName: string;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const fuelTone = getFuelLiquidTone(productCode, productName, tankName);
  const style = {
    "--tank-level": `${safePercent}%`,
    "--tank-color": fuelTone.color,
    "--tank-color-light": fuelTone.light,
    "--tank-marker": `${18 + safePercent * 1.42}px`,
  } as CSSProperties;

  return (
    <div
      className="tank-visual"
      style={style}
      role="img"
      aria-label={`${productName ?? tankName} ระดับน้ำมัน ${safePercent}%`}
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
  const canManage = isAdmin || staff?.role === "manager";
  const { data: tanks } = trpc.catalog.listTanks.useQuery();
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const { data: refills } = trpc.catalog.listRefills.useQuery();
  const { data: tankReadings } = trpc.catalog.listTankReadings.useQuery();
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
  const [readTank, setReadTank] = useState<{
    id: number;
    name: string;
    currentLiters: number;
    capacityLiters: number;
  } | null>(null);
  const [readLiters, setReadLiters] = useState("");
  const [readNote, setReadNote] = useState("");
  const [readAdjust, setReadAdjust] = useState(false);
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

  const addReadingMut = trpc.catalog.addTankReading.useMutation({
    onSuccess: () => {
      utils.catalog.listTanks.invalidate();
      utils.catalog.listTankReadings.invalidate();
      setReadTank(null);
      setReadLiters("");
      setReadNote("");
      setReadAdjust(false);
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const deleteReadingMut = trpc.catalog.deleteTankReading.useMutation({
    onSuccess: () => {
      utils.catalog.listTankReadings.invalidate();
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
  const stockSummary = summarizeTankValues(orderedTanks ?? []);

  const addTankValid =
    !!addTank &&
    addTank.name.trim() !== "" &&
    addTank.productId !== "" &&
    Number(addTank.capacityLiters) > 0 &&
    Number(addTank.currentLiters) >= 0 &&
    Number(addTank.currentLiters) <= Number(addTank.capacityLiters);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-heading">สต๊อก & ถังน้ำมัน</h1>
        {canManage && (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to="/reports/fuel-stock">
              <ChartNoAxesCombined className="mr-1 size-4" />
              สรุปรายเดือน / รายปี
            </Link>
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <Tabs defaultValue="tanks" className="gap-4">
        <TabsList className="w-full station-scrollbar">
          <TabsTrigger value="tanks" className="flex-none sm:flex-1">
            <Fuel /> ถังน้ำมัน
          </TabsTrigger>
          <TabsTrigger value="goods" className="flex-none sm:flex-1">
            <Package /> สต๊อกสินค้า
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-none sm:flex-1">
            <History /> ประวัติ
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tanks" className="mt-0">
      {/* การ์ดถังน้ำมัน + มูลค่าน้ำมันคงเหลือ (ลิตรคงเหลือ × ราคาขายปัจจุบัน) */}
      <Card className="interactive-card spotlight-card group gap-0 overflow-hidden py-0">
        <span className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-emerald-100/70 blur-2xl" />
        <CardContent className="relative space-y-5 p-5">
          {stockSummary.byProduct.length > 0 && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-inner ring-1 ring-white">
              <Banknote className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-slate-500">
                มูลค่าน้ำมันคงเหลือ (ราคาขายปัจจุบัน)
              </div>
              <div className="mt-1 font-heading text-xl font-extrabold text-slate-900 number-display">
                ฿{fmtMoney(stockSummary.total)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {stockSummary.byProduct.map(p => (
                  <span
                    key={p.productId}
                    className="rounded-full bg-slate-50/90 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-100 number-display"
                  >
                    {p.name}: ฿{fmtMoney(p.value)} ({fmtNum(p.liters)} ล.)
                  </span>
                ))}
              </div>
            </div>
          </div>
          )}

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
                        <TankLevelVisual
                          percent={t.percent}
                          productName={t.product?.name}
                          productCode={t.product?.code}
                          tankName={t.name}
                        />
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
                            <div className="col-span-2 rounded-xl bg-emerald-50/80 p-2.5 ring-1 ring-emerald-100">
                              <Banknote className="size-3.5 text-emerald-500" />
                              <div className="mt-1 text-[9px] text-slate-400">
                                มูลค่า (ราคาขาย)
                              </div>
                              <div className="text-xs font-bold text-emerald-700 number-display">
                                {t.product ? (
                                  <>
                                    ฿{fmtMoney(tankSaleValue(t))}
                                    <span className="ml-1 font-medium text-slate-400">
                                      (฿{fmtMoney(t.product.price)}/ลิตร)
                                    </span>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div
                        className={`grid gap-2 ${
                          isAdmin
                            ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
                            : "grid-cols-2"
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-10 min-w-0 rounded-xl"
                          onClick={() => {
                            setReadTank({
                              id: t.id,
                              name: t.name,
                              currentLiters: t.currentLiters,
                              capacityLiters: t.capacityLiters,
                            });
                            setReadLiters("");
                            setReadNote("");
                            setReadAdjust(false);
                          }}
                        >
                          <Gauge className="size-4" />
                          <span className="truncate">วัดระดับถัง</span>
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
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="goods" className="mt-0 space-y-5">
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
        </TabsContent>

        <TabsContent value="history" className="mt-0 space-y-5">
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

      {/* ประวัติการวัดระดับถัง */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">
            ประวัติการวัดระดับถัง
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลาที่วัด</TableHead>
                <TableHead>ถัง</TableHead>
                <TableHead>ผู้วัด</TableHead>
                <TableHead className="text-right">ลิตรที่วัดได้</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                {isAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tankReadings ?? []).map(r => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDateTime(r.measuredAt)}</TableCell>
                  <TableCell>{r.tank?.name ?? "-"}</TableCell>
                  <TableCell>{r.staffName || "-"}</TableCell>
                  <TableCell className="text-right">
                    {fmtNum(r.liters)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.note ?? ""}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="ลบค่าวัด"
                        aria-label={`ลบค่าวัด ${fmtDateTime(r.measuredAt)}`}
                        className="text-destructive"
                        disabled={deleteReadingMut.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `ยืนยันลบค่าวัด ${fmtNum(r.liters)} ลิตร ของ ${r.tank?.name ?? "ถังนี้"}?`
                            )
                          ) {
                            deleteReadingMut.mutate({ id: r.id });
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {(tankReadings ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 6 : 5}
                    className="text-center text-muted-foreground py-6"
                  >
                    ยังไม่มีประวัติการวัด
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog รับน้ำมัน */}
      <Dialog open={!!refillTank} onOpenChange={o => !o && setRefillTank(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Fuel className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Fuel intake
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  รับน้ำมันเข้า{refillTank?.name}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  บันทึกจำนวนลิตรและต้นทุนต่อลิตรที่รับเข้าถัง
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    รายละเอียดการรับเข้า
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    จำนวนลิตรและต้นทุนของล็อตที่รับ
                  </p>
                </div>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    จำนวนลิตรที่รับเข้า
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={liters}
                    onChange={e => setLiters(e.target.value)}
                    placeholder="เช่น 10000"
                    className="bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    ต้นทุนต่อลิตร (บาท)
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={cost}
                    onChange={e => setCost(e.target.value)}
                    placeholder="เช่น 39.20"
                    className="bg-white"
                  />
                </div>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
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

      {/* Dialog วัดระดับถัง */}
      <Dialog open={!!readTank} onOpenChange={o => !o && setReadTank(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Gauge className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Tank reading
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  วัดระดับ{readTank?.name}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  บันทึกค่าวัดระดับน้ำมันจริงเทียบกับยอดคำนวณในระบบ
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Gauge className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    บันทึกค่าวัด
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    กรอกลิตรที่วัดได้จริงจากถัง
                  </p>
                </div>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <p className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm text-slate-600 sm:col-span-2">
                  ยอดคำนวณในระบบตอนนี้{" "}
                  <span className="font-semibold text-foreground number-display">
                    {fmtNum(readTank?.currentLiters ?? 0)}
                  </span>{" "}
                  ลิตร · ความจุ {fmtNum(readTank?.capacityLiters ?? 0)} ลิตร
                </p>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    ลิตรที่วัดได้จริง
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.001"
                    value={readLiters}
                    onChange={e => setReadLiters(e.target.value)}
                    placeholder="เช่น 8540"
                    className="bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    หมายเหตุ (ไม่บังคับ)
                  </Label>
                  <Input
                    value={readNote}
                    onChange={e => setReadNote(e.target.value)}
                    placeholder="เช่น วัดตอนเปิดปั๊ม"
                    className="bg-white"
                  />
                </div>
                <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm sm:col-span-2">
                  <Checkbox
                    checked={readAdjust}
                    onCheckedChange={v => setReadAdjust(v === true)}
                  />
                  <span>
                    ปรับยอดสต็อกในระบบให้ตรงกับค่าที่วัด
                    <span className="block text-xs text-muted-foreground">
                      ใช้เมื่อต้องการให้ยอดคำนวณเริ่มนับใหม่จากค่าวัดครั้งนี้
                    </span>
                  </span>
                </label>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={
                readLiters === "" ||
                Number(readLiters) < 0 ||
                addReadingMut.isPending
              }
              onClick={() =>
                addReadingMut.mutate({
                  tankId: readTank!.id,
                  liters: Number(readLiters),
                  note: readNote.trim() || undefined,
                  adjustStock: readAdjust,
                })
              }
            >
              บันทึกค่าวัด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขถัง (admin) */}
      <Dialog open={!!editTank} onOpenChange={o => !o && setEditTank(null)}>
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
                    Edit tank
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  แก้ไขถังน้ำมัน
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  แก้ไขข้อมูลถัง ระดับน้ำมัน และจุดแจ้งเตือนสต๊อกต่ำ
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {editTank && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Fuel className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ข้อมูลถัง
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ชื่อถังและชนิดน้ำมันที่บรรจุ
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อถัง
                    </Label>
                    <Input
                      value={editTank.name}
                      onChange={e =>
                        setEditTank({ ...editTank, name: e.target.value })
                      }
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชนิดน้ำมัน (สินค้า)
                    </Label>
                    <Select
                      value={String(editTank.productId)}
                      onValueChange={v =>
                        setEditTank({ ...editTank, productId: Number(v) })
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
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
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Gauge className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ระดับน้ำมันและการแจ้งเตือน
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ยอดคงเหลือ ความจุ และจุดแจ้งเตือน
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ระดับน้ำมันปัจจุบัน (ลิตร)
                    </Label>
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
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ความจุถัง (ลิตร)
                    </Label>
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
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      แจ้งเตือนเมื่อต่ำกว่า (ลิตร)
                    </Label>
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
                      className="bg-white"
                    />
                  </div>
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700 sm:col-span-2">
                    ⚠️ ใช้สำหรับแก้ค่าคลาดเคลื่อนหรือหลังสอบเทียบถังเท่านั้น —
                    การรับน้ำมันปกติให้ใช้ปุ่ม "รับน้ำมันเข้าถัง"
                  </p>
                </div>
              </section>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
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
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
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
                    New tank
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  เพิ่มถังน้ำมัน
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  สร้างถังใหม่และผูกกับชนิดน้ำมันที่บรรจุ
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {addTank && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Fuel className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ข้อมูลถัง
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ชื่อถังและชนิดน้ำมันที่บรรจุ
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อถัง
                    </Label>
                    <Input
                      value={addTank.name}
                      placeholder="เช่น ถัง GSH95"
                      onChange={e =>
                        setAddTank({ ...addTank, name: e.target.value })
                      }
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชนิดน้ำมัน (สินค้า)
                    </Label>
                    <Select
                      value={addTank.productId}
                      onValueChange={v =>
                        setAddTank({ ...addTank, productId: v })
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
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
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <BellRing className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ความจุและการแจ้งเตือน
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ความจุ ยอดเริ่มต้น และจุดแจ้งเตือน
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ความจุถัง (ลิตร)
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={addTank.capacityLiters}
                      placeholder="เช่น 20000"
                      onChange={e =>
                        setAddTank({
                          ...addTank,
                          capacityLiters: e.target.value,
                        })
                      }
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ระดับน้ำมันเริ่มต้น (ลิตร)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={addTank.currentLiters}
                      onChange={e =>
                        setAddTank({
                          ...addTank,
                          currentLiters: e.target.value,
                        })
                      }
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      แจ้งเตือนเมื่อต่ำกว่า (ลิตร)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={addTank.lowAlertAt}
                      placeholder="เช่น 4000"
                      onChange={e =>
                        setAddTank({ ...addTank, lowAlertAt: e.target.value })
                      }
                      className="bg-white"
                    />
                  </div>
                </div>
              </section>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
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
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Package className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Stock adjustment
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  ปรับสต๊อก: {adjustP?.name}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  เพิ่มหรือลดยอดสต๊อกคงเหลือของสินค้า
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    ปรับยอดคงเหลือ
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    ระบุจำนวนที่ต้องการเพิ่มหรือลด
                  </p>
                </div>
              </div>
              <div className="grid gap-4 p-4">
                <p className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm text-slate-600">
                  คงเหลือปัจจุบัน: {fmtNum(adjustP?.stockQty ?? 0)}{" "}
                  {adjustP?.unit}
                </p>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    จำนวนที่เพิ่ม (+) หรือลด (-)
                  </Label>
                  <Input
                    type="number"
                    value={adjustQty}
                    onChange={e => setAdjustQty(e.target.value)}
                    placeholder="เช่น 24 หรือ -2"
                    className="bg-white"
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
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
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
