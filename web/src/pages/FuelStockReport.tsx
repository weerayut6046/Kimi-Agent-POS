import { type ReactNode, useState } from "react";
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
  AlertTriangle,
  ArrowLeft,
  FileSpreadsheet,
  Fuel,
  GripVertical,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStaff } from "@/hooks/useStaff";
import { downloadBase64, XLSX_MIME } from "@/lib/download";
import { fmtMoney, fmtNum } from "@/lib/format";
import {
  reorderTanksByProductOrder,
  sortProductsByTankOrder,
} from "@/lib/tankOrder";
import { trpc } from "@/providers/trpc";

type ReportView = "monthly" | "yearly";

const TANK_COLORS = [
  "#0891b2",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#db2777",
  "#2563eb",
] as const;

function fuelTankColor(code: string, name: string, index: number) {
  const normalizedCode = code.toUpperCase();
  if (normalizedCode.includes("DB") || name.includes("ดีเซล")) {
    return "#eab308";
  }
  if (normalizedCode.includes("95") || name.includes("95")) {
    return "#f97316";
  }
  return TANK_COLORS[index % TANK_COLORS.length] ?? "#0891b2";
}

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

function currentBangkokPeriod() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  return {
    year: Number(parts.find(part => part.type === "year")?.value),
    month: Number(parts.find(part => part.type === "month")?.value),
  };
}

