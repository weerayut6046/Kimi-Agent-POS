import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Fuel,
  Info,
  RefreshCw,
  Settings2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import {
  FUEL_FORECAST_LOOKBACK_DAYS,
  fuelForecastSettingsSchema,
  type FuelForecastLookbackDays,
  type FuelForecastStatus,
  type FuelTankForecast,
} from "@contracts/fuelForecast";
import { hasMenuPermission } from "@contracts/menuPermissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStaff } from "@/hooks/useStaff";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";

const statusMeta: Record<
  FuelForecastStatus,
  { label: string; className: string }
> = {
  urgent: {
    label: "เสี่ยงหมดก่อนรถส่งถึง",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  order_now: {
    label: "ควรสั่งวันนี้",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  ok: {
    label: "ยังมีเวลาวางแผน",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  insufficient_data: {
    label: "ยังคาดการณ์ไม่ได้",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
};

function forecastDate(value: string | null) {
  if (!value) return "ยังคาดการณ์ไม่ได้";
  return new Date(`${value}T12:00:00+07:00`).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });
}

function daysLabel(value: number | null) {
  if (value === null) return "ยังคาดการณ์ไม่ได้";
  if (value > 0 && value < 0.1) return "น้อยกว่า 0.1 วัน";
  return `${value.toLocaleString("th-TH", { maximumFractionDigits: 1 })} วัน`;
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="break-words text-sm font-semibold tabular-nums">
        {children}
      </div>
    </div>
  );
}

function ForecastCard({
  tank,
  canManage,
  onSettings,
}: {
  tank: FuelTankForecast;
  canManage: boolean;
  onSettings: () => void;
}) {
  const meta = statusMeta[tank.status];
  const percent =
    tank.capacityLiters > 0
      ? Math.max(
          0,
          Math.min(100, (tank.currentLiters / tank.capacityLiters) * 100)
        )
      : 0;
  const reorderPercent =
    tank.reorderPointLiters !== null && tank.capacityLiters > 0
      ? Math.max(
          0,
          Math.min(100, (tank.reorderPointLiters / tank.capacityLiters) * 100)
        )
      : null;
  const source = {
    meters: "มิเตอร์กะที่ปิดแล้ว",
    pos: "บิลขายหน้าลาน",
    mixed: "มิเตอร์และบิลขาย",
    none: "ยังไม่มีประวัติ",
  }[tank.historical.source];
  const openShiftWarning = tank.warnings.find(warning =>
    warning.includes("มีกะเปิดอยู่")
  );
  return (
    <Card
      className="min-w-0 gap-4"
      data-testid={`fuel-forecast-tank-${tank.tankId}`}
    >
      <CardHeader className="gap-3 pb-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Fuel className="size-5 shrink-0 text-primary" />
              {tank.tankName}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {tank.productName}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn("whitespace-normal", meta.className)}
          >
            {meta.label}
          </Badge>
        </div>
        <div className="flex items-end justify-between gap-3 text-sm">
          <span className="text-muted-foreground">น้ำมันคงเหลือ</span>
          <span className="font-semibold tabular-nums">
            {fmtNum(tank.currentLiters)}{" "}
            <span className="font-normal text-muted-foreground">
              / {fmtNum(tank.capacityLiters)} ลิตร
            </span>
          </span>
        </div>
        <div
          role="meter"
          aria-label={`ระดับน้ำมัน ${tank.tankName}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${fmtNum(tank.currentLiters)} ลิตร`}
          className="relative h-3 rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full",
              tank.status === "urgent"
                ? "bg-red-500"
                : tank.status === "order_now"
                  ? "bg-amber-500"
                  : "bg-primary"
            )}
            style={{ width: `${percent}%` }}
          />
          {reorderPercent !== null && (
            <span
              title={`จุดสั่งซื้อ ${fmtNum(tank.reorderPointLiters!)} ลิตร`}
              className="absolute -top-1 h-5 w-0.5 bg-foreground"
              style={{ left: `${reorderPercent}%` }}
            />
          )}
        </div>
        {tank.reorderPointLiters !== null && (
          <p className="text-xs text-muted-foreground">
            ขีดแสดงจุดสั่งซื้อที่ {fmtNum(tank.reorderPointLiters)} ลิตร
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {openShiftWarning && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {openShiftWarning}
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
          <Metric label="เหลือขายประมาณ">
            <span
              className={cn(
                "text-lg",
                tank.status === "urgent" && "text-red-700"
              )}
            >
              {daysLabel(tank.daysLeft)}
            </span>
          </Metric>
          <Metric label="ควรสั่งภายในวันที่">
            {forecastDate(tank.orderByDate)}
          </Metric>
          <Metric label="คาดว่าจะหมดวันที่">
            {forecastDate(tank.expectedEmptyDate)}
          </Metric>
        </div>
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="size-4 text-primary" />
            แผนรับน้ำมันตามวันสั่งที่แนะนำ
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="วันที่รถส่งถึงโดยประมาณ">
              {forecastDate(tank.expectedDeliveryDate)}
            </Metric>
            <Metric label="คงเหลือก่อนรับน้ำมัน">
              {tank.projectedDeliveryLiters === null
                ? "—"
                : `${fmtNum(tank.projectedDeliveryLiters)} ลิตร`}
            </Metric>
            <Metric label="ปริมาณที่แนะนำให้สั่ง">
              <span className="text-base text-primary">
                {tank.suggestedOrderLiters === null
                  ? "—"
                  : `${fmtNum(tank.suggestedOrderLiters)} ลิตร`}
              </span>
            </Metric>
          </div>
          {tank.capacityWarning && (
            <p className="flex items-start gap-2 text-xs leading-5 text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              ความจุถังไม่พอสำหรับจำนวนวันสำรองที่ตั้งไว้
              ควรปรับแผนหรือเพิ่มรอบส่งน้ำมัน
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            รถส่ง {tank.settings.leadTimeDays} วัน · เผื่อสต๊อก{" "}
            {tank.settings.safetyStockDays} วัน · หลังรับสำรอง{" "}
            {tank.settings.targetCoverDays} วัน
          </span>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSettings}
              aria-label={`ตั้งค่าแผนสั่งน้ำมัน ${tank.tankName}`}
            >
              <Settings2 className="mr-1 size-4" />
              ตั้งค่าแผน
            </Button>
          )}
        </div>
        <details className="rounded-lg border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">
            ข้อมูลที่ใช้คำนวณ
            {tank.warnings.length > 0
              ? ` · มีข้อควรตรวจสอบ ${tank.warnings.length} รายการ`
              : ""}
          </summary>
          <div className="mt-3 space-y-2 leading-5 text-muted-foreground">
            <p>
              แหล่งข้อมูล: {source} · {fmtNum(tank.historical.meterShifts)} กะ
              {tank.historical.posBills > 0
                ? ` · ${fmtNum(tank.historical.posBills)} บิล`
                : ""}
            </p>
            <p>
              จ่ายรวม {fmtNum(tank.historical.totalLiters)} ลิตร ÷{" "}
              {tank.historical.calendarDays} วัน = เฉลี่ย{" "}
              {fmtNum(tank.historical.averageDailyLiters)} ลิตร/วัน
              (รวมวันที่ไม่มีการจ่ายน้ำมัน)
            </p>
            <p>มีประวัติที่ใช้ได้ {tank.historical.evidenceDays} วัน</p>
            {tank.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-amber-800">
                {tank.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
        {tank.status === "insufficient_data" && (
          <p className="text-xs leading-5 text-muted-foreground">
            ตรวจระดับน้ำมันจริงและประวัติปิดกะก่อนวางแผนสั่งซื้อ
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const settingFields = [
  {
    key: "leadTimeDays",
    label: "ระยะเวลาส่งน้ำมัน",
    max: 60,
    min: 0,
    help: "จำนวนวันตั้งแต่สั่งจนรถส่งถึง",
  },
  {
    key: "safetyStockDays",
    label: "จำนวนวันเผื่อสต๊อก",
    max: 30,
    min: 0,
    help: "น้ำมันสำรองสำหรับกรณีรถส่งล่าช้าหรือยอดขายเพิ่ม",
  },
  {
    key: "targetCoverDays",
    label: "จำนวนวันสำรองหลังรับน้ำมัน",
    max: 90,
    min: 1,
    help: "ต้องมากกว่าระยะเวลาส่งรวมกับวันเผื่อสต๊อก",
  },
] as const;

function ForecastSettingsDialog({
  tank,
  onClose,
}: {
  tank: FuelTankForecast;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    leadTimeDays: String(tank.settings.leadTimeDays),
    safetyStockDays: String(tank.settings.safetyStockDays),
    targetCoverDays: String(tank.settings.targetCoverDays),
  });
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const save = trpc.fuelForecast.saveSettings.useMutation({
    onSuccess: async () => {
      await utils.fuelForecast.summary.invalidate();
      toast.success("บันทึกแผนสั่งน้ำมันแล้ว");
      onClose();
    },
    onError: e => setError(e.message),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const values = {
      leadTimeDays: Number(form.leadTimeDays),
      safetyStockDays: Number(form.safetyStockDays),
      targetCoverDays: Number(form.targetCoverDays),
    };
    const invalidField = settingFields.find(
      field =>
        form[field.key].trim() === "" ||
        !Number.isInteger(values[field.key]) ||
        values[field.key] < field.min ||
        values[field.key] > field.max
    );
    if (invalidField) {
      setError(
        `${invalidField.label}ต้องเป็นจำนวนเต็ม ${invalidField.min}–${invalidField.max} วัน`
      );
      return;
    }
    const parsed = fuelForecastSettingsSchema.safeParse(values);
    if (!parsed.success) {
      setError(
        "จำนวนวันสำรองหลังรับน้ำมันต้องมากกว่าระยะเวลาส่งรวมกับวันเผื่อสต๊อก"
      );
      return;
    }
    setError("");
    save.mutate({ tankId: tank.tankId, ...parsed.data });
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ตั้งค่าแผน · {tank.tankName}</DialogTitle>
          <DialogDescription>
            ปรับตามรอบส่งน้ำมันจริงของผู้ขาย ระบบจะคำนวณแผนใหม่ให้ถังนี้
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          {settingFields.map(field => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`forecast-${field.key}`}>
                {field.label} (วัน)
              </Label>
              <Input
                id={`forecast-${field.key}`}
                type="number"
                inputMode="numeric"
                min={field.min}
                max={field.max}
                step={1}
                required
                disabled={save.isPending}
                value={form[field.key]}
                onChange={event => {
                  setForm(previous => ({
                    ...previous,
                    [field.key]: event.target.value,
                  }));
                  setError("");
                }}
                aria-describedby={`forecast-${field.key}-help`}
              />
              <p
                id={`forecast-${field.key}-help`}
                className="text-xs leading-5 text-muted-foreground"
              >
                {field.help}
              </p>
            </div>
          ))}
          <p className="rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground">
            ระบบจำกัดปริมาณที่แนะนำตามพื้นที่ว่างในถัง ณ วันที่รถส่งถึงโดยประมาณ
          </p>
          {error && (
            <p
              data-slot="notice"
              data-tone="error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "กำลังบันทึก..." : "บันทึกแผน"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function FuelForecast() {
  const { staff } = useStaff();
  const [lookbackDays, setLookbackDays] =
    useState<FuelForecastLookbackDays>(30);
  const [editingTank, setEditingTank] = useState<FuelTankForecast | null>(null);
  const forecast = trpc.fuelForecast.summary.useQuery(
    { lookbackDays },
    { refetchInterval: 60_000, refetchOnWindowFocus: true }
  );
  const canManage = staff?.role === "admin" || staff?.role === "manager";
  const canViewStock =
    staff && hasMenuPermission(staff.role, staff.menuPermissions, "stock");
  const tanks = forecast.data?.tanks ?? [];
  const priority: Record<FuelForecastStatus, number> = {
    urgent: 0,
    order_now: 1,
    ok: 2,
    insufficient_data: 3,
  };
  const sortedTanks = [...tanks].sort(
    (a, b) =>
      priority[a.status] - priority[b.status] ||
      (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) ||
      a.tankId - b.tankId
  );
  const readyCount = tanks.filter(tank => tank.status === "ok").length;
  const needOrder = tanks.filter(
    tank => tank.status === "urgent" || tank.status === "order_now"
  );
  const summaries = [
    {
      label: "ควรสั่งวันนี้",
      value: needOrder.length,
      icon: Truck,
      className: "text-amber-700",
    },
    {
      label: "เสี่ยงหมดก่อนรถส่งถึง",
      value: tanks.filter(tank => tank.status === "urgent").length,
      icon: AlertTriangle,
      className: "text-red-700",
    },
    {
      label: "ยังมีเวลาวางแผน",
      value: readyCount,
      icon: CheckCircle2,
      className: "text-emerald-700",
    },
    {
      label: "ยังคาดการณ์ไม่ได้",
      value: tanks.filter(tank => tank.status === "insufficient_data").length,
      icon: Clock3,
      className: "text-muted-foreground",
    },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-heading flex items-center gap-2">
            <CalendarDays className="size-6 text-primary" />
            วางแผนสั่งน้ำมัน
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ดูว่าน้ำมันเหลือขายกี่วัน ควรสั่งเมื่อไร และรับเข้ากี่ลิตร
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {canViewStock && (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link to="/stock">
                <ArrowLeft className="mr-1 size-4" />
                กลับหน้าสต๊อก
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={forecast.isFetching}
            onClick={() => void forecast.refetch()}
          >
            <RefreshCw
              className={cn(
                "mr-1 size-4",
                forecast.isFetching && "animate-spin"
              )}
            />
            อัปเดตข้อมูล
          </Button>
        </div>
      </div>
      <Card className="gap-0">
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="max-w-3xl text-sm leading-6 text-muted-foreground">
              <p>
                ใช้ค่าเฉลี่ยจากกะที่ปิดแล้วในวันเต็มตามเวลาไทย ไม่รวมวันนี้
                และรวมวันที่ไม่มีการจ่ายน้ำมัน
              </p>
              <p>
                แผนเป็นค่าประมาณจากยอดคงเหลือล่าสุด
                โปรดตรวจระดับจริงและยืนยันรอบส่งกับผู้ขาย
              </p>
            </div>
            <div className="w-full space-y-1.5 sm:w-40">
              <Label htmlFor="forecast-lookback">ประวัติย้อนหลัง</Label>
              <Select
                value={String(lookbackDays)}
                onValueChange={value =>
                  setLookbackDays(Number(value) as FuelForecastLookbackDays)
                }
              >
                <SelectTrigger id="forecast-lookback">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUEL_FORECAST_LOOKBACK_DAYS.map(days => (
                    <SelectItem key={days} value={String(days)}>
                      {days} วัน
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {forecast.data && (
            <div className="flex flex-wrap justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>
                ช่วงคำนวณ {forecastDate(forecast.data.periodStart)} –{" "}
                {forecastDate(forecast.data.periodEnd)}
              </span>
              <span>
                อัปเดต{" "}
                {new Date(forecast.data.generatedAt).toLocaleString("th-TH", {
                  timeZone: "Asia/Bangkok",
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
      {forecast.error && (
        <p
          data-slot="notice"
          data-tone="error"
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {forecast.data
            ? "อัปเดตข้อมูลไม่สำเร็จ ข้อมูลด้านล่างเป็นผลที่โหลดก่อนหน้า: "
            : "โหลดแผนสั่งน้ำมันไม่สำเร็จ: "}
          {forecast.error.message}
        </p>
      )}
      {forecast.isPending && (
        <div
          role="status"
          className="rounded-xl border p-8 text-center text-sm text-muted-foreground"
        >
          กำลังคำนวณแผนสั่งน้ำมัน...
        </div>
      )}
      {forecast.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summaries.map(({ label, value, icon: Icon, className }) => (
              <Card key={label} className="gap-0">
                <CardContent className="flex items-start justify-between gap-2 pt-5">
                  <div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {label}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-2xl font-bold tabular-nums",
                        className
                      )}
                    >
                      {value}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ถัง
                      </span>
                    </p>
                  </div>
                  <Icon className={cn("size-5 shrink-0", className)} />
                </CardContent>
              </Card>
            ))}
          </div>
          {tanks.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <Fuel className="size-9 text-muted-foreground" />
                <p className="font-medium">ยังไม่มีถังน้ำมันในสาขานี้</p>
                <p className="text-sm text-muted-foreground">
                  เพิ่มถังและบันทึกมิเตอร์ตอนปิดกะเพื่อเริ่มวางแผนสั่งน้ำมัน
                </p>
                {canViewStock && (
                  <Button asChild variant="outline">
                    <Link to="/stock">ไปหน้าสต๊อกและถัง</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid items-start gap-5 xl:grid-cols-2">
              {sortedTanks.map(tank => (
                <ForecastCard
                  key={tank.tankId}
                  tank={tank}
                  canManage={canManage}
                  onSettings={() => setEditingTank(tank)}
                />
              ))}
            </div>
          )}
          <div className="flex items-start gap-2 rounded-xl border bg-muted/30 p-4 text-xs leading-6 text-muted-foreground">
            <Info className="mt-1 size-4 shrink-0" />
            <div>
              <p>
                จุดสั่งซื้อ = ลิตรเฉลี่ยต่อวัน × (ระยะเวลาส่ง + วันเผื่อสต๊อก) ·
                ปริมาณที่แนะนำ = น้ำมันเป้าหมายหลังรับ − คงเหลือก่อนรับ
                โดยไม่เกินความจุถัง
              </p>
              <p>
                {forecast.data.method} ต้องมีประวัติที่ใช้ได้อย่างน้อย{" "}
                {forecast.data.minimumEvidenceDays} วันเพื่อแสดงคำแนะนำ
              </p>
            </div>
          </div>
        </>
      )}
      {editingTank && canManage && (
        <ForecastSettingsDialog
          key={`${staff?.branch.id}-${editingTank.tankId}`}
          tank={editingTank}
          onClose={() => setEditingTank(null)}
        />
      )}
    </div>
  );
}