function SortableTankChartItem({
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
          className="absolute right-3 top-3 z-20 grid size-9 touch-none place-items-center rounded-xl border border-violet-100 bg-white/90 text-violet-500 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 active:cursor-grabbing disabled:cursor-wait disabled:opacity-50 md:cursor-grab"
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

export default function FuelStockReport() {
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const canManage = isAdmin || staff?.role === "manager";
  const current = currentBangkokPeriod();
  const [view, setView] = useState<ReportView>("monthly");
  const [year, setYear] = useState(current.year);
  const [month, setMonth] = useState(current.month);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [reorderError, setReorderError] = useState("");
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.reports.fuelStockSummary.useQuery(
    { view, year },
    { enabled: canManage }
  );
  const { data: tanks } = trpc.catalog.listTanks.useQuery(undefined, {
    enabled: canManage,
  });
  const reorderTanksMut = trpc.catalog.reorderTanks.useMutation();
  const tankSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const selectedPeriodKey =
    view === "monthly"
      ? `${year}-${String(month).padStart(2, "0")}`
      : String(year);
  const selectedPeriod = data?.periods.find(
    period => period.key === selectedPeriodKey
  );
  const currentProductById = new Map(
    data?.currentProducts.map(product => [product.productId, product]) ?? []
  );
  const rows =
    selectedPeriod?.products.filter(product => {
      const currentProduct = currentProductById.get(product.productId);
      return (
        (currentProduct?.tankCount ?? 0) > 0 ||
        product.receivedLiters > 0 ||
        product.soldLiters > 0
      );
    }) ?? [];
  const rowProfit = rows.map(product => {
    return {
      productId: product.productId,
      profitPerLiter: product.profitPerLiter,
      totalProfit: product.stockProfit,
    };
  });
  const profitByProductId = new Map(
    rowProfit.map(item => [item.productId, item])
  );
  const periodTotalProfit = rowProfit.reduce(
    (sum, item) => sum + item.totalProfit,
    0
  );
  const periodProfitPerLiter =
    selectedPeriod && selectedPeriod.receivedLiters > 0
      ? selectedPeriod.profitPerLiter
      : 0;
  const tankChartData = sortProductsByTankOrder(
    rows.map((product, index) => {
      const currentProduct = currentProductById.get(product.productId);
      return {
        ...product,
        currentLiters: currentProduct?.currentLiters ?? 0,
        capacityLiters: currentProduct?.capacityLiters ?? 0,
        fillPercent: Math.min(
          100,
          Math.max(0, currentProduct?.fillPercent ?? 0)
        ),
        tankCount: currentProduct?.tankCount ?? 0,
        lowTankCount: currentProduct?.lowTankCount ?? 0,
        color: fuelTankColor(product.code, product.name, index),
      };
    }),
    tanks ?? []
  );
  const yearOptions = Array.from(
    { length: 8 },
    (_, index) => current.year - index
  );
  const availableMonthCount =
    year === current.year ? current.month : THAI_MONTHS.length;

  const exportExcel = async () => {
    setExportError("");
    setExporting(true);
    try {
      const file = await utils.reports.exportFuelStockExcel.fetch({
        view,
        year,
        month: view === "monthly" ? month : undefined,
      });
      downloadBase64(file.fileName, file.contentBase64, XLSX_MIME);
    } catch (exportErr) {
      setExportError(
        exportErr instanceof Error ? exportErr.message : String(exportErr)
      );
    } finally {
      setExporting(false);
    }
  };

  const handleTankDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!isAdmin || !over || active.id === over.id || !tanks) return;
    const productIds = tankChartData.map(tank => tank.productId);
    const oldIndex = productIds.findIndex(productId => productId === active.id);
    const newIndex = productIds.findIndex(productId => productId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextProductIds = arrayMove(productIds, oldIndex, newIndex);
    const previousTanks = tanks;
    const nextTanks = reorderTanksByProductOrder(tanks, nextProductIds);
    utils.catalog.listTanks.setData(undefined, nextTanks);
    setReorderError("");
    try {
      await reorderTanksMut.mutateAsync({
        tankIds: nextTanks.map(tank => tank.id),
      });
      await utils.catalog.listTanks.invalidate();
    } catch (reorderErr) {
      utils.catalog.listTanks.setData(undefined, previousTanks);
      setReorderError(
        reorderErr instanceof Error
          ? reorderErr.message
          : "บันทึกลำดับถังไม่สำเร็จ กรุณาลองใหม่"
      );
    }
  };

  if (!canManage) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10 text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-amber-50 text-amber-700">
          <AlertTriangle className="size-7" />
        </div>
        <h1 className="font-heading text-2xl font-bold">
          รายงานนี้มีข้อมูลราคาซื้อ
        </h1>
        <p className="text-sm text-muted-foreground">
          เฉพาะผู้ดูแลระบบหรือผู้จัดการเท่านั้นที่ดูราคาซื้อและกำไรน้ำมันได้
        </p>
        <Button asChild variant="outline">
          <Link to="/reports">
            <ArrowLeft className="mr-1 size-4" /> กลับหน้ารายงาน
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-1">
            <Link to="/reports">
              <ArrowLeft className="mr-1 size-4" /> กลับหน้ารายงาน
            </Link>
          </Button>
          <h1 className="page-heading flex items-center gap-2">
            <Fuel className="size-6 text-primary" />
            สรุปยอดสต๊อกน้ำมัน
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            สรุปรับเข้า ราคาซื้อ ขายออก ราคาขาย กำไร และคงเหลือ แยกตามชนิดน้ำมัน
          </p>
        </div>

        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <div className="min-w-[190px] flex-1 space-y-1 sm:flex-none">
            <Label className="text-xs text-muted-foreground">สรุปแบบ</Label>
            <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              {(["monthly", "yearly"] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    view === option
                      ? "bg-white text-violet-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {option === "monthly" ? "รายเดือน" : "รายปี"}
                </button>
              ))}
            </div>
          </div>

          {view === "monthly" && (
            <div className="w-[150px] space-y-1">
              <Label className="text-xs text-muted-foreground">เดือน</Label>
              <Select
                value={String(month)}
                onValueChange={value => setMonth(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THAI_MONTHS.slice(0, availableMonthCount).map(
                    (monthLabel, index) => (
                      <SelectItem key={monthLabel} value={String(index + 1)}>
                        {monthLabel}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="w-[120px] space-y-1">
            <Label className="text-xs text-muted-foreground">ปี</Label>
            <Select
              value={String(year)}
              onValueChange={value => {
                const nextYear = Number(value);
                setYear(nextYear);
                if (nextYear === current.year && month > current.month) {
                  setMonth(current.month);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map(option => (
                  <SelectItem key={option} value={String(option)}>
                    {option + 543}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="flex-1 sm:flex-none"
            variant="outline"
            disabled={!selectedPeriod || exporting}
            onClick={exportExcel}
          >
            <FileSpreadsheet className="mr-1 size-4" />
            {exporting ? "กำลังสร้าง..." : "ส่งออก Excel"}
          </Button>
        </div>
      </div>

      {(error || exportError || reorderError) && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error?.message || exportError || reorderError}
        </div>
      )}
      {isLoading && (
        <div
          className="flex items-center gap-3 rounded-2xl border bg-white p-5 text-sm text-muted-foreground"
          role="status"
        >
          <span className="size-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          กำลังคำนวณสรุปสต๊อก...
        </div>
      )}

      {data && selectedPeriod && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-lg">
              แผนภูมิถังสต๊อกน้ำมัน
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              ระดับสีในถังแสดงปริมาณคงเหลือปัจจุบัน แยกตามชนิดน้ำมัน
            </p>
            {isAdmin && (
              <p className="text-xs font-medium text-violet-600">
                กดค้างที่ไอคอนจับแล้วลากเพื่อย้ายตำแหน่ง
                ระบบจะบันทึกลำดับให้อัตโนมัติ
              </p>
            )}
          </CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6">
            {tankChartData.length > 0 ? (
              <DndContext
                sensors={tankSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleTankDragEnd}
              >
                <SortableContext
                  items={tankChartData.map(tank => tank.productId)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {tankChartData.map(tank => (
                      <SortableTankChartItem
                        key={tank.productId}
                        id={tank.productId}
                        label={tank.name}
                        enabled={isAdmin && tank.tankCount > 0}
                        saving={reorderTanksMut.isPending}
                      >
                        <div
                          className={`rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 text-center ${
                            isAdmin && tank.tankCount > 0 ? "pt-5" : ""
                          }`}
                        >
                          <div
                            className={`min-h-12 ${
                              isAdmin && tank.tankCount > 0 ? "px-8" : ""
                            }`}
                          >
                            <div className="font-semibold text-slate-900">
                              {tank.name}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {tank.code} · {tank.tankCount} ถัง
                            </div>
                          </div>

                          <div
                            className="relative mx-auto mt-3 w-32 pt-4"
                            role="img"
                            aria-label={`${tank.name} คงเหลือ ${fmtNum(
                              tank.currentLiters
                            )} ลิตร หรือ ${fmtNum(tank.fillPercent)} เปอร์เซ็นต์`}
                          >
                            <div className="absolute left-1/2 top-0 h-6 w-12 -translate-x-1/2 rounded-t-lg border-4 border-b-0 border-slate-300 bg-slate-100" />
                            <div className="relative h-48 overflow-hidden rounded-[44px_44px_28px_28px] border-[5px] border-slate-300 bg-white shadow-inner">
                              <div
                                className="absolute inset-x-0 bottom-0 transition-[height] duration-700"
                                style={{
                                  height: `${tank.fillPercent}%`,
                                  background: `linear-gradient(180deg, ${tank.color}cc, ${tank.color})`,
                                }}
                              >
                                <div className="absolute inset-x-0 top-0 h-2 -translate-y-1/2 rounded-[50%] bg-white/35" />
                              </div>
                              <div className="pointer-events-none absolute inset-x-3 top-1/4 border-t border-dashed border-slate-300/70" />
                              <div className="pointer-events-none absolute inset-x-3 top-1/2 border-t border-dashed border-slate-300/70" />
                              <div className="pointer-events-none absolute inset-x-3 top-3/4 border-t border-dashed border-slate-300/70" />
                              <div className="absolute inset-0 grid place-items-center">
                                <div className="rounded-xl bg-white/90 px-3 py-2 shadow-sm ring-1 ring-slate-200/80 backdrop-blur-sm">
                                  <div className="text-lg font-extrabold text-slate-900">
                                    {fmtNum(tank.fillPercent)}%
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    คงเหลือ
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="mx-auto flex w-24 justify-between">
                              <span className="h-3 w-4 rounded-b bg-slate-300" />
                              <span className="h-3 w-4 rounded-b bg-slate-300" />
                            </div>
                          </div>

                          <div className="mt-2 font-bold text-slate-900">
                            {fmtNum(tank.currentLiters)} ลิตร
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            ความจุ {fmtNum(tank.capacityLiters)} ลิตร
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-xl bg-cyan-50 px-2 py-2 text-cyan-800">
                              <div className="text-[10px]">รับเข้า</div>
                              <div className="font-bold">
                                {fmtNum(tank.receivedLiters)} ลิตร
                              </div>
                            </div>
                            <div className="rounded-xl bg-violet-50 px-2 py-2 text-violet-800">
                              <div className="text-[10px]">ขายออก</div>
                              <div className="font-bold">
                                {fmtNum(tank.soldLiters)} ลิตร
                              </div>
                            </div>
                          </div>
                          {tank.lowTankCount > 0 && (
                            <Badge variant="destructive" className="mt-3">
                              ระดับต่ำ {tank.lowTankCount} ถัง
                            </Badge>
                          )}
                        </div>
                      </SortableTankChartItem>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="grid min-h-52 place-items-center text-sm text-muted-foreground">
                ไม่มีข้อมูลสำหรับแสดงกราฟ
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data && selectedPeriod && (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="font-heading text-lg">
              {view === "monthly"
                ? `ประจำเดือน${THAI_MONTHS[month - 1]} ${year + 543}`
                : `ประจำปี ${year + 543}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-0 sm:px-6">
            <Table className="min-w-[1480px]">
              <TableHeader>
                <TableRow>
                  <TableHead>ชนิดน้ำมัน</TableHead>
                  <TableHead className="text-right">รับเข้า (ลิตร)</TableHead>
                  <TableHead className="text-right">ราคาซื้อ/ลิตร</TableHead>
                  <TableHead className="text-right">มูลค่าซื้อ</TableHead>
                  <TableHead
                    className="text-right"
                    title="จำนวนลิตรที่ขายจริงจากรายการขาย POS ในช่วงเดือนหรือปีที่เลือก"
                  >
                    <div>ขายออก (ลิตร)</div>
                    <div className="text-[10px] font-normal">
                      รวมจากรายการขาย POS
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="ราคาที่ตั้งไว้ของสินค้า ณ สิ้นวันรับเข้า และวันนี้ใช้ราคาปัจจุบัน"
                  >
                    <div>ราคาขาย/ลิตร</div>
                    <div className="text-[10px] font-normal">
                      ราคาที่ตั้งไว้รายวัน
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="ผลรวมจำนวนเงินจากรายการขาย POS ที่ขายสำเร็จ แยกตามชนิดน้ำมันและช่วงเวลาที่เลือก"
                  >
                    <div>ยอดขาย</div>
                    <div className="text-[10px] font-normal">
                      รวมเงินจากรายการขาย POS
                    </div>
                  </TableHead>
                  <TableHead className="text-right">กำไร/ลิตร</TableHead>
                  <TableHead className="text-right">กำไรรวม</TableHead>
                  <TableHead className="text-right">คงเหลือปัจจุบัน</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(product => {
                  const currentProduct = currentProductById.get(
                    product.productId
                  );
                  const profit = profitByProductId.get(product.productId);
                  const profitPerLiter = profit?.profitPerLiter ?? 0;
                  const totalProfit = profit?.totalProfit ?? 0;
                  return (
                    <TableRow key={product.productId}>
                      <TableCell>
                        <div className="font-semibold">{product.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {product.code}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-cyan-700">
                        {fmtNum(product.receivedLiters)}
                      </TableCell>
                      <TableCell className="text-right">
                        {product.avgPurchaseCost > 0 ? (
                          <div>
                            ฿{fmtMoney(product.avgPurchaseCost)}
                            {product.costBasis !== "period_weighted" && (
                              <div className="text-[10px] text-muted-foreground">
                                ต้นทุนปัจจุบัน
                              </div>
                            )}
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{fmtMoney(product.purchaseCost)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-violet-700">
                        {fmtNum(product.soldLiters)}
                      </TableCell>
                      <TableCell className="text-right">
                        {product.avgSalePrice > 0
                          ? `฿${fmtMoney(product.avgSalePrice)}`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{fmtMoney(product.revenue)}
                      </TableCell>
                      <TableCell className="text-right">
                        {product.avgSalePrice > 0 && product.avgPurchaseCost > 0
                          ? `฿${fmtMoney(profitPerLiter)}`
                          : "-"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          totalProfit < 0 ? "text-red-600" : "text-emerald-700"
                        }`}
                      >
                        ฿{fmtMoney(totalProfit)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="font-bold">
                          {fmtNum(currentProduct?.currentLiters ?? 0)} ลิตร
                        </div>
                        {(currentProduct?.tankCount ?? 0) > 0 && (
                          <Badge
                            variant={
                              (currentProduct?.lowTankCount ?? 0) > 0
                                ? "destructive"
                                : "secondary"
                            }
                            className="mt-1"
                          >
                            {fmtNum(currentProduct?.fillPercent ?? 0)}%
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-slate-50 font-bold">
                  <TableCell>รวมงวด</TableCell>
                  <TableCell className="text-right">
                    {fmtNum(selectedPeriod.receivedLiters)}
                  </TableCell>
                  <TableCell className="text-right">
                    {selectedPeriod.receivedLiters > 0
                      ? `฿${fmtMoney(selectedPeriod.avgPurchaseCost)}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    ฿{fmtMoney(selectedPeriod.purchaseCost)}
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtNum(selectedPeriod.soldLiters)}
                  </TableCell>
                  <TableCell className="text-right">
                    {selectedPeriod.receivedLiters > 0
                      ? `฿${fmtMoney(selectedPeriod.avgSalePrice)}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    ฿{fmtMoney(selectedPeriod.revenue)}
                  </TableCell>
                  <TableCell className="text-right">
                    {selectedPeriod.receivedLiters > 0
                      ? `฿${fmtMoney(periodProfitPerLiter)}`
                      : "-"}
                  </TableCell>
                  <TableCell
                    className={`text-right ${
                      periodTotalProfit < 0
                        ? "text-red-600"
                        : "text-emerald-700"
                    }`}
                  >
                    ฿{fmtMoney(periodTotalProfit)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    แยกตามชนิดด้านบน
                  </TableCell>
                </TableRow>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-10 text-center text-muted-foreground"
                    >
                      ไม่มีข้อมูลน้ำมันในงวดนี้
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && (
        <p className="text-xs leading-5 text-muted-foreground">
          ที่มาของขายออก (ลิตร): ระบบนำจำนวนลิตรจากรายการขาย POS
          เฉพาะรายการที่ขายสำเร็จมารวมกัน โดยแยกตามชนิดน้ำมัน สาขา
          และเดือนหรือปีที่เลือก ไม่รวมรายการที่ยกเลิก ที่มาของยอดขาย:
          ระบบรวมจำนวนเงินของรายการขาย POS ที่ขายสำเร็จ โดยใช้เงื่อนไขเดียวกัน
          ราคาขายใช้ราคาที่ตั้งไว้ ณ สิ้นวันของการรับเข้า
          (วันนี้ใช้ราคาปัจจุบัน) กำไร/ลิตร = ราคาขาย/ลิตร − ราคาซื้อ/ลิตร
          และกำไรรวม = กำไร/ลิตร × รับเข้า (ลิตร) หากไม่มีการรับเข้าในงวด
          ระบบจะแสดงต้นทุนสินค้าปัจจุบันแทน
          ส่วนคงเหลือปัจจุบันแสดงแยกตามชนิดน้ำมันและไม่นำมารวมกัน
        </p>
      )}
    </div>
  );
}
